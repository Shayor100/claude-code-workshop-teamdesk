# Implementation plan: task views

Plan for [task-views.md](task-views.md). Three phases, one commit each.

Notes from reading the code:

- `tasks.list` has one real caller, the `/tasks` loader. `packages/db/src/tasks.test.ts`
  calls `listTasks(db)` and `listTasks(db, { assigneeId })`, so `view` stays optional at
  the db layer (no default). The service applies the `open` default.
- `components/ui/tabs.tsx` already exists.

## Phase 1: Data and rules (db, service, tests)

1. `packages/db/src/shared.ts`: add `TaskView` (`"open" | "overdue" | "week" | "done"`)
   and `TaskCounts` (`Record<TaskView, number>`).
2. `packages/db/src/tasks.ts`: extend `listTasks` with optional `view`, `today`,
   `weekEnd`; add `countTasks(db, today, weekEnd): TaskCounts`.
3. `packages/services/src/tasks.ts`: `list(filter, today)` defaults view to `open` and
   computes `weekEnd` (today + 6 days); add `counts(today)`; update `TasksService`.
4. Tests in `packages/services/src/tasks.test.ts` and `packages/db/src/tasks.test.ts`:
   each view and its order; boundaries (yesterday = Overdue; today and today + 6 = Week;
   today + 7 = Open only; done never in Overdue/Week; undated only in Open); counts
   match lists.
5. Verify: `bun test packages`, `bun run check`.

## Phase 2: API (tRPC router)

1. `apps/web/src/server/trpc/routers/tasks.ts`: `list` input gains optional `view`
   (zod enum of `TaskView`); add `counts` query; both pass `todayUtc()`. No logic.
2. Verify: `bun run check`.

## Phase 3: UI (tabs, refetch)

1. `apps/web/src/routes/tasks.tsx`: loader fetches the Open list and counts; `view` in
   component state; tab change fetches `tasks.list` for that view; after each mutation
   refetch the active view (`useAction` only invalidates loader data).
2. Tabs with existing `Tabs`/`TabsList`/`TabsTrigger`, labels like `Overdue (3)`,
   per-tab empty messages. Assign and complete work in every tab.
3. Verify: `bun run check`, `bun test`, manual run on `bun run dev`.
