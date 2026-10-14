import {expect,it} from 'vitest';
import {serverSecurityOptionsFromEnvironment} from '../server/env.js';
const configured={NODE_ENV:'production',OWNER_GITHUB_ID:'100',GITHUB_CLIENT_ID:'test',GITHUB_CLIENT_SECRET:'test-secret',FRONTEND_ORIGIN:'https://app.example.test',GITHUB_REDIRECT_URI:'https://app.example.test/api/auth/github/callback',RENDER_GIT_COMMIT:'a'.repeat(40)};
it('requires OAuth settings even when old Basic credentials are present',()=>{
  expect(()=>serverSecurityOptionsFromEnvironment({NODE_ENV:'production',BASIC_AUTH_USERNAME:'old',BASIC_AUTH_PASSWORD:'old'})).toThrow(/GitHub/);
  expect(serverSecurityOptionsFromEnvironment(configured).oauth.ownerGithubId).toBe('100');
  expect(()=>serverSecurityOptionsFromEnvironment({...configured,GITHUB_REDIRECT_URI:'https://attacker.example/callback'})).toThrow(/callback/);
  expect(()=>serverSecurityOptionsFromEnvironment({...configured,OWNER_GITHUB_ID:'first-user'})).toThrow(/GitHub/);
});
