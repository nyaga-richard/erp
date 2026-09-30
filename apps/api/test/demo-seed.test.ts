import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoFiscalYears} from '../src/seed';

test('demo seed creates the prior, current and next fiscal years',()=>{
 assert.deepEqual(demoFiscalYears(2026),[2025,2026,2027]);
});

test('demo fiscal-year helper stays within valid database dates',()=>{
 assert.deepEqual(demoFiscalYears(1),[1,2]);
 assert.deepEqual(demoFiscalYears(9999),[9998,9999]);
});
