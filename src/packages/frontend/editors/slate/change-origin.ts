type SlateOperationLike = { type: string };

export function hasOnlySelectionOperations(
  operations: readonly SlateOperationLike[],
): boolean {
  return (
    operations.length > 0 &&
    operations.every((operation) => operation.type === "set_selection")
  );
}

export function isLocalContentChange({
  operations,
  syncCausedUpdate,
}: {
  operations: readonly SlateOperationLike[];
  syncCausedUpdate: boolean;
}): boolean {
  return !syncCausedUpdate && !hasOnlySelectionOperations(operations);
}
