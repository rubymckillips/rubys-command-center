import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { createApp } from '../server/app.js';
import { openTestDatabase } from './postgres.js';

const origin='http://localhost:5173';
const cookie=res=>res.headers.getSetCookie().map(x=>x.split(';')[0]).filter(x=>!x.endsWith('=')).join('; ');
async function fixture(){
  const db=await openTestDatabase();
  let identity={id:100,login:'owner'},challenge;
  const fetchImpl=async(url,options)=>{
    if(url==='https://github.com/login/oauth/access_token'){
      const body=new URLSearchParams(options.body);
      if(createHash('sha256').update(body.get('code_verifier')).digest('base64url')!==challenge)throw new Error('PKCE mismatch');
      if(body.get('code')==='provider-fails')return new Response('{}',{status:502});
      return Response.json({access_token:'external-test-token',token_type:'bearer',scope:''});
    }
    if(url==='https://api.github.com/user')return Response.json(identity);
    throw new Error('Unexpected provider URL');
  };
  const options={pool:db.pool,frontendOrigin:origin,commit:'a'.repeat(40),logger:()=>{},oauth:{clientId:'test-client',clientSecret:'test-secret',redirectUri:`${origin}/api/auth/github/callback`,ownerGithubId:'100',production:false,fetchImpl}};
  const {createIdentityRepository}=await import('../server/repositories/identity.js');
  await createIdentityRepository(db.pool,'100').ensureOwner();
  const server=createServer(createApp(options));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options={})=>fetch(base+path,{redirect:'manual',...options});
  async function begin(){
    const start=await request('/api/auth/github');
    expect(start.status).toBe(302);
    const url=new URL(start.headers.get('location'));
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('scope')).toBe('');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    challenge=url.searchParams.get('code_challenge');
    return {state:url.searchParams.get('state'),cookie:cookie(start)};
  }
  async function login(id=100){
    identity={id,login:id===100?'owner':'member'};
    const attempt=await begin();
    const callback=await request(`/api/auth/github/callback?state=${attempt.state}&code=ok`,{headers:{cookie:attempt.cookie}});
    expect(callback.status).toBe(303);
    const sessionCookie=cookie(callback);
    const session=await request('/api/auth/session',{headers:{cookie:sessionCookie}});
    expect(session.status).toBe(200);
    const payload=await session.json();
    return {cookie:sessionCookie,...payload,headers:{cookie:sessionCookie,origin,'x-csrf-token':payload.csrfToken,'content-type':'application/json'}};
  }
  return {db,request,begin,login,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}

describe('GitHub OAuth and server permissions',()=>{
  it('issues durable cookies, restores sessions, and rejects member administration and cross-workspace requests',async()=>{
    const f=await fixture();
    try {
      expect((await f.request('/api/health')).status).toBe(401);
      const basic=`Basic ${Buffer.from('test:password').toString('base64')}`;
      expect((await f.request('/api/health',{headers:{authorization:basic}})).status).toBe(401);
      const owner=await f.login();
      expect(owner.user.role).toBe('owner');
      expect((await f.request('/api/admin/members',{headers:owner.headers})).status).toBe(200);
      const added=await f.request('/api/items',{method:'POST',headers:owner.headers,body:JSON.stringify({section:'tasks',title:'Private owner task',workspace_id:'github:200'})});
      expect(added.status).toBe(201);
      const {item}=await added.json();
      const member=await f.login(200);
      expect(member.user.role).toBe('member');
      expect((await f.request('/api/admin/members',{headers:member.headers})).status).toBe(403);
      expect((await f.request('/api/admin/members/github:100',{method:'PATCH',headers:member.headers,body:'{"suspended":true}'})).status).toBe(403);
      expect((await (await f.request('/api/items?section=tasks',{headers:member.headers})).json()).items).toEqual([]);
      expect((await f.request(`/api/items/${item.id}`,{method:'PATCH',headers:member.headers,body:'{"title":"stolen"}'})).status).toBe(404);
      expect((await f.request('/api/items',{method:'POST',headers:{cookie:member.cookie,origin},body:'{}'})).status).toBe(403);
      expect((await f.request('/api/items',{method:'POST',headers:{...member.headers,origin:'https://attacker.example'},body:'{}'})).status).toBe(403);
      expect((await f.request('/api/admin/members/github:100',{method:'PATCH',headers:owner.headers,body:'{"suspended":true}'})).status).toBe(400);
      expect((await f.request('/api/admin/members/github:200',{method:'PATCH',headers:owner.headers,body:'{"suspended":true}'})).status).toBe(200);
      expect((await f.request('/api/health',{headers:member.headers})).status).toBe(401);
      expect((await f.request('/api/auth/logout',{method:'POST',headers:owner.headers})).status).toBe(200);
      expect((await f.request('/api/auth/session',{headers:{cookie:owner.cookie}})).status).toBe(401);
    }finally{await f.close();}
  });
  it('rejects missing binding, expired and replayed state without issuing a session',async()=>{
    const f=await fixture();
    try {
      const a=await f.begin();
      const path=`/api/auth/github/callback?state=${a.state}&code=ok`;
      const missing=await f.request(path);
      expect(missing.headers.getSetCookie().join('')).not.toContain('cc_session=');
      await f.db.pool.query("UPDATE oauth_attempts SET expires_at=NOW()-INTERVAL '1 second'");
      const expired=await f.request(path,{headers:{cookie:a.cookie}});
      expect(expired.headers.get('location')).toContain('signin=failed');
      const b=await f.begin();
      const fresh=`/api/auth/github/callback?state=${b.state}&code=ok`;
      const success=await f.request(fresh,{headers:{cookie:b.cookie}});
      expect(success.headers.getSetCookie().join('')).toContain('cc_session=');
      const replay=await f.request(fresh,{headers:{cookie:b.cookie}});
      expect(replay.headers.getSetCookie().join('')).not.toContain('cc_session=');
      expect(replay.headers.get('location')).toContain('signin=failed');
      const c=await f.begin();
      const failed=await f.request(`/api/auth/github/callback?state=${c.state}&code=provider-fails`,{headers:{cookie:c.cookie}});
      expect(failed.headers.getSetCookie().join('')).not.toContain('cc_session=');
      expect(failed.headers.get('location')).toContain('signin=failed');
    }finally{await f.close();}
  });
});
