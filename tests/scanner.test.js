const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {scanDirectory,extract}=require('../scanner');
const {docx,pdf}=require('./helpers');
test('real folder scan parses TXT, UTF16, PDF and DOCX and reports unreadable documents',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-scan-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'plain.txt'),'Card: 4242 4242 4242 4242');
  await fs.writeFile(path.join(root,'unicode.txt'),Buffer.concat([Buffer.from([255,254]),Buffer.from('Card: 4242424242424242','utf16le')]));
  await fs.writeFile(path.join(root,'document.docx'),await docx('Card: 4242424242424242'));
  await fs.writeFile(path.join(root,'document.pdf'),pdf('Card: 4242424242424242'));
  await fs.writeFile(path.join(root,'broken.pdf'),'broken pdf');await fs.writeFile(path.join(root,'skip.exe'),'not supported');
  await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'node_modules','skip.txt'),'4242424242424242');
  const result=await scanDirectory(root,{mode:'block',enabled:['card']});assert.equal(result.files,4);assert.equal(result.findings.length,4);assert.equal(result.errors,1);assert.ok(result.skipped>=2);assert.equal(result.truncated,false);assert.ok(!JSON.stringify(result).includes('4242424242424242'));
});
test('unsupported file attachments fail closed and cancellation is explicit',async t=>{
  await assert.rejects(extract(Buffer.from('test'),'.zip'),/Desteklenmeyen/);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-cancel-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const controller=new AbortController();controller.abort();const result=await scanDirectory(root,{enabled:[]},{signal:controller.signal});assert.equal(result.cancelled,true);assert.equal(result.files,0);
});
