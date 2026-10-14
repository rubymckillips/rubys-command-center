import { createHash } from 'node:crypto';

export function createOAuth({clientId,clientSecret,redirectUri,fetchImpl=fetch}) {
  async function json(url,options={}) {
    const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('GitHub sign-in unavailable');
    return response.json();
  }
  return {
    authorizationUrl(state,verifier) {
      const url=new URL('https://github.com/login/oauth/authorize');
      url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,scope:'',state,
        code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
      return url.href;
    },
    async identity(code,verifier) {
      const result=await json('https://github.com/login/oauth/access_token',{
        method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,code,code_verifier:verifier}).toString(),
      });
      if(typeof result.access_token!=='string'||!result.access_token||result.error)throw new Error('GitHub sign-in failed');
      // Do not persist the provider token, email, or profile details beyond identity.
      const user=await json('https://api.github.com/user',{headers:{accept:'application/vnd.github+json',authorization:`Bearer ${result.access_token}`,'user-agent':'Rubys-Command-Center'}});
      return {id:user.id,login:user.login};
    },
  };
}
