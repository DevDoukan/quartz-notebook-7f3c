'use strict';
// Read enrollment details from stdin, never put enrollment tokens in argv/logs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {enrollAgent}=require('../agent-enrollment');
async function main(){
 if(!process.argv[2]||!path.isAbsolute(process.argv[2]))throw Error('Korunan hedef yapılandırma dosyasının tam yolunu belirtin.');const output=path.resolve(process.argv[2]);
 if(fs.existsSync(output))throw Error('Hedef dosya zaten var. Mevcut ajan kimliği değiştirilmedi.');
 // Decode once: a UTF-8 character can straddle two pipe writes. The bound also
 // accommodates the 64 KiB public CA bundle accepted by Register-Agent.ps1.
 const chunks=[];let bytes=0;
 for await(const part of process.stdin){bytes+=part.length;if(bytes>131072)throw Error('Kayıt isteği çok büyük.');chunks.push(part);}
 const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
 let caPem=input.caPem;
 if(input.caFile){const fd=fs.openSync(input.caFile,'r');try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>65536)throw Error('CA sertifikası çok büyük veya dosya değil.');const buffer=Buffer.alloc(65537);let length=0;while(length<buffer.length){const read=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!read)break;length+=read;}if(length>65536)throw Error('CA sertifikası çok büyük.');caPem=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length));}finally{fs.closeSync(fd);}}
 const config=await enrollAgent({...input,name:input.name||os.hostname(),caPem},output);
 console.log('Ajan kaydı tamamlandı. Cihaz: '+config.id);
}
main().catch(()=>{console.error('Ajan kaydı tamamlanamadı. Merkez adresini, anahtarı, TLS güvenini ve korunan hedef dosya yolunu kontrol edin.');process.exitCode=1;});
