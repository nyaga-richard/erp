const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),fsp=require('fs/promises'),path=require('path'),os=require('os');
const {randomBytes}=require('crypto'),{Pool}=require('pg'),{execFileSync}=require('child_process');
const {backup,restore}=require('./ops.cjs');
test('encrypted database and file recovery drill with refusal cases',{timeout:120000},async t=>{
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'erp-ops-test-'));process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('hex');
 const url=new URL(process.env.MIGRATION_DATABASE_URL),adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=new Pool({connectionString:adminUrl.toString()}),target='erp_restore_test_'+Date.now();
 const failures=[];async function check(name,fn){await t.test(name,async()=>{try{await fn()}catch(e){failures.push(name);throw e;}});}
 try{
  let result;
  await check('database dump uses authenticated encryption and original snapshot counts',async()=>{const b=await backup('database',path.join(dir,'db.erpbackup'));assert.equal(b.manifest.encrypted,true);assert.ok(b.manifest.databaseCounts);assert.equal(fs.readFileSync(b.backup).subarray(0,8).toString(),'ERPBAK01');result=await restore('database',b.backup,target,'--confirm-restore');assert.equal(result.restored,true);assert.equal(result.journalArithmetic,'PASS');assert.deepEqual(result.counts,b.manifest.databaseCounts);});
  await check('restored runtime can read while posted data remains immutable',async()=>{const runtime=new URL(process.env.DATABASE_URL);runtime.pathname='/'+target;const p=new Pool({connectionString:runtime.toString()});try{const r=await p.query('SELECT count(*) FROM schema_migrations');assert.ok(Number(r.rows[0].count)>0);const heartbeats=(await p.query("SELECT last_seen_at>now()-interval '60 seconds' AS fresh FROM service_heartbeats")).rows;assert.ok(heartbeats.every(h=>!h.fresh),'Restoration must not replay a live-worker heartbeat');await assert.rejects(()=>p.query("UPDATE journal_lines SET debit='999.00'"));}finally{await p.end();}});
  await check('restore refuses existing database, live database names, missing confirmation and damaged backup',async()=>{
   const b=path.join(dir,'db.erpbackup');await assert.rejects(()=>restore('database',b,target,'--confirm-restore'),/already exists/);await assert.rejects(()=>restore('database',b,'erp','--confirm-restore'),/name must start/);await assert.rejects(()=>restore('database',b,'erp_restore_safe',''),/confirm/);
   const bad=path.join(dir,'damaged.erpbackup');await fsp.copyFile(b,bad);await fsp.copyFile(b+'.manifest.json',bad+'.manifest.json');await fsp.appendFile(bad,'corrupt');await assert.rejects(()=>restore('database',bad,'erp_restore_bad','--confirm-restore'),/checksum/);
   const original=process.env.BACKUP_ENCRYPTION_KEY;process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('hex');try{await assert.rejects(()=>restore('database',b,'erp_restore_bad_key','--confirm-restore'));}finally{process.env.BACKUP_ENCRYPTION_KEY=original;}
  });
  await check('encrypted file backup restores exact content and refuses overwrites',async()=>{
   const root=path.join(dir,'storage');await fsp.mkdir(root);await fsp.mkdir(path.join(root,'nested'));await fsp.writeFile(path.join(root,'nested','fixture.txt'),'Private test file\n');process.env.FILE_STORAGE_ROOT=root;
   const b=await backup('files',path.join(dir,'files.erpbackup')),dest=path.join(dir,'restored-files');await restore('files',b.backup,dest,'--confirm-restore');assert.equal(await fsp.readFile(path.join(dest,'nested','fixture.txt'),'utf8'),'Private test file\n');await assert.rejects(()=>restore('files',b.backup,dest,'--confirm-restore'));
   await fsp.symlink('/etc/passwd',path.join(root,'unsafe-link'));await assert.rejects(()=>backup('files',path.join(dir,'unsafe.erpbackup')));
  });
  await check('archive traversal is rejected before destination creation',async()=>{
   const tar=path.join(dir,'evil.tar');execFileSync('python3',['-c',"import tarfile,io,sys\nwith tarfile.open(sys.argv[1],'w') as t:\n i=tarfile.TarInfo('../outside.txt');i.size=4;t.addfile(i,io.BytesIO(b'evil'))",tar]);
   const dest=path.join(dir,'evil-output');assert.throws(()=>execFileSync('python3',[path.join(__dirname,'file-archive.py'),'restore',tar,dest],{stdio:'pipe'}));assert.equal(fs.existsSync(dest),false);assert.equal(fs.existsSync(path.join(dir,'outside.txt')),false);
  });
  fs.mkdirSync('docs/backups',{recursive:true});fs.writeFileSync('docs/backups/restore-verification.json',JSON.stringify({passed:failures.length===0,failures,date:new Date().toISOString(),databaseEncryption:'AES-256-GCM',snapshotCounts:result?.counts,checks:['Restored real database into a new isolated database','Restored snapshot counts match export snapshot','Journal arithmetic balanced','Runtime privileges restored and posted writes denied','Restored worker heartbeat reset; fresh recovery worker required','Overwrite/live-database/missing-confirmation rejected','Corruption/wrong-key rejected','File content restored exactly','Symlink and traversal rejected'],operationalReconciliations:'NOT_IMPLEMENTED',productionHostTested:false},null,2));
 }finally{await admin.query('DROP DATABASE IF EXISTS '+target);await admin.end();await fsp.rm(dir,{recursive:true,force:true});}
});
