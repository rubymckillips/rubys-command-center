import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openTestDatabase } from './postgres.js';
import { createIdentityRepository } from '../server/repositories/identity.js';
import { createItemsRepository } from '../server/repositories/items.js';
import { createActivityRepository } from '../server/repositories/activity.js';
import {migrate} from '../server/migrate.js';

describe('private workspaces and durable identity', () => {
  it('preserves legacy rows for the configured owner and isolates every workspace operation', async () => {
    const db = await openTestDatabase({legacy:true});
    try {
      await db.pool.query("INSERT INTO items(id,kind,section,title,in_today,today_position) VALUES('existing','local','tasks','Existing entry',TRUE,0)");
      await db.pool.query("INSERT INTO activity_events(item_id,action,section,occurred_at) VALUES('existing','created','tasks','2026-10-14T00:00:00Z')");
      const old={id:'existing'};
      await migrate(db.pool);
      const identities = createIdentityRepository(db.pool, '100');
      await identities.ensureOwner();
      await identities.ensureOwner();
      const owner = await identities.upsertUser({id:100,login:'owner'});
      const member = await identities.upsertUser({id:200,login:'member'});
      const ownerItems = createItemsRepository(db.pool, createActivityRepository(db.pool,owner.id), owner.id);
      const memberEvents = createActivityRepository(db.pool,member.id);
      const memberItems = createItemsRepository(db.pool,memberEvents,member.id);
      expect((await ownerItems.list({section:'tasks'})).map(x=>x.title)).toEqual(['Existing entry']);
      expect((await createActivityRepository(db.pool,owner.id).list())[0].occurredAt).toBe('2026-10-14T00:00:00Z');
      expect(await memberItems.list({section:'tasks'})).toEqual([]);
      expect(await memberItems.list({todayOnly:true})).toEqual([]);
      expect(await memberItems.update(old.id,{title:'stolen'})).toBeNull();
      expect(await memberItems.setToday(old.id,false)).toBeNull();
      expect(await memberItems.remove(old.id)).toBeNull();
      await expect(memberItems.reorder('tasks',[old.id])).rejects.toThrow();
      const own = await memberItems.create({section:'tasks',title:'Member entry',inToday:true});
      expect((await memberItems.list({todayOnly:true})).map(x=>x.id)).toEqual([own.id]);
      expect((await ownerItems.list({todayOnly:true})).map(x=>x.id)).toEqual([old.id]);
      expect((await memberEvents.list()).every(x=>x.itemId===own.id)).toBe(true);
      const source={section:'calendar',source:'google-calendar',sourceId:'same',title:'Imported'};
      await ownerItems.upsertSource(source);
      await memberItems.upsertSource(source);
      expect((await ownerItems.list({section:'calendar'}))).toHaveLength(1);
      expect((await memberItems.list({section:'calendar'}))).toHaveLength(1);
      await memberItems.markSourceRecordsAbsent('google-calendar',[]);
      expect((await ownerItems.list({section:'calendar'}))[0].syncState).toBe('synced');
    } finally { await db.close(); }
  });

  it('stores only token hashes and revokes expired, logged-out, and suspended sessions', async()=>{
    const db=await openTestDatabase();
    try {
      const identities=createIdentityRepository(db.pool,'100');
      await identities.ensureOwner();
      const member=await identities.upsertUser({id:200,login:'member'});
      const session=await identities.createSession(member.id);
      const row=(await db.pool.query('SELECT token_hash FROM sessions')).rows[0];
      expect(row.token_hash).toBe(createHash('sha256').update(session.token).digest('hex'));
      expect((await identities.session(session.token)).user.role).toBe('member');
      expect(await createIdentityRepository(db.pool,'100').session(session.token)).toBeTruthy();
      await db.pool.query("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second'");
      expect(await identities.session(session.token)).toBeNull();
      const next=await identities.createSession(member.id);
      await identities.revoke(next.token);
      expect(await identities.session(next.token)).toBeNull();
      const suspended=await identities.createSession(member.id);
      await identities.setSuspended(member.id,true);
      expect(await identities.session(suspended.token)).toBeNull();
      expect(await identities.upsertUser({id:200,login:'member'})).toBeNull();
      await expect(identities.setSuspended('github:100',true)).rejects.toThrow();
    } finally {await db.close();}
  });
});
