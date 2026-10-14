import { timingSafeEqual } from 'node:crypto';
import { createIdentityRepository } from './repositories/identity.js';
import { createOAuth } from './oauth.js';

function cookies(request) {
  const result={};
  for(const entry of (request.headers.cookie??'').split(';')){
    const index=entry.indexOf('=');
    if(index>0)result[entry.slice(0,index).trim()]=entry.slice(index+1).trim();
  }
  return result;
}
const send=(res,status,payload)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));};
const error=(res,status,message)=>send(res,status,{error:{code:status===401?'unauthorized':status===403?'forbidden':'invalid_request',message}});
function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export function createAuthRoutes({pool,oauth,frontendOrigin}) {
  const identities=createIdentityRepository(pool,oauth.ownerGithubId);
  const provider=createOAuth(oauth);
  const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${oauth.production?'; Secure':''}`;
  const redirect=(res,url,status=303)=>{res.writeHead(status,{location:url,'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();};
  const authenticate=req=>identities.session(cookies(req).cc_session);
  function validateMutation(req,res,session){
    if(req.headers.origin!==frontendOrigin||!equal(req.headers['x-csrf-token'],session.csrfToken)){
      error(res,403,'This request could not be verified');return false;
    }
    return true;
  }
  return {
    authenticate,validateMutation,
    async handle(req,res,url){
      const path=url.pathname;
      if(req.method==='GET'&&path==='/api/auth/github'){
        const attempt=await identities.beginOAuth();
        res.setHeader('Set-Cookie',cookie('cc_oauth',attempt.binding,600));
        redirect(res,provider.authorizationUrl(attempt.state,attempt.verifier),302);return true;
      }
      if(req.method==='GET'&&path==='/api/auth/github/callback'){
        res.setHeader('Set-Cookie',cookie('cc_oauth','',0));
        try {
          const verifier=await identities.consumeOAuth(url.searchParams.get('state'),cookies(req).cc_oauth);
          const code=url.searchParams.get('code');
          if(!verifier||!code||code.length>1024||url.searchParams.has('error'))throw new Error('Invalid sign-in attempt');
          const profile=await provider.identity(code,verifier);
          const user=await identities.upsertUser(profile);
          if(!user)throw new Error('Access suspended');
          await identities.revoke(cookies(req).cc_session);
          const session=await identities.createSession(user.id);
          res.setHeader('Set-Cookie',[cookie('cc_oauth','',0),cookie('cc_session',session.token,604800)]);
          redirect(res,frontendOrigin+'/');
        }catch{redirect(res,frontendOrigin+'/?signin=failed');}
        return true;
      }
      if(!path.startsWith('/api/auth/')&&!path.startsWith('/api/admin/'))return false;
      const session=await authenticate(req);
      if(!session){error(res,401,'Authentication required');return true;}
      if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!validateMutation(req,res,session))return true;
      if(path==='/api/auth/session'&&req.method==='GET'){send(res,200,session);return true;}
      if(path==='/api/auth/logout'&&req.method==='POST'){
        await identities.revoke(cookies(req).cc_session);
        res.setHeader('Set-Cookie',cookie('cc_session','',0));send(res,200,{ok:true});return true;
      }
      if(path.startsWith('/api/admin/')){
        if(session.user.role!=='owner'){error(res,403,'Owner access required');return true;}
        if(path==='/api/admin/members'&&req.method==='GET'){send(res,200,{members:await identities.members()});return true;}
        const match=path.match(/^\/api\/admin\/members\/([^/]+)$/);
        if(match&&req.method==='PATCH'){
          let body='';
          for await(const chunk of req){body+=chunk;if(body.length>4096){error(res,400,'Request too large');return true;}}
          let input;
          try{input=JSON.parse(body);}catch{error(res,400,'A JSON object is required');return true;}
          if(typeof input?.suspended!=='boolean'){error(res,400,'suspended must be a boolean');return true;}
          let member;
          try{member=await identities.setSuspended(decodeURIComponent(match[1]),input.suspended);}catch{error(res,400,'Owner access cannot be changed');return true;}
          if(!member){error(res,404,'Member not found');return true;}
          send(res,200,{member});return true;
        }
      }
      error(res,404,'Route not found');return true;
    },
  };
}
