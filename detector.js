'use strict';

function validTC(value) {
  const d = [...value].map(Number);
  return d.length === 11 && d[0] !== 0 &&
    (((d[0]+d[2]+d[4]+d[6]+d[8])*7-(d[1]+d[3]+d[5]+d[7])) % 10+10) % 10 === d[9] &&
    d.slice(0,10).reduce((a,b)=>a+b,0) % 10 === d[10];
}
function luhn(value) {
  if (/^(\d)\1+$/.test(value)) return false;
  let sum=0, double=false;
  for (let i=value.length-1;i>=0;i--) {
    let n=Number(value[i]);
    if (double && (n*=2)>9) n-=9;
    sum+=n; double=!double;
  }
  return sum % 10 === 0;
}
function validIBAN(value) {
  if (!/^TR\d{24}$/.test(value)) return false;
  let remainder=0;
  for (const c of value.slice(4)+value.slice(0,4)) {
    for (const n of /[A-Z]/.test(c) ? String(c.charCodeAt(0)-55) : c) remainder=(remainder*10+Number(n))%97;
  }
  return remainder===1;
}
const rules = [
  {id:'tc', label:'T.C. kimlik numarası', severity:'high', regex:/(?<!\d)[1-9]\d{10}(?!\d)/g, validate:validTC},
  {id:'card', label:'Kredi kartı numarası', severity:'high', regex:/(?<!\d)(?<!\d[ -])(?:\d[ -]?){12,18}\d(?![ -]?\d)/g, validate:v=>v.length>=13&&v.length<=19&&luhn(v)},
  {id:'iban', label:'Türkiye IBAN', severity:'high', regex:/\bTR\d{2}(?: ?\d){22}\b/gi, validate:validIBAN},
  {id:'email', label:'E-posta adresi', severity:'medium', regex:/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi},
  {id:'secret', label:'Olası parola / API anahtarı', severity:'high', regex:/\b(?:api[_-]?key|secret|password|parola|access[_-]?token)\s*[:=]\s*["']?[^\s"',;]{8,}/gi},
  {id:'confidential', label:'Gizlilik işareti', severity:'medium', regex:/\b(?:confidential|restricted)\b|çok gizli|kurum içi|ticari sır/gi}
];
function inspect(text, enabled=rules.map(r=>r.id)) {
  const findings=[];
  for (const rule of rules) {
    if (!enabled.includes(rule.id)) continue;
    rule.regex.lastIndex=0;
    let line=1, lastIndex=0;
    for (const match of text.matchAll(rule.regex)) {
      const normalized=match[0].replace(/[ -]/g,'').toUpperCase();
      if (rule.validate && !rule.validate(normalized)) continue;
      for(let newline=text.indexOf('\n',lastIndex);newline>=0&&newline<match.index;newline=text.indexOf('\n',newline+1)) line++;
      lastIndex=match.index;
      findings.push({type:rule.id,label:rule.label,severity:rule.severity,
        line, sample:'•••• (maskelendi)'});
      if (findings.length>=1000) return findings;
    }
  }
  return findings;
}
if (typeof module !== 'undefined') module.exports={inspect,rules,validTC,luhn,validIBAN};
else globalThis.DLP={inspect,rules,validTC,luhn,validIBAN};
