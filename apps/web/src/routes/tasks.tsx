import {
  TASK_TITLE_MAX_LENGTH,
  type Task,
  type TaskView,
} from "@repo/db/shared";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import FormError from "#/components/form-error";
import MemberPicker from "#/components/member-picker";
import PageError from "#/components/page-error";
import TaskList from "#/components/task-list";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "#/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useActingMember } from "#/hooks/use-acting-member";
import { useAction } from "#/hooks/use-action";
import { getTrpc } from "#/integrations/trpc/client";

export const Route = createFileRoute("/tasks")({
  loader: async () => {
    const trpc = getTrpc();
    const [members, tasks, counts] = await Promise.all([
      trpc.members.list.query(),
      trpc.tasks.list.query({ view: "open" }),
      trpc.tasks.counts.query(),
    ]);
    return { counts, members, tasks };
  },
  component: TasksPage,
  errorComponent: PageError,
});

const TABS: readonly { label: string; view: TaskView }[] = [
  { label: "Open", view: "open" },
  { label: "Overdue", view: "overdue" },
  { label: "Due this week", view: "week" },
  { label: "Done", view: "done" },
];

const EMPTY: Record<TaskView, string> = {
  done: "No completed tasks.",
  open: "No tasks yet.",
  overdue: "Nothing overdue.",
  week: "Nothing due this week.",
};

function TasksPage() {
  const { counts, members, tasks } = Route.useLoaderData();
  const [view, setView] = useState<TaskView>("open");
  const [other, setOther] = useState<{ tasks: Task[]; view: TaskView } | null>(
    null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const { actingMember, setActingMemberId } = useActingMember(members);
  const createTask = useAction();
  const updateTask = useAction();
  const actorId = actingMember?.id ?? "";

  // Loader data is replaced after every mutation (new `counts` identity), so
  // re-query the active non-open view then too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `counts` is the refresh trigger
  useEffect(() => {
    if (view === "open") {
      return;
    }
    let cancelled = false;
    getTrpc()
      .tasks.list.query({ view })
      .then((result) => {
        if (!cancelled) {
          setLoadError(null);
          setOther({ tasks: result, view });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Something went wrong."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, counts]);

  const handleView = useCallback((value: string) => {
    setView(value as TaskView);
  }, []);

  let visible: readonly Task[] | null = null;
  if (view === "open") {
    visible = tasks;
  } else if (other?.view === view) {
    visible = other.tasks;
  }

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const ok = await createTask.run(() =>
        getTrpc().tasks.create.mutate({
          actorId,
          task: {
            assigneeId: String(data.get("assigneeId") ?? "") || null,
            dueOn: String(data.get("dueOn") ?? "") || null,
            title: String(data.get("title") ?? ""),
          },
        })
      );
      if (ok) {
        form.reset();
      }
    },
    [actorId, createTask.run]
  );

  const handleComplete = useCallback(
    (taskId: string) =>
      updateTask.run(() =>
        getTrpc().tasks.complete.mutate({ actorId, taskId })
      ),
    [actorId, updateTask.run]
  );

  const handleAssign = useCallback(
    (taskId: string, assigneeId: string | null) =>
      updateTask.run(() =>
        getTrpc().tasks.assign.mutate({ actorId, assigneeId, taskId })
      ),
    [actorId, updateTask.run]
  );

  return (
    <main className="page-wrap px-4 py-12">
      <section className="flex max-w-3xl flex-col gap-4">
        <p className="island-kicker m-0">Teamdesk</p>
        <h1 className="display-title m-0 text-4xl text-foreground sm:text-5xl">
          Tasks
        </h1>
        <p className="m-0 text-base text-muted-foreground leading-8">
          Shared jobs for the team. Hand them out and tick them off.
        </p>
        <MemberPicker
          members={members}
          onChange={setActingMemberId}
          value={actingMember?.id}
        />
      </section>

      <form className="island-shell mt-10 p-6 sm:p-8" onSubmit={handleCreate}>
        <p className="island-kicker mb-3">New task</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label="Title"
            maxLength={TASK_TITLE_MAX_LENGTH}
            name="title"
            placeholder="What needs doing?"
            required
          />
          <NativeSelect aria-label="Assignee" defaultValue="" name="assigneeId">
            <NativeSelectOption value="">Unassigned</NativeSelectOption>
            {members.map((member) => (
              <NativeSelectOption key={member.id} value={member.id}>
                {member.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            aria-label="Due date"
            className="sm:w-44"
            name="dueOn"
            type="date"
          />
          <Button disabled={createTask.pending} type="submit">
            {createTask.pending ? "Adding…" : "Add task"}
          </Button>
        </div>
        <FormError message={createTask.error} />
      </form>

      <section className="mt-10">
        <FormError message={updateTask.error} />
        <Tabs className="mb-4" onValueChange={handleView} value={view}>
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.view} value={tab.view}>
                {tab.label} ({counts[tab.view]})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <FormError message={loadError} />
        {visible ? (
          <TaskList
            disabled={updateTask.pending}
            emptyMessage={EMPTY[view]}
            members={members}
            onAssign={handleAssign}
            onComplete={handleComplete}
            tasks={visible}
          />
        ) : (
          <p className="text-muted-foreground text-sm">Loading…</p>
        )}
      </section>
    </main>
  );
}
