import { useRef, useState } from 'react';
import { reorderIds } from '../lib/order.js';
import { shouldShowTodayDropTarget } from '../lib/todayTarget.js';
import EntryRow from './EntryRow.jsx';

export default function EntryList({ items, scope, onEdit, onDelete, onToggleToday, onReorder }) {
  const dragIndex = useRef(null);
  const [dragging, setDragging] = useState(null);

  function startDrag(event, index) {
    dragIndex.current = index;
    setDragging(items[index].id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', items[index].id);
  }

  function dropOnRow(event, targetIndex) {
    event.preventDefault();
    if (dragIndex.current === null || dragIndex.current === targetIndex) return;
    onReorder(scope, reorderIds(items.map((item) => item.id), dragIndex.current, targetIndex));
  }

  function finishDrag() {
    dragIndex.current = null;
    setDragging(null);
  }

  function dropOnToday(event) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    if (id) onToggleToday({ id }, true);
    finishDrag();
  }

  return (
    <div className="entry-list-wrap">
      {shouldShowTodayDropTarget(scope) && (
        <div className="today-drop-target" onDragOver={(event) => event.preventDefault()} onDrop={dropOnToday}>
          Drop an entry here to add it to Today
        </div>
      )}
      <ul className="entry-list" aria-label={`${scope} entries`}>
        {items.map((item, index) => (
          <li className={dragging === item.id ? 'is-dragging' : ''} draggable key={item.id}
            onDragStart={(event) => startDrag(event, index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropOnRow(event, index)} onDragEnd={finishDrag}>
            <EntryRow item={item} onChange={onEdit} onEdit={onEdit} onDelete={onDelete} onToggleToday={onToggleToday} />
          </li>
        ))}
      </ul>
      <button className="add-entry-button" type="button" onClick={() => onEdit(null)}>+ Add entry</button>
    </div>
  );
}
