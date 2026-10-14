import { createItemsRepository } from './repositories/items.js';

const demoItems = [
  { id: 'demo-work-session', section: 'work', title: 'Sample: plan a focused work session', notes: 'Set one clear goal for the next work block.', dueAt: '2026-09-30T14:00:00.000Z' },
  { id: 'demo-project-brief', section: 'projects', title: 'Sample: outline a project brief', notes: 'Capture one useful idea and one next step.', dueAt: '2026-10-01T09:00:00.000Z' },
  { id: 'demo-job-follow-up', section: 'job-applications', title: 'Sample: follow up on an internship application', notes: 'Draft a concise, friendly follow-up.', dueAt: '2026-10-02T15:00:00.000Z' },
  { id: 'demo-workout-legs', section: 'workouts', title: 'Sample: Legs workout', notes: '[[cc-plan:{"workoutType":"legs"}]]\nChoose weights that feel steady today.', dueAt: '2026-10-01T17:30:00.000Z' },
  { id: 'demo-workout-cardio', section: 'workouts', title: 'Sample: Cardio workout', notes: '[[cc-plan:{"workoutType":"cardio"}]]\nA relaxed 20-minute walk or ride.', dueAt: '2026-10-03T10:00:00.000Z' },
  { id: 'demo-meal-dinner', section: 'meals', title: 'Sample: sheet-pan dinner', notes: '[[cc-plan:{"mealType":"dinner","prepNotes":"Chop vegetables before class.","checklist":["sweet potato","broccoli","chickpeas"]}]]', dueAt: '2026-09-30T18:30:00.000Z' },
];

export async function seedLocalItems(pool) {
  const count = Number((await pool.query("SELECT COUNT(*) AS count FROM items WHERE source IS NULL")).rows[0].count);
  if (count > 0) return false;
  const itemsRepository = createItemsRepository(pool);
  for (const item of demoItems) await itemsRepository.create({ kind: 'local', ...item });
  return true;
}
