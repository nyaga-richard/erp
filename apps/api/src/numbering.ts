import {PoolClient} from 'pg';
import {Context,BusinessError} from './db';
/** Must run inside the caller's business transaction; never independently commit a number. */
export async function allocateDocumentNumber(c:PoolClient,ctx:Context,branch:string,type:string,businessDate:string){
 const year=Number(businessDate.slice(0,4));if(!Number.isInteger(year)||year<1||year>9999)throw new BusinessError('NUMBERING_DATE','Business year is outside supported numbering range.');
 const cfg=(await c.query('SELECT * FROM numbering_format($1,$2,$3,$4)',[ctx.companyId,branch,type,year])).rows[0];
 if(!cfg)throw new BusinessError('NUMBERING_UNCONFIGURED','Document type has no released numbering configuration.');
 const row=(await c.query(`INSERT INTO document_sequences(company_id,branch_id,document_type,financial_year,prefix,padding,last_value) VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT(company_id,branch_id,document_type,financial_year) DO UPDATE SET last_value=document_sequences.last_value+1 RETURNING prefix,padding,last_value`,[ctx.companyId,branch,type,year,cfg.prefix,cfg.padding])).rows[0];
 return `${row.prefix}-${year}-${String(row.last_value).padStart(row.padding,'0')}`;
}
