import type { Database } from "@repo/db";
import {
  TASK_TITLE_MAX_LENGTH,
  type Task,
  type TaskCounts,
  type TaskView,
} from "@repo/db/shared";
import {
  completeTask,
  countTasks,
  getTask,
  insertTask,
  listTasks,
  setTaskAssignee,
} from "@repo/db/tasks";
import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.ts";
import { requireMember } from "./members.ts";

export const createTaskInput = z.object({
  assigneeId: z.string().nullable().default(null),
  dueOn: z.iso.date().nullable().default(null),
  title: z
    .string()
    .trim()
    .min(1, "Task title must not be empty.")
    .max(
      TASK_TITLE_MAX_LENGTH,
      `Task title must be at most ${TASK_TITLE_MAX_LENGTH} characters.`
    ),
});

export type CreateTaskInput = z.input<typeof createTaskInput>;

export interface TasksService {
  assign: (
    actorId: string,
    taskId: string,
    assigneeId: string | null
  ) => Promise<Task>;
  /** The assignee, the creator or an admin may complete a task. */
  complete: (actorId: string, taskId: string) => Promise<Task>;
  /** Task counts per view, over all tasks. `today` is YYYY-MM-DD. */
  counts: (today: string) => Promise<TaskCounts>;
  /** Throws on a missing assignee or a due date in the past. */
  create: (
    actorId: string,
    input: CreateTaskInput,
    today: string
  ) => Promise<Task>;
  /** `view` defaults to "open". `today` is YYYY-MM-DD. */
  list: (
    filter: { assigneeId?: string; view?: TaskView } | undefined,
    today: string
  ) => Promise<Task[]>;
}

const DAY_MS = 86_400_000;
const WEEK_DAYS_AFTER_TODAY = 6;

/** Last day of the "due this week" window: today + 6 days, inclusive. */
function weekEndOf(today: string): string {
  const ms = Date.parse(`${today}T00:00:00Z`) + WEEK_DAYS_AFTER_TODAY * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export const createTasksService = (db: Database): TasksService => ({
  assign: async (actorId, taskId, assigneeId) => {
    await requireMember(db, actorId);
    if (assigneeId !== null) {
      await requireMember(db, assigneeId);
    }
    const task = await setTaskAssignee(db, taskId, assigneeId);
    if (!task) {
      throw new NotFoundError("Task", taskId);
    }
    return task;
  },
  complete: async (actorId, taskId) => {
    const actor = await requireMember(db, actorId);
    const task = await getTask(db, taskId);
    if (!task) {
      throw new NotFoundError("Task", taskId);
    }
    const allowed =
      actor.role === "admin" ||
      task.createdById === actor.id ||
      task.assigneeId === actor.id;
    if (!allowed) {
      throw new ForbiddenError(
        "Only the assignee, the creator or an admin can complete this task."
      );
    }
    const done = await completeTask(db, taskId);
    if (!done) {
      throw new ValidationError("This task is already done.");
    }
    return done;
  },
  counts: (today) => countTasks(db, today, weekEndOf(today)),
  // `today` comes from the caller (YYYY-MM-DD) so the rule is testable and the
  // service never reads the clock for a business decision.
  create: async (actorId, input, today) => {
    await requireMember(db, actorId);
    const data = createTaskInput.parse(input);
    if (data.assigneeId !== null) {
      await requireMember(db, data.assigneeId);
    }
    if (data.dueOn !== null && data.dueOn < today) {
      throw new ValidationError("The due date is in the past.");
    }
    return await insertTask(db, { ...data, createdById: actorId });
  },
  list: (filter, today) =>
    listTasks(db, {
      ...filter,
      today,
      view: filter?.view ?? "open",
      weekEnd: weekEndOf(today),
    }),
});
