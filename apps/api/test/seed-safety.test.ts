import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {seed} from '../src/seed';

test('Development seed is forbidden in production before any database connection',async()=>{
 const previous=process.env.NODE_ENV,connect=Pool.prototype.connect;let connections=0;
 process.env.NODE_ENV='production';
 (Pool.prototype as any).connect=async()=>{connections++;throw new Error('Database must not be contacted by a production demo seed');};
 try{await assert.rejects(seed('postgresql://unused@127.0.0.1:1/unused','Test-Only-Password-Not-A-Credential!'),/Development demo seed is forbidden in production/);assert.equal(connections,0);}
 finally{Pool.prototype.connect=connect;if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
