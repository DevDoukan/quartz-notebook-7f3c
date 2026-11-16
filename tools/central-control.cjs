'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {loadCentralConfig}=require('../central-config');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const action=process.argv[2];if(!['start','stop','status'].includes(action))throw Error('Kullanım: central-control.cjs start|stop|status');
 const root=path.join(__dirname,'..'),config=loadCentralConfig(process.env,root),origin=new URL(config.origin),tokenFile=path.join(config.dataDir,'central-control-token.txt');
 const request=(route,token)=>new Promise((resolve,reject)=>{const req=(config.tls?https:http).request({hostname:'127.0.0.1',port:config.port,servername:require('node:net').isIP(origin.hostname)?'':origin.hostname,ca:config.ca,rejectUnauthorized:true,path:route,method:token?'POST':'GET',headers:{Host:origin.host,Connection:'close',...(token?{'X-DLP-Control':token,'Content-Type':'application/json'}:{})}},res=>{let text='';res.on('data',part=>{text+=part;if(text.length>8192)res.destroy(Error('Kontrol yanıtı çok büyük.'));});res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200)return reject(Error('Merkez kontrol isteği reddedildi.'));try{resolve(JSON.parse(text));}catch{reject(Error('Geçersiz merkez yanıtı.'));}});});const deadline=setTimeout(()=>req.destroy(Error('Merkez yanıt vermedi.')),2000);req.on('close',()=>clearTimeout(deadline));req.on('error',reject);req.end(token?'{}':undefined);});
 function own(state){if(!fs.existsSync(tokenFile))return false;const token=fs.readFileSync(tokenFile,'utf8').trim();return state.application==='Kalkan DLP Central'&&state.instanceId===crypto.createHash('sha256').update(token).digest('hex');}
 let health;try{health=await request('/api/health');}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code))throw error;}
 if(health&&!own(health))throw Error('Bu porttaki merkez seçili veri klasörüne ait değil.');
 if(action==='status'){console.log(JSON.stringify({running:!!health,origin:config.origin,version:health?.version,deployment:health?.deployment,processId:health?.processId}));return;}
 if(action==='stop'&&health?.deployment&&health.deployment!=='portable')throw Error('Hizmet kipindeki merkezi Windows hizmet denetimiyle durdurun; taşınabilir kontrol aracı hizmet yürütücüsünü durdurmaz.');
 if(action==='start'&&!health&&config.serviceMode)throw Error('Merkez hizmet kipi, yerel Windows hizmet yürütücüsüyle başlatılmalı.');
 if(action==='stop'){if(!health){console.log('Merkez zaten kapalı.');return;}if(!Number.isSafeInteger(health.processId)||health.processId<1||health.processId===process.pid)throw Error('Merkez süreç kimliği doğrulanamadı.');await request('/api/control/shutdown',fs.readFileSync(tokenFile,'utf8').trim());for(let attempt=0;attempt<100;attempt++){try{process.kill(health.processId,0);}catch(error){if(error.code==='ESRCH'){console.log('Merkez durduruldu.');return;}if(error.code!=='EPERM')throw error;}await wait(50);}throw Error('Durdurma istendi ancak merkez süreci henüz sonlanmadı.');}
 if(health){console.log('Merkez zaten çalışıyor: '+config.origin);return;}
 fs.mkdirSync(config.dataDir,{recursive:true});const out=fs.openSync(path.join(config.dataDir,'server.log'),'a',0o600),err=fs.openSync(path.join(config.dataDir,'server-error.log'),'a',0o600);let child;
 try{child=spawn(process.execPath,[path.join(root,'central-server.js')],{cwd:root,env:process.env,detached:true,windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
 let spawnError;child.once('error',error=>{spawnError=error;});child.unref();
 for(let attempt=0;attempt<50;attempt++){if(spawnError)throw spawnError;try{const state=await request('/api/health');if(!own(state))throw Error('Başlatılan merkezin kimliği eşleşmiyor.');console.log('Merkez hazır: '+config.origin);return;}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code)){child.kill();throw error;}}await wait(200);}
 child.kill();throw Error('Merkez başlatılamadı. Veri klasöründeki hata günlüğünü kontrol edin.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
