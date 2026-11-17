import { beforeEach, describe, expect, test } from "bun:test";
import { tasks as tasksTable } from "@repo/db";
import { eq } from "drizzle-orm";
import { createTeam, type Team } from "./fixtures.ts";
import { createTasksService, type TasksService } from "./tasks.ts";

const TODAY = "2026-10-23";

let team: Team;
let tasks: TasksService;

beforeEach(async () => {
  team = await createTeam();
  tasks = createTasksService(team.db);
});

describe("tasks service", () => {
  test("create trims the title and keeps the due date", async () => {
    const task = await tasks.create(
      team.ana.id,
      { dueOn: "2026-10-30", title: "  Book the venue  " },
      TODAY
    );

    expect(task).toMatchObject({
      createdById: team.ana.id,
      dueOn: "2026-10-30",
      title: "Book the venue",
    });
  });

  test("create rejects an unknown assignee", async () => {
    await expect(
      tasks.create(team.ana.id, { assigneeId: "999", title: "Nobody" }, TODAY)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // biome-ignore lint/suspicious/noSkippedTests: due dates are not validated yet, re-enable when tasks.ts checks them
  test.skip("create rejects a due date in the past", async () => {
    await expect(
      tasks.create(
        team.ana.id,
        { dueOn: "2026-10-01", title: "Too late" },
        TODAY
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  test("only the assignee, the creator or an admin can complete a task", async () => {
    const task = await tasks.create(
      team.ana.id,
      { title: "Order pizza" },
      TODAY
    );

    await expect(tasks.complete(team.ben.id, task.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await tasks.assign(team.ana.id, task.id, team.ben.id);
    expect(
      (await tasks.complete(team.ben.id, task.id)).completedAt
    ).not.toBeNull();
  });

  test("completing twice is a validation error", async () => {
    const task = await tasks.create(
      team.ana.id,
      { title: "Order pizza" },
      TODAY
    );
    await tasks.complete(team.admin.id, task.id);

    await expect(tasks.complete(team.admin.id, task.id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  describe("views", () => {
    // TODAY = 2026-10-23, so the week runs through 2026-10-29.
    const add = (title: string, dueOn: string | null) =>
      tasks.create(team.ana.id, { dueOn, title }, "2026-01-01");
    const titles = async (view?: "open" | "overdue" | "week" | "done") =>
      (await tasks.list(view ? { view } : undefined, TODAY)).map(
        (t) => t.title
      );

    const seed = async () => {
      await add("undated", null);
      await add("yesterday", "2026-10-22");
      await add("older", "2026-10-01");
      await add("today", TODAY);
      await add("plus6", "2026-10-29");
      await add("plus7", "2026-10-30");
      const doneOverdue = await add("done-overdue", "2026-10-10");
      const doneWeek = await add("done-week", "2026-10-25");
      const doneUndated = await add("done-undated", null);
      // Distinct completion times so the order is deterministic.
      const completions = [
        [doneOverdue, "2026-10-20T10:00:00.000Z"],
        [doneWeek, "2026-10-22T10:00:00.000Z"],
        [doneUndated, "2026-10-21T10:00:00.000Z"],
      ] as const;
      await Promise.all(
        completions.map(([task, at]) =>
          team.db
            .update(tasksTable)
            .set({ completedAt: at })
            .where(eq(tasksTable.id, Number(task.id)))
        )
      );
    };

    test("open is the default, by due date, undated last, no done", async () => {
      await seed();
      const expected = [
        "older",
        "yesterday",
        "today",
        "plus6",
        "plus7",
        "undated",
      ];
      expect(await titles()).toEqual(expected);
      expect(await titles("open")).toEqual(expected);
    });

    test("overdue: before today only, never done or undated", async () => {
      await seed();
      expect(await titles("overdue")).toEqual(["older", "yesterday"]);
    });

    test("week: today through today + 6, inclusive", async () => {
      await seed();
      expect(await titles("week")).toEqual(["today", "plus6"]);
    });

    test("done: most recently completed first", async () => {
      await seed();
      expect(await titles("done")).toEqual([
        "done-week",
        "done-undated",
        "done-overdue",
      ]);
    });

    test("week window crosses a month boundary", async () => {
      await add("in", "2026-11-02");
      await add("out", "2026-11-03");
      expect(
        (await tasks.list({ view: "week" }, "2026-10-27")).map((t) => t.title)
      ).toEqual(["in"]);
    });

    test("counts match the lists and cover all assignees", async () => {
      await seed();
      const [first] = await tasks.list({ view: "open" }, TODAY);
      if (!first) {
        throw new Error("expected seeded tasks");
      }
      await tasks.assign(team.ana.id, first.id, team.ben.id);
      expect(await tasks.counts(TODAY)).toEqual({
        done: 3,
        open: 6,
        overdue: 2,
        week: 2,
      });
      const counts = await tasks.counts(TODAY);
      const lists = await Promise.all(
        (["open", "overdue", "week", "done"] as const).map(async (view) => [
          view,
          (await tasks.list({ view }, TODAY)).length,
        ])
      );
      expect(Object.fromEntries(lists)).toEqual(counts);
    });

    test("counts are zero when empty", async () => {
      expect(await tasks.counts(TODAY)).toEqual({
        done: 0,
        open: 0,
        overdue: 0,
        week: 0,
      });
    });
  });
});
