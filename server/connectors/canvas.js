import { fetchFeed, parseIcal } from './ical.js';

export async function syncCanvas({ url, fetchImpl, itemsRepository, now, upcomingDays } = {}) {
  const text = await fetchFeed(url, fetchImpl);
  const records = parseIcal(text, { source: 'canvas', now, upcomingDays });
  return upsertRecords({ itemsRepository, records, source: 'canvas', section: 'academics', kind: 'assignment' });
}

export async function upsertRecords({ itemsRepository, records, source, section, kind }) {
  const existingSourceIds = new Set(
    (await itemsRepository.list({ section }))
      .filter((item) => item.source === source && item.sourceId)
      .map((item) => item.sourceId),
  );
  const result = { imported: 0, updated: 0, skipped: 0, stale: 0, error: null };

  for (const record of records) {
    if (!record.sourceId || !record.title || !record.dueAt) {
      result.skipped += 1;
      continue;
    }
    const key = record.sourceId;
    await itemsRepository.upsertSource({
      kind,
      section,
      source: record.source,
      sourceId: record.sourceId,
      title: record.title,
      dueAt: record.dueAt,
      className: record.className,
      sourceUrl: record.sourceUrl,
      sourceDetails: record.details,
      syncState: 'synced',
    });
    if (existingSourceIds.has(key)) result.updated += 1;
    else result.imported += 1;
  }
  result.stale = await itemsRepository.markSourceRecordsAbsent(source, records.map((record) => record.sourceId).filter(Boolean));
  return result;
}
