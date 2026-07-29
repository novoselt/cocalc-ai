import { AsyncLocalStorage } from "node:async_hooks";

export type BtrfsMutationPriority =
  | "lifecycle"
  | "interactive"
  | "scheduled"
  | "scavenger";

export type BtrfsMutationContext = {
  operation_id?: string;
  project_id?: string;
  priority?: BtrfsMutationPriority;
  operation_class?: string;
  cgroup_path?: string;
  checkpointable?: boolean;
  yield_requested?: boolean;
  lifecycle_backlog?: number;
};

const mutationContext = new AsyncLocalStorage<BtrfsMutationContext>();

export function getBtrfsMutationContext(): BtrfsMutationContext {
  return mutationContext.getStore() ?? {};
}

export function effectiveBtrfsMutationContext(
  context?: BtrfsMutationContext,
): BtrfsMutationContext {
  const current = getBtrfsMutationContext();
  return {
    ...current,
    ...(context ?? {}),
    priority: context?.priority ?? current.priority ?? "interactive",
  };
}

export async function withBtrfsMutationContext<T>(
  context: BtrfsMutationContext,
  run: () => Promise<T>,
): Promise<T> {
  return await mutationContext.run(effectiveBtrfsMutationContext(context), run);
}

export function isBackgroundBtrfsMutation(): boolean {
  const priority = getBtrfsMutationContext().priority;
  return priority === "scheduled" || priority === "scavenger";
}
