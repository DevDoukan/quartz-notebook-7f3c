'use strict';
const path=require('node:path');
function readError(message){const error=Error(message);error.safeForUser=true;return error;}
const MAX_TEXT=4*1024*1024,MAX_INPUT=10*1024*1024;
const TEXT=new Set(['.txt','.csv','.tsv','.json','.xml','.html','.htm','.md','.log','.yaml','.yml','.ini','.env','.sql','.js','.ts','.py','.cs','.config']);
function bounded(value){if(value.length>MAX_TEXT)throw readError('Çıkarılan metin sınırı aşıldı.');return value;}
function plain(buffer){
 let encoding='utf-8',bytes=buffer;
 if(buffer[0]===255&&buffer[1]===254){encoding='utf-16le';bytes=buffer.subarray(2);}
 else if(buffer[0]===254&&buffer[1]===255){encoding='utf-16be';bytes=buffer.subarray(2);}
 try{
  const text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
  if(text.includes('\0'))throw Error('NUL');
  return bounded(text);
 }catch{throw readError('Metin kodlaması geçersiz, ikili içerik veya metin sınırı aşıldı.');}
}
function parseXml(xml,handlers){const {SaxesParser}=require('saxes'),parser=new SaxesParser({xmlns:true});parser.on('doctype',()=>{throw readError('XML DTD kabul edilmez.');});for(const [event,handler]of Object.entries(handlers))parser.on(event,handler);if(handlers.text)parser.on('cdata',handlers.text);parser.write(xml).close();}
async function unzip(buffer){
 const yauzl=require('yauzl');return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
  if(error)return reject(error);const files=new Map();let entries=0,total=0,done=false;
  const fail=error=>{if(done)return;done=true;zip.close();reject(error);};zip.on('error',fail);zip.on('end',()=>{if(!done){done=true;resolve(files);}});
  zip.on('entry',entry=>{try{
   if(++entries>2000||(total+=entry.uncompressedSize)>32*1024*1024||entry.uncompressedSize>8*1024*1024)throw readError('Excel arşivi boyut/sayı sınırını aşıyor.');
   if(entry.generalPurposeBitFlag&1)throw readError('Şifreli Excel arşivi okunamaz.');
   if(entry.fileName.endsWith('/'))return zip.readEntry();
   if(files.has(entry.fileName))throw readError('Excel arşivinde yinelenen dosya var.');
   if(!/\.(xml|rels)$/i.test(entry.fileName))throw readError('Excel içindeki görsel veya gömülü ikili dosya için ek okuyucu/OCR gerekiyor.');
   zip.openReadStream(entry,(error,stream)=>{if(error)return fail(error);let size=0;const parts=[];stream.on('error',fail);stream.on('data',part=>{size+=part.length;if(size>8*1024*1024){stream.destroy();return fail(readError('Excel parçası sınırı aşıldı.'));}parts.push(part);});stream.on('end',()=>{if(done)return;try{const xml=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));if(xml.includes('\0'))throw readError('Office XML kodlaması geçersiz.');files.set(entry.fileName,xml);zip.readEntry();}catch(error){fail(error);}});});
  }catch(e){fail(e);}});zip.readEntry();
 }));
}
function numeric(value){const match=/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value);if(!match)return value;const exponent=Number(match[4]);if(Math.abs(exponent)>20)return value;const digits=match[2]+(match[3]||''),point=match[2].length+exponent;return match[1]+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point));}
async function xlsx(buffer){
 const files=await unzip(buffer);if(!files.has('[Content_Types].xml')||!files.has('xl/workbook.xml')||![...files.keys()].some(name=>/^xl\/worksheets\/[^/]+\.xml$/.test(name)))throw readError('Geçerli Excel çalışma kitabı bulunamadı.');
 const shared=[],output=[];let length=0;const add=text=>{text=text.replace(/_x([0-9a-f]{4})_/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));length+=text.length+1;if(length>MAX_TEXT)throw readError('Excel metni sınırı aşıldı.');output.push(text);};
 if(files.has('xl/sharedStrings.xml')){let current=null,inText=false,phonetic=false,guide='';parseXml(files.get('xl/sharedStrings.xml'),{opentag:tag=>{if(tag.local==='si'){current='';guide='';}if(tag.local==='rPh')phonetic=true;if(tag.local==='t')inText=true;},text:text=>{if(current!==null&&inText){if(phonetic)guide+=text;else current+=text;}},closetag:tag=>{if(tag.local==='t')inText=false;if(tag.local==='rPh')phonetic=false;if(tag.local==='si'){shared.push(current);add(current);if(guide)add(guide);current=null;}}});}
 for(const [name,xml]of files){if(name==='xl/sharedStrings.xml')continue;
  if(/^xl\/worksheets\/[^/]+\.xml$/.test(name)){let cell=null,field='',phonetic=false;parseXml(xml,{opentag:tag=>{if(tag.local==='c')cell={type:tag.attributes.t?.value||'',value:'',inline:'',formula:'',guide:''};if(tag.local==='rPh')phonetic=true;if(cell&&['v','t','f'].includes(tag.local))field=tag.local;},text:text=>{if(cell){if(field==='v')cell.value+=text;else if(field==='t'){if(phonetic)cell.guide+=text;else cell.inline+=text;}else if(field==='f')cell.formula+=text;}},closetag:tag=>{if(tag.local==='rPh')phonetic=false;if(['v','t','f'].includes(tag.local))field='';if(tag.local==='c'&&cell){if(cell.type==='s'){if(!/^\d+$/.test(cell.value)||Number(cell.value)>=shared.length)throw readError('Excel metin başvurusu geçersiz.');add(shared[Number(cell.value)]);}else add(cell.inline||numeric(cell.value));if(cell.formula)add(cell.formula);if(cell.guide)add(cell.guide);cell=null;}}});
  }else{const fragments=[];parseXml(xml,{text:text=>{if(text.trim())fragments.push(text);},opentag:tag=>{for(const attr of Object.values(tag.attributes))if(attr.local==='name')add(attr.value);}});add(fragments.join(''));}
 }
 return output.join('\n');
}
async function docx(buffer){
 const files=await unzip(buffer);
 if(!files.has('[Content_Types].xml')||!files.has('word/document.xml')||files.has('xl/workbook.xml'))throw readError('Geçerli Word belgesi bulunamadı.');
 const output=[];let size=0;
 const add=text=>{size+=text.length;if(size>MAX_TEXT)throw readError('Word metni sınırı aşıldı.');output.push(text);};
 // Include comments, properties, headers and revision text; a clean body
 // cannot authorize an archive containing sensitive secondary XML parts.
 for(const xml of files.values()){
  const attributes=[];let attributeSize=0;
  parseXml(xml,{text:add,opentag:tag=>{for(const attr of Object.values(tag.attributes)){attributeSize+=attr.value.length;if(attributeSize>MAX_TEXT)throw readError('Word öznitelik sınırı aşıldı.');attributes.push(attr.value);}},closetag:tag=>{if(['p','tr','document'].includes(tag.local))add('\n');}});
  add('\n');for(const value of attributes)add(value+'\n');
 }
 return output.join('');
}
async function email(buffer,depth){
 const {simpleParser}=require('mailparser'),{convert}=require('html-to-text');
 const mail=await simpleParser(buffer,{ignoreEmbedded:true,maxHeadSize:65536,maxChildNodes:100,skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true,skipTextLinks:true,maxHtmlLengthToParse:MAX_TEXT});
 if(!mail.headerLines.length)throw readError('E-posta başlıkları bulunamadı.');
 const parts=[mail.subject||'',mail.from?.text||'',mail.to?.text||'',mail.cc?.text||'',mail.bcc?.text||'',mail.text||''];
 if(mail.html){bounded(mail.html);parts.push(convert(mail.html,{wordwrap:false}),mail.html);}
 if(mail.attachments.length>20)throw readError('E-posta ek sayısı sınırı aşıldı.');
 let size=0;for(const attachment of mail.attachments){size+=attachment.content.length;if(size>MAX_INPUT)throw readError('E-posta ek boyutu sınırı aşıldı.');const inferred=({'application/pdf':'.pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx','message/rfc822':'.eml','text/plain':'.txt','text/html':'.html'})[attachment.contentType];const ext=path.extname(attachment.filename||'').toLowerCase()||inferred;if(!ext)throw readError('E-posta eki türü belirlenemedi.');parts.push(attachment.filename||'',await readDocument(attachment.content,ext,depth+1));bounded(parts.join('\n'));}
 return bounded(parts.join('\n'));
}
async function readDocument(buffer,ext,depth=0){
 if(depth>3||buffer.length>MAX_INPUT)throw readError('Belge boyutu veya iç içe ek sınırı aşıldı.');
 const pdf=buffer.indexOf(Buffer.from('%PDF-'));if(pdf>=0&&pdf<1024)ext='.pdf';
 else if(buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,3,4]))&&!['.xlsx','.docx'].includes(ext))throw readError('Arşiv içeriği uzantıyla eşleşmiyor.');
 if(ext==='.xlsx')return xlsx(buffer);
 if(ext==='.eml')return email(buffer,depth);
 if(ext==='.docx')return docx(buffer);
 if(ext==='.pdf'){const {PDFParse}=require('pdf-parse'),parser=new PDFParse({data:buffer,verbosity:0,isEvalSupported:false});try{const text=bounded((await parser.getText()).text);if(!text.trim())throw readError('PDF için OCR gerekiyor.');return text;}finally{await parser.destroy();}}
 if(!TEXT.has(ext))throw readError('Desteklenmeyen belge/ek türü.');return plain(buffer);
}
module.exports={readDocument,plain};
