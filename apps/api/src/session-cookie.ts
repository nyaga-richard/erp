import type {CookieOptions} from 'express';

/** Explicit deployment choice; never infer a relaxed cookie policy from a request header. */
export function sessionCookieOptions(env:Record<string,string|undefined>=process.env):CookieOptions {
 const mode=env.SESSION_COOKIE_MODE??'strict';
 if(!['strict','partitioned'].includes(mode))throw new Error('SESSION_COOKIE_MODE must be strict or partitioned.');
 const secure=env.COOKIE_SECURE==='true';
 if((mode==='partitioned'||env.NODE_ENV==='production')&&!secure)throw new Error('Secure session cookies are required for embedded previews and production.');
 return {httpOnly:true,secure,sameSite:mode==='partitioned'?'none':'strict',...(mode==='partitioned'?{partitioned:true}:{}),path:'/'};
}

/** Separate namespace prevents an old unpartitioned cookie shadowing the preview login. */
export function sessionCookieName(env:Record<string,string|undefined>=process.env){return env.SESSION_COOKIE_MODE==='partitioned'?'__Host-erp_preview':'erp_session';}
