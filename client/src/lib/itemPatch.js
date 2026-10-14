export function isCanvasAssignment(item) {
  return item?.source === 'canvas';
}

export function buildItemPatch(item, fields) {
  const localFields = {
    notes: fields.notes,
    completed: fields.completed,
    externalUrl: fields.externalUrl,
  };
  return isCanvasAssignment(item) ? localFields : {
    title: fields.title,
    dueAt: fields.dueAt,
    ...localFields,
  };
}
