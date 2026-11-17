import { beforeEach, describe, expect, test } from "bun:test";
import { createMember } from "./members.ts";
import type { Database } from "./schema.ts";
import {
  completeTask,
  countTasks,
  getTask,
  insertTask,
  listTasks,
  setTaskAssignee,
} from "./tasks.ts";
import { createTestDatabase } from "./testing.ts";

let db: Database;
let memberId: string;

beforeEach(async () => {
  db = createTestDatabase();
  memberId = (
    await createMember(db, {
      email: "ana@example.com",
      name: "Ana",
      role: "member",
    })
  ).id;
});

const addTask = (title: string, dueOn: string | null = null) =>
  insertTask(db, { assigneeId: null, createdById: memberId, dueOn, title });

describe("tasks", () => {
  test("listTasks puts open tasks first, by due date, undated last", async () => {
    const undated = await addTask("Undated");
    await addTask("Later", "2026-11-01");
    await addTask("Sooner", "2026-10-25");
    await completeTask(db, undated.id);
    await addTask("Also undated");

    expect((await listTasks(db)).map((t) => t.title)).toEqual([
      "Sooner",
      "Later",
      "Also undated",
      "Undated",
    ]);
  });

  test("completeTask only completes an open task once", async () => {
    const task = await addTask("Ship it");

    expect((await completeTask(db, task.id))?.completedAt).not.toBeNull();
    expect(await completeTask(db, task.id)).toBeNull();
  });

  test("setTaskAssignee and the assignee filter", async () => {
    const task = await addTask("Ship it");
    await addTask("Someone else's");

    await setTaskAssignee(db, task.id, memberId);

    expect((await getTask(db, task.id))?.assigneeId).toBe(memberId);
    expect(
      (await listTasks(db, { assigneeId: memberId })).map((t) => t.title)
    ).toEqual(["Ship it"]);
  });

  test("listTasks views and countTasks", async () => {
    await addTask("undated");
    await addTask("yesterday", "2026-10-22");
    await addTask("today", "2026-10-23");
    await addTask("plus6", "2026-10-29");
    await addTask("plus7", "2026-10-30");
    const done = await addTask("done", "2026-10-01");
    await completeTask(db, done.id);
    const f = { today: "2026-10-23", weekEnd: "2026-10-29" };
    const titles = async (view: "open" | "overdue" | "week" | "done") =>
      (await listTasks(db, { ...f, view })).map((t) => t.title);

    expect(await titles("open")).toEqual([
      "yesterday",
      "today",
      "plus6",
      "plus7",
      "undated",
    ]);
    expect(await titles("overdue")).toEqual(["yesterday"]);
    expect(await titles("week")).toEqual(["today", "plus6"]);
    expect(await titles("done")).toEqual(["done"]);
    expect(await countTasks(db, f.today, f.weekEnd)).toEqual({
      done: 1,
      open: 5,
      overdue: 1,
      week: 2,
    });
  });
});
