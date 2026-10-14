import { createHash, randomBytes } from 'node:crypto';
import { withTransaction } from '../db.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export function createIdentityRepository(pool, ownerGithubId) {
  if (!/^\d+$/.test(String(ownerGithubId))) throw new Error('A numeric owner GitHub ID is required');
  const ownerId = `github:${ownerGithubId}`;
  const userView = row => row && ({id:row.id,login:row.login,role:row.id===ownerId?'owner':'member',suspended:row.suspended});
  return {
    async ensureOwner() {
      await withTransaction(pool,async client=>{
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('legacy-owner-claim',0))");
        // Identity itself is stable even if the GitHub login is renamed.
        await client.query('INSERT INTO users(id,github_id,login) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[ownerId,String(ownerGithubId),'owner']);
        await client.query("UPDATE items SET workspace_id=$1 WHERE workspace_id='legacy'",[ownerId]);
        await client.query("UPDATE activity_events SET workspace_id=$1 WHERE workspace_id='legacy'",[ownerId]);
      });
    },
    async upsertUser(profile) {
      if (!Number.isSafeInteger(profile.id)||profile.id<=0||typeof profile.login!=='string'||!profile.login||profile.login.length>100) throw new Error('Invalid GitHub identity');
      const result=await pool.query(`INSERT INTO users(id,github_id,login) VALUES($1,$2,$3)
        ON CONFLICT(github_id) DO UPDATE SET login=EXCLUDED.login RETURNING *`,[`github:${profile.id}`,String(profile.id),profile.login]);
      return result.rows[0].suspended?null:userView(result.rows[0]);
    },
    async createSession(userId) {
      const raw=token(),csrfToken=token();
      await pool.query("DELETE FROM sessions WHERE expires_at<=NOW()");
      const result=await pool.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at)
        SELECT $1,id,$3,NOW()+INTERVAL '7 days' FROM users WHERE id=$2 AND suspended=FALSE RETURNING expires_at`,[digest(raw),userId,csrfToken]);
      if (!result.rowCount) throw new Error('User cannot sign in');
      return {token:raw,csrfToken};
    },
    async session(raw) {
      if(typeof raw!=='string'||!/^[\w-]{43}$/.test(raw)) return null;
      const result=await pool.query(`SELECT u.*,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.suspended=FALSE`,[digest(raw)]);
      const row=result.rows[0];
      return row?{user:userView(row),csrfToken:row.csrf_token}:null;
    },
    async revoke(raw) {if(raw)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[digest(raw)]);},
    async beginOAuth() {
      const state=token(),binding=token(),verifier=token();
      await pool.query('DELETE FROM oauth_attempts WHERE expires_at<=NOW()');
      await pool.query("INSERT INTO oauth_attempts VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')",[digest(state),digest(binding),verifier]);
      return {state,binding,verifier};
    },
    async consumeOAuth(state,binding) {
      if(typeof state!=='string'||typeof binding!=='string'||!/^[\w-]{43}$/.test(state)||!/^[\w-]{43}$/.test(binding))return null;
      const result=await pool.query('DELETE FROM oauth_attempts WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>NOW() RETURNING verifier',[digest(state),digest(binding)]);
      return result.rows[0]?.verifier??null;
    },
    async members(){return (await pool.query("SELECT * FROM users WHERE github_id IS NOT NULL ORDER BY created_at,id")).rows.map(userView);},
    async setSuspended(id,suspended){
      if(id===ownerId)throw new Error('Owner access cannot be suspended');
      return withTransaction(pool,async client=>{
        const result=await client.query('UPDATE users SET suspended=$2 WHERE id=$1 AND github_id IS NOT NULL RETURNING *',[id,suspended]);
        if(suspended)await client.query('DELETE FROM sessions WHERE user_id=$1',[id]);
        return userView(result.rows[0])??null;
      });
    },
  };
}
