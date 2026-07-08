export function reorderIds(
  ids: string[],
  draggedId: string,
  targetId: string,
): string[] {
  const fromIndex = ids.indexOf(draggedId);
  const toIndex = ids.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return ids;
  }

  const next = [...ids];
  next.splice(fromIndex, 1);
  const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  next.splice(insertIndex, 0, draggedId);
  return next;
}
