export function reorderIds(ids, fromIndex, toIndex) {
  const orderedIds = [...ids];
  const [movedId] = orderedIds.splice(fromIndex, 1);
  orderedIds.splice(toIndex, 0, movedId);
  return orderedIds;
}
