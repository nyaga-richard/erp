// Presentation only: preserve exact server decimal strings without binary-float
// conversion or silent rounding. Invalid API values remain visibly invalid.
export function formatMoney(value:unknown):string{
 const text=typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):'';
 if(text.length>128)return 'Invalid amount';
 const match=/^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
 if(!match)return 'Invalid amount';
 const [,sign,whole,fraction='']=match,cents=fraction.padEnd(2,'0');
 const negative=sign==='-'&&!(whole==='0'&&cents==='00');
 return (negative?'-':'')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+cents;
}
export const todayInNairobi=(date=new Date())=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
