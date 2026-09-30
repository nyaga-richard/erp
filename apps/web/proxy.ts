import {NextRequest,NextResponse} from 'next/server';
export function proxy(request:NextRequest){
 const headers=new Headers(request.headers);
 const responseHeaders=new Headers({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
 if(process.env.NODE_ENV==='production'){
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
  const csp=`default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',csp);responseHeaders.set('Content-Security-Policy',csp);
 }
 const response=NextResponse.next({request:{headers}});responseHeaders.forEach((value,key)=>response.headers.set(key,value));return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
