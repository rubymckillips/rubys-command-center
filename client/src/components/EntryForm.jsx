import { useState } from 'react';

function dateTimeValue(value) {
  return value ? value.slice(0, 16) : '';
}

export default function EntryForm({ initialItem, section, onSave, onCancel }) {
  const [title, setTitle] = useState(initialItem?.title ?? '');
  const [notes, setNotes] = useState(initialItem?.notes ?? '');
  const [dueAt, setDueAt] = useState(dateTimeValue(initialItem?.dueAt));
  const [completed, setCompleted] = useState(initialItem?.completed ?? false);
  const [externalUrl, setExternalUrl] = useState(initialItem?.externalUrl ?? '');
  const [workoutType, setWorkoutType] = useState(initialItem?.workoutType ?? 'legs');
  const [plannedFor, setPlannedFor] = useState(dateTimeValue(initialItem?.plannedFor ?? initialItem?.dueAt));
  const [mealType, setMealType] = useState(initialItem?.mealType ?? 'dinner');
  const [prepNotes, setPrepNotes] = useState(initialItem?.prepNotes ?? '');
  const [checklist, setChecklist] = useState((initialItem?.checklist ?? []).join('\n'));
  const sourceOwned = Boolean(initialItem?.source);
  const workout = section === 'workouts';
  const meal = section === 'meals';

  function submit(event) {
    event.preventDefault();
    const fields = {
      section,
      title: title.trim(),
      notes: notes.trim() || null,
      dueAt: (workout || meal ? plannedFor : dueAt) || null,
      completed,
      externalUrl: externalUrl.trim() || null,
    };
    if (workout) {
      fields.workoutType = workoutType;
      fields.plannedFor = plannedFor || null;
      fields.title = `Workout: ${workoutType === 'abs-cardio' ? 'Abs + Cardio' : workoutType === 'legs' ? 'Legs' : 'Cardio'}`;
    }
    if (meal) {
      fields.mealType = mealType.trim() || 'meal';
      fields.prepNotes = prepNotes.trim() || null;
      fields.checklist = checklist.split('\n').map((entry) => entry.trim()).filter(Boolean);
      fields.plannedFor = plannedFor || null;
    }
    onSave(fields);
  }

  return (
    <form className="entry-form" onSubmit={submit}>
      {sourceOwned ? <div className="read-only-field"><span>Title</span><p>{initialItem.title}</p></div> : !workout && <label>
        Title
        <input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>}
      {workout && <label>
        Workout type
        <select value={workoutType} onChange={(event) => setWorkoutType(event.target.value)}>
          <option value="legs">Legs</option>
          <option value="abs-cardio">Abs + Cardio</option>
          <option value="cardio">Cardio</option>
        </select>
      </label>}
      {meal && <label>
        Meal
        <input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. sheet-pan dinner" />
      </label>}
      <label>
        {meal ? 'Extra notes' : 'Notes'}
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" />
      </label>
      {meal && <>
        <label>
          Meal type
          <input value={mealType} onChange={(event) => setMealType(event.target.value)} placeholder="e.g. dinner" />
        </label>
        <label>
          Preparation notes
          <textarea value={prepNotes} onChange={(event) => setPrepNotes(event.target.value)} rows="2" />
        </label>
        <label>
          Prep / grocery checklist
          <textarea value={checklist} onChange={(event) => setChecklist(event.target.value)} rows="3" placeholder="One item per line" />
        </label>
      </>}
      {sourceOwned ? <div className="read-only-field"><span>Scheduled time</span><p>{initialItem.dueAt || 'No scheduled time'}</p></div> : (workout || meal) ? <label>
        Planned for
        <input type="datetime-local" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} />
      </label> : <label>
        Due date
        <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
      </label>}
      <label>
        Link
        <input type="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} />
      </label>
      <label className="completion-field">
        <input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} />
        Completed
      </label>
      <div className="form-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" type="submit">Save</button>
      </div>
    </form>
  );
}
