import path from 'node:path';
import {fileURLToPath} from 'node:url';
const backend=process.env.API_INTERNAL_URL??'http://127.0.0.1:3000';
const url=new URL(backend);
if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('API_INTERNAL_URL must be a credential-free HTTP(S) origin');
export default {
 output:'standalone',poweredByHeader:false,devIndicators:false,
 // Preview proxies may not forward WebSockets. Hydration must not depend on the development debug channel.
 experimental:{reactDebugChannel:false},
 outputFileTracingRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),
 allowedDevOrigins:['*.e2b.app','localhost','127.0.0.1'],
 async rewrites(){return [{source:'/api/:path*',destination:backend.replace(/\/$/,'')+'/api/:path*'}];},
};
