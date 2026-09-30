'use client';
import dynamic from 'next/dynamic';
const Workspace=dynamic(()=>import('../src/main'),{ssr:false,loading:()=> <main aria-busy="true"><p role="status">Loading your secure workspace…</p></main>});
export default Workspace;
