import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { syncCanvas } from '../server/connectors/canvas.js';
import { syncGoogleCalendar } from '../server/connectors/google-calendar.js';
import { FeedError, fetchFeed, parseIcal } from '../server/connectors/ical.js';
import { createItemsRepository } from '../server/repositories/items.js';
import { openTestDatabase } from './postgres.js';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const fixedNow = new Date('2026-09-29T12:00:00Z');
const testAuthorization = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`;

function feed(text) {
  return async () => new Response(text, { status: 200 });
}

describe('iCal connectors', () => {
  const closers = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function repository() {
    const database = await openTestDatabase();
    closers.push(database.close);
    return createItemsRepository(database.pool);
  }

  it('normalizes multiple Canvas events with stable IDs, escaped text, and timezone-aware due dates', async () => {
    const records = parseIcal(await fixture('canvas.ics'), { source: 'canvas', now: fixedNow });
    expect(records).toEqual([
      expect.objectContaining({
        source: 'canvas', sourceId: 'canvas-assignment-101', title: 'Problem Set 2, command center',
        dueAt: '2026-10-02T18:00:00.000Z', className: 'SI 212',
        sourceUrl: 'https://canvas.example.test/courses/212/assignments/101',
        details: 'Build the server\nthen submit it.',
      }),
      expect.objectContaining({
        source: 'canvas', sourceId: 'canvas-assignment-102', title: 'Read chapter 4',
        dueAt: '2026-10-05T13:00:00.000Z', className: 'SI 212',
      }),
    ]);
  });

  it('normalizes Google events with their calendar name as common source metadata', async () => {
    const records = parseIcal(await fixture('google-calendar.ics'), { source: 'google-calendar', now: fixedNow });
    expect(records).toEqual([
      expect.objectContaining({
        source: 'google-calendar', sourceId: 'google-event-201', title: 'Career fair, North Campus',
        dueAt: '2026-10-03T18:00:00.000Z', className: 'Personal Calendar',
      }),
      expect.objectContaining({
        sourceId: 'google-event-202', dueAt: '2026-10-07T16:00:00.000Z', className: 'Personal Calendar',
      }),
    ]);
  });

  it('rejects malformed feeds and turns network and status failures into FeedError instances', async () => {
    expect(() => parseIcal('not an iCalendar feed', { source: 'canvas', now: fixedNow })).toThrow(FeedError);
    await expect(fetchFeed('https://feed.example.test', async () => { throw new Error('offline'); })).rejects.toBeInstanceOf(FeedError);
    await expect(fetchFeed('https://feed.example.test', async () => new Response('nope', { status: 503 }))).rejects.toBeInstanceOf(FeedError);
  });

  it('upserts Canvas records by stable source ID while preserving local annotations', async () => {
    const items = await repository();
    const first = await syncCanvas({ url: 'https://feed.example.test/canvas', fetchImpl: feed(await fixture('canvas.ics')), itemsRepository: items, now: fixedNow });
    expect(first).toMatchObject({ imported: 2, updated: 0, skipped: 0, error: null });
    const imported = (await items.list({ section: 'academics' }))[0];
    await items.update(imported.id, { notes: 'My study plan', completed: true });

    const changedFeed = (await fixture('canvas.ics')).replace('Problem Set 2\\, command center', 'Problem Set 2 revised');
    const second = await syncCanvas({ url: 'https://feed.example.test/canvas', fetchImpl: feed(changedFeed), itemsRepository: items, now: fixedNow });
    expect(second).toMatchObject({ imported: 0, updated: 2, skipped: 0, error: null });
    expect((await items.list({ section: 'academics' }))[0]).toMatchObject({
      source: 'canvas', sourceId: 'canvas-assignment-101', title: 'Problem Set 2 revised',
      notes: 'My study plan', completed: true, sourceDetails: 'Build the server\nthen submit it.',
    });
  });

  it('preserves source details and marks records absent from a successful Canvas feed as stale', async () => {
    const items = await repository();
    await syncCanvas({ url: 'https://feed.example.test/canvas', fetchImpl: feed(await fixture('canvas.ics')), itemsRepository: items, now: fixedNow });

    const reducedFeed = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:canvas-assignment-101\nDTSTART:20261002T180000Z\nSUMMARY:Problem Set 2\\, command center\nDESCRIPTION:Build the server\\nthen submit it.\nX-CANVAS-COURSE-NAME:SI 212\nURL:https://canvas.example.test/courses/212/assignments/101\nEND:VEVENT\nEND:VCALENDAR`;
    const result = await syncCanvas({ url: 'https://feed.example.test/canvas', fetchImpl: feed(reducedFeed), itemsRepository: items, now: fixedNow });

    expect(result).toMatchObject({ imported: 0, updated: 1, skipped: 0, stale: 1, error: null });
    expect(await items.list({ section: 'academics' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'canvas-assignment-101', sourceDetails: 'Build the server\nthen submit it.', syncState: 'synced' }),
      expect.objectContaining({ sourceId: 'canvas-assignment-102', syncState: 'stale' }),
    ]));
  });

  it('syncs Google Calendar records into the calendar section and leaves old records untouched after a failed feed', async () => {
    const items = await repository();
    const result = await syncGoogleCalendar({ url: 'https://feed.example.test/google', fetchImpl: feed(await fixture('google-calendar.ics')), itemsRepository: items, now: fixedNow });
    expect(result).toMatchObject({ imported: 2, updated: 0, skipped: 0, error: null });
    const beforeFailure = await items.list({ section: 'calendar' });
    await expect(syncGoogleCalendar({
      url: 'https://feed.example.test/google', fetchImpl: async () => new Response('bad', { status: 500 }), itemsRepository: items, now: fixedNow,
    })).rejects.toBeInstanceOf(FeedError);
    expect(await items.list({ section: 'calendar' })).toEqual(beforeFailure);
  });

  it('leaves existing Canvas records untouched when feed parsing fails', async () => {
    const items = await repository();
    await syncCanvas({ url: 'https://feed.example.test/canvas', fetchImpl: feed(await fixture('canvas.ics')), itemsRepository: items, now: fixedNow });
    const beforeFailure = await items.list({ section: 'academics' });

    await expect(syncCanvas({
      url: 'https://feed.example.test/canvas', fetchImpl: feed('not an iCalendar feed'), itemsRepository: items, now: fixedNow,
    })).rejects.toBeInstanceOf(FeedError);

    expect(await items.list({ section: 'academics' })).toEqual(beforeFailure);
  });

  it('returns sync counts and a safe error message through both HTTP sync routes', async () => {
    const database = await openTestDatabase();
    closers.push(database.close);
    const canvasFeed = await fixture('canvas.ics');
    const calendarFeed = await fixture('google-calendar.ics');
    const server = createServer(createApp({
      pool: database.pool,
      auth: { username: 'test-user', password: 'test-password' },
      commit: 'a'.repeat(40),
      connectors: {
        canvas: ({ itemsRepository }) => syncCanvas({ url: 'https://feed.example.test/canvas', fetchImpl: feed(canvasFeed), itemsRepository, now: fixedNow }),
        googleCalendar: ({ itemsRepository }) => syncGoogleCalendar({ url: 'https://feed.example.test/google', fetchImpl: feed(calendarFeed), itemsRepository, now: fixedNow }),
      },
    }));
    await new Promise((resolve) => server.listen(0, resolve));
    closers.push(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const canvas = await fetch(`${baseUrl}/api/sync/canvas`, { method: 'POST', headers: { authorization: testAuthorization } });
    expect(await canvas.json()).toMatchObject({ imported: 2, updated: 0, skipped: 0, error: null });
    const calendar = await fetch(`${baseUrl}/api/sync/google-calendar`, { method: 'POST', headers: { authorization: testAuthorization } });
    expect(await calendar.json()).toMatchObject({ imported: 2, updated: 0, skipped: 0, error: null });
  });
});
