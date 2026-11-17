# Task views

Status: draft. Target: about 20 minutes to build.

## Problem

The tasks page is one flat list of everything. People can't quickly see what is
overdue or coming up, and done tasks clutter the list.

## What to build

Tabs above the task list on `/tasks`:

| Tab | Shows | Order |
| --- | --- | --- |
| **Open** (default) | Tasks not done | Due date ascending, undated last |
| **Overdue** | Open tasks with `dueOn` before today | Due date ascending |
| **Due this week** | Open tasks with `dueOn` from today through today + 6 days, inclusive | Due date ascending |
| **Done** | Completed tasks | Most recently completed first |

- Each tab label shows a count, e.g. `Overdue (3)`.
- "Today" is the server's UTC date (`YYYY-MM-DD`), passed in by the router, same
  as `tasks.create` does with `todayUtc()`. Services never read the clock.
- Counts cover all tasks, not one assignee. They update after completing,
  assigning or creating a task.
- A task with no due date appears only in Open (and Done once completed).
- Empty tab: a short message, e.g. "Nothing overdue." / "No tasks yet."

## Design

Follow the layering in `CLAUDE.md`: route -> router -> service -> queries.

- `packages/db/src/shared.ts`: export `TaskView = "open" | "overdue" | "week" | "done"`
  and a `TaskCounts` shape (`Record<TaskView, number>`), so the browser can import them.
- `packages/db/src/tasks.ts`:
  - `listTasks(db, filter)` gains `view` and `today`. Filtering and order happen
    in SQL. The existing order (open first, due ascending, undated last, done by
    `completedAt` desc) already fits Open and Done.
  - New `countTasks(db, today): TaskCounts`.
- `packages/services/src/tasks.ts`:
  - `list(filter?: { assigneeId?: string; view?: TaskView }, today: string)`.
    Default view is `open`. This changes what an unfiltered `list` returns (done
    tasks no longer included by default); check other callers.
  - New `counts(today)`.
  - The week window is computed here: `today` plus 6 days, as a date string.
- `apps/web/src/server/trpc/routers/tasks.ts`: `list` input gains an optional
  `view`; add a `counts` query. Both pass `todayUtc()`. No logic in the router.
- `apps/web/src/routes/tasks.tsx` and `components/task-list.tsx`: tab bar
  (reuse an existing shadcn tabs/button-group component if present), selected
  tab held in component state, list and counts refetched after each mutation.
  The loader fetches the Open list and the counts.

No schema change, so no migration.

## Out of scope

- "My tasks" view and any assignee filter in the UI.
- Highlighting overdue rows, URL-synced tab (`?view=`), priorities, editing,
  reopening or deleting tasks.
- Time zones. Due dates are calendar dates and "today" is UTC.

## Acceptance

- `bun test` passes with new service tests in `packages/services/src/tasks.test.ts`:
  - each view returns the right tasks and order, with a fixed `today`;
  - boundaries: due yesterday is Overdue; due today and due today + 6 are
    Due this week; due today + 7 is only in Open; completed tasks never appear
    in Overdue or Due this week;
  - counts match the lists.
- `bun run check` passes.
- Manually on `bun run dev`: tabs switch, counts match, completing a task moves
  it to Done and updates counts without a reload.
