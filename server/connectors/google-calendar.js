import { fetchFeed, parseIcal } from './ical.js';
import { upsertRecords } from './canvas.js';

export async function syncGoogleCalendar({ url, fetchImpl, itemsRepository, now, upcomingDays } = {}) {
  const text = await fetchFeed(url, fetchImpl);
  const records = parseIcal(text, { source: 'google-calendar', now, upcomingDays });
  return upsertRecords({ itemsRepository, records, source: 'google-calendar', section: 'calendar', kind: 'event' });
}
