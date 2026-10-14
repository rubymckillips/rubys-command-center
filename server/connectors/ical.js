import ICAL from 'ical.js';

const DEFAULT_UPCOMING_DAYS = 90;

export class FeedError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'FeedError';
  }
}

export async function fetchFeed(url, fetchImpl = fetch) {
  if (!url) throw new FeedError('This feed is not configured.');
  try {
    const response = await fetchImpl(url);
    if (!response || !response.ok) {
      throw new FeedError('The feed could not be retrieved.');
    }
    return await response.text();
  } catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError('The feed could not be retrieved.', { cause: error });
  }
}

export function parseIcal(text, { source, now = new Date(), upcomingDays = DEFAULT_UPCOMING_DAYS } = {}) {
  if (!source) throw new FeedError('A feed source is required.');
  if (typeof text !== 'string' || !text.trim()) throw new FeedError('The feed is empty or invalid.');

  let calendar;
  try {
    calendar = new ICAL.Component(ICAL.parse(text));
  } catch (error) {
    throw new FeedError('The feed is not valid iCalendar data.', { cause: error });
  }
  if (calendar.name !== 'vcalendar') throw new FeedError('The feed is not valid iCalendar data.');

  const start = new Date(now);
  const end = new Date(start);
  end.setDate(end.getDate() + upcomingDays);
  const calendarName = asText(calendar.getFirstPropertyValue('x-wr-calname'));

  return calendar.getAllSubcomponents('vevent')
    .map((component) => normalizeEvent(component, { source, calendarName }))
    .filter(Boolean)
    .filter((record) => {
      const dueAt = new Date(record.dueAt);
      return dueAt >= start && dueAt <= end;
    });
}

function normalizeEvent(component, { source, calendarName }) {
  const event = new ICAL.Event(component);
  const sourceId = asText(component.getFirstPropertyValue('uid'));
  const title = asText(component.getFirstPropertyValue('summary'));
  if (!sourceId || !title || !event.startDate) return null;

  const dueAt = event.startDate.toJSDate();
  if (Number.isNaN(dueAt.valueOf())) return null;

  return {
    source,
    sourceId,
    title,
    dueAt: dueAt.toISOString(),
    className: asText(component.getFirstPropertyValue('x-canvas-course-name'))
      || asText(component.getFirstPropertyValue('categories'))
      || calendarName
      || null,
    sourceUrl: asText(component.getFirstPropertyValue('url')) || null,
    details: asText(component.getFirstPropertyValue('description')) || null,
  };
}

function asText(value) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
