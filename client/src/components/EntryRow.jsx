function formatDueDate(dueAt) {
  if (!dueAt) return null;
  const dueDate = new Date(dueAt);
  return Number.isNaN(dueDate.valueOf()) ? dueAt : dueDate.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function EntryRow({ item, onChange, onDelete, onToggleToday, onEdit }) {
  const source = item.className || item.source || item.kind;

  return (
    <article className={`entry-row${item.completed ? ' is-completed' : ''}`}>
      <label className="completion-toggle" title={item.completed ? 'Mark incomplete' : 'Mark complete'}>
        <input type="checkbox" checked={item.completed} onChange={(event) => onChange(item, { completed: event.target.checked })} />
        <span className="sr-only">Mark {item.title} as complete</span>
      </label>
      <div className="entry-main">
        <button className="entry-title" type="button" onClick={() => onEdit(item)}>{item.title}</button>
        <div className="entry-meta">
          {item.dueAt && <time dateTime={item.dueAt}>Due {formatDueDate(item.dueAt)}</time>}
          {source && <span>{source}</span>}
        </div>
      </div>
      <div className="entry-actions">
        <button type="button" onClick={() => onToggleToday(item, !item.inToday)}>{item.inToday ? 'Remove from Today' : 'Add to Today'}</button>
        <button type="button" onClick={() => onEdit(item)}>Edit</button>
        <button className="danger-button" type="button" onClick={() => onDelete(item)}>Delete</button>
      </div>
    </article>
  );
}
