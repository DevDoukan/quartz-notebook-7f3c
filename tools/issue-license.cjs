'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i]]=process.argv[i+1];
if(!args['--key']||!args['--installation']||!args['--customer']||!args['--out'])throw Error('Kullanım: node tools/issue-license.cjs --key özel-anahtar.pem --installation kurulum-kimliği --customer müşteri --days 365 --out lisans.json');
const days=Number(args['--days']||365);if(!Number.isInteger(days)||days<1||days>3650)throw Error('Lisans süresi 1–3650 gün olmalı.');
const now=Date.now(),claims={schema:1,product:'kalkan-dlp',installationId:args['--installation'],customer:args['--customer'],licenseId:crypto.randomUUID(),plan:'Business',issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+days*86400000).toISOString()};
const raw=Buffer.from(JSON.stringify(claims)),document={payload:raw.toString('base64url'),signature:crypto.sign(null,raw,fs.readFileSync(args['--key'])).toString('base64url')};
fs.mkdirSync(path.dirname(path.resolve(args['--out'])),{recursive:true});fs.writeFileSync(args['--out'],JSON.stringify(document,null,2),{flag:'wx'});
console.log('Kuruluma özel imzalı lisans üretildi.');
