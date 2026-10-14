import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('restores the session with cookies and includes CSRF on mutations without a Basic header',async()=>{
  const calls=[];
  vi.stubGlobal('fetch',async(url,options)=>{calls.push([url,options]);return {ok:true,status:200,json:async()=>url.endsWith('/session')?{user:{login:'member',role:'member'},csrfToken:'csrf-test'}:{items:[]}};});
  const api=await import('../client/src/api.js');
  expect((await api.session()).user.login).toBe('member');
  await api.createItem({section:'tasks',title:'Test'});
  expect(calls[0][1].credentials).toBe('same-origin');
  expect(calls[1][1].headers['x-csrf-token']).toBe('csrf-test');
  expect(calls[1][1].headers.Authorization).toBeUndefined();
});
it('notifies the UI when a session is no longer authorized',async()=>{
  const unauthorized=vi.fn();
  vi.stubGlobal('fetch',async()=>({ok:false,status:401,json:async()=>({error:{code:'unauthorized',message:'Authentication required'}})}));
  const api=await import('../client/src/api.js');
  api.setUnauthorizedHandler(unauthorized);
  await expect(api.session()).rejects.toMatchObject({code:'unauthorized'});
  expect(unauthorized).toHaveBeenCalledOnce();
});
