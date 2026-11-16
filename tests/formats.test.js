'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),JSZip=require('jszip'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {extract,scanDirectory}=require('../scanner'),{inspect}=require('../detector');
async function workbook({shared='<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>42424242</t></r><r><t>42424242</t></r></si></sst>',sheet,extra}={}){
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 zip.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hassas Veriler" sheetId="1" r:id="rId1"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
 zip.file('xl/sharedStrings.xml',shared);zip.file('xl/worksheets/sheet1.xml',sheet||'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><r><t>42424242</t></r><r><t><![CDATA[42424242]]></t></r></is></c><c r="C1"><v>4.242424242424242E15</v></c><c r="D1" t="str"><f>"4242424242424242"</f><v>4242424242424242</v></c></row></sheetData></worksheet>');if(extra)for(const [name,data]of Object.entries(extra))zip.file(name,data);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
async function message(options={}){return (await require('nodemailer').createTransport({streamTransport:true,buffer:true}).sendMail({from:'a@example.com',to:'b@example.com',subject:'Gizli ileti',text:'Toplantı bilgisi',...options})).message;}
test('XLSX finds rich shared/inline strings, CDATA, scientific numbers and formulas',async()=>{
 const text=await extract(await workbook(),'.xlsx');assert.match(text,/Hassas Veriler/);assert.ok(inspect(text,['card']).length>=5);
 const escaped=await extract(await workbook({shared:'<sst><si><r><t>42424242</t></r><rPh><t>phonetic</t></rPh><r><t>_x0034_2424242</t></r></si></sst>'}),'.xlsx');assert.ok(inspect(escaped,['card']).length>=5);
});
test('XLSX rejects DTD, missing references, binary embeddings, zip expansion and disguised archives',async()=>{
 for(const buffer of [await workbook({shared:'<!DOCTYPE sst [<!ENTITY x "4242424242424242">]><sst><si><t>&x;</t></si></sst>'}),await workbook({sheet:'<worksheet><c t="s"><v>9999</v></c></worksheet>'}),await workbook({extra:{'xl/media/image.png':Buffer.from('unreadable image')}}),await workbook({extra:{'xl/large.xml':'<v>'+('x'.repeat(9*1024*1024))+'</v>'}})])await assert.rejects(extract(buffer,'.xlsx'),/Belge okunamadı/);
 const zip=new JSZip();zip.file('payload.txt','4242424242424242');await assert.rejects(extract(await zip.generateAsync({type:'nodebuffer'}),'.xlsx'),/Belge okunamadı/);
});
test('EML decodes base64/quoted-printable text, HTML and supported attachments',async()=>{
 const base64=Buffer.from('MIME-Version: 1.0\r\nFrom: a@example.com\r\nTo: b@example.com\r\nSubject: =?UTF-8?B?'+Buffer.from('Gizli 4242424242424242').toString('base64')+'?=\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('Card: 4242424242424242').toString('base64'));
 assert.ok(inspect(await extract(base64,'.eml'),['card']).length>=2);
 const qp=Buffer.from('MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCard: =34=32=34=32=34=32=34=32=34=32=34=32=34=32=34=32');assert.equal(inspect(await extract(qp,'.eml'),['card']).length,1);
 const mime=await message({text:'Clean text',html:'<p>Card: <b>42424242</b><span>42424242</span></p>',attachments:[{filename:'finance.xlsx',content:await workbook()}]});const text=await extract(mime,'.eml');assert.ok(inspect(text,['card']).length>=5);
});
test('EML blocks unsupported or disguised attachments and limits nested messages',async()=>{
 const zip=new JSZip();zip.file('payload','secret');const archive=await zip.generateAsync({type:'nodebuffer'});
 for(const filename of ['hidden.zip','hidden.txt'])await assert.rejects(extract(await message({attachments:[{filename,content:archive}]}),'.eml'),/Belge okunamadı/);
 let nested=await message();for(let i=0;i<5;i++)nested=await message({attachments:[{filename:'nested.eml',contentType:'message/rfc822',content:nested}]});await assert.rejects(extract(nested,'.eml'),/Belge okunamadı/);
});
test('folder scan includes XLSX and decoded EML findings without raw sensitive values',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-formats-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'finance.xlsx'),await workbook());await fs.writeFile(path.join(dir,'mail.eml'),await message({text:'Card: 4242424242424242'}));const result=await scanDirectory(dir,{mode:'block',enabled:['card']});assert.equal(result.files,2);assert.equal(result.findings.length,2);assert.equal(result.errors,0);assert.equal(JSON.stringify(result).includes('4242424242424242'),false);
});
module.exports={workbook,message};
