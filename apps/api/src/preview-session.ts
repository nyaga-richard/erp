/** Explicitly opt-in development transport. Never enable this in production. */
export function previewMemorySessionsEnabled(env:Record<string,string|undefined>=process.env):boolean {
 const value=env.ENABLE_PREVIEW_MEMORY_SESSION??'false';
 if(!['true','false'].includes(value))throw new Error('ENABLE_PREVIEW_MEMORY_SESSION must be true or false.');
 if(value==='true'&&env.NODE_ENV==='production')throw new Error('Preview memory sessions are forbidden in production.');
 return value==='true';
}
