import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatMoney,todayInNairobi} from '../apps/web/src/view-format';

test('Money display preserves cents above JavaScript safe-number precision',()=>{
 assert.equal(formatMoney('9999999999999999.99'),'9,999,999,999,999,999.99');
 assert.equal(formatMoney('999999999999999999.99'),'999,999,999,999,999,999.99');
 assert.equal(formatMoney('1000000000000000000000000.01'),'1,000,000,000,000,000,000,000,000.01');
});
test('Money display handles grouping, signed balances and padded cents exactly',()=>{
 for(const [input,output] of [['0','0.00'],['12.5','12.50'],['1000.01','1,000.01'],['-1234567.89','-1,234,567.89'],['-0.01','-0.01'],['-0.00','0.00']])assert.equal(formatMoney(input),output);
});
test('Money display never silently rounds or coerces malformed/unsafe numeric values',()=>{
 for(const value of ['','1'.repeat(129),' 1.00','1e3','1,000.00','+1','01','1.234',null,undefined,{},NaN,Infinity,0.1,9007199254740992])assert.equal(formatMoney(value),'Invalid amount');
});
test('Money display accepts exact safe-integer fallback values only',()=>{assert.equal(formatMoney(0),'0.00');assert.equal(formatMoney(-1234),'-1,234.00');assert.equal(formatMoney(9007199254740991),'9,007,199,254,740,991.00');});
test('Money display round-trips 4000 signed arbitrary-precision cent amounts',()=>{
 let seed=317n;for(let i=0;i<4000;i++){seed=(seed*6364136223846793005n+1442695040888963407n)%(10n**32n);const cents=i%3===0?-seed:seed,absolute=cents<0n?-cents:cents,raw=(cents<0n?'-':'')+(absolute/100n).toString()+'.'+(absolute%100n).toString().padStart(2,'0'),text=formatMoney(raw);assert.match(text,/^-?(?:0|[1-9]\d{0,2}(?:,\d{3})*)\.\d{2}$/);assert.equal(BigInt(text.replaceAll(',','').replace('.','')),cents);}
});
test('Nairobi default business date respects midnight, year and leap-day boundaries',()=>{
 assert.equal(todayInNairobi(new Date('2026-09-26T20:59:59Z')),'2026-09-26');assert.equal(todayInNairobi(new Date('2026-09-26T21:00:00Z')),'2026-09-27');assert.equal(todayInNairobi(new Date('2026-12-31T21:00:00Z')),'2027-01-01');assert.equal(todayInNairobi(new Date('2028-02-28T21:00:00Z')),'2028-02-29');assert.throws(()=>todayInNairobi(new Date('invalid')));
});
