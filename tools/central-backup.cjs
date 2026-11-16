'use strict';
const fs=require('node:fs'),path=require('node:path'),{createCentralBackup,restoreCentralBackup}=require('../central-backup');
(async()=>{
 const [action,source,target]=process.argv.slice(2);if(!['create','restore'].includes(action)||!source||!target)throw Error('Kullanım: parola-stdin | node tools/central-backup.cjs create|restore kaynak tam-hedef-yolu');
 if(!path.isAbsolute(source)||!path.isAbsolute(target))throw Error('Kaynak ve hedef tam yol olmalı.');
 if(fs.existsSync(target))throw Error('Hedef zaten var. Mevcut dosya veya klasör değiştirilmedi.');
 let password='';for await(const part of process.stdin){password+=part;if(password.length>256)throw Error('Parola girdisi çok büyük.');}password=password.replace(/\r?\n$/,'');
 if(action==='create'){const document=await createCentralBackup(source,password);fs.writeFileSync(target,JSON.stringify(document),{mode:0o600,flag:'wx',flush:true});console.log('Şifreli merkez yedeği oluşturuldu.');}
 else {if(fs.statSync(source).size>600*1024*1024)throw Error('Yedek dosyası çok büyük.');console.log(JSON.stringify(await restoreCentralBackup(JSON.parse(fs.readFileSync(source,'utf8')),password,target)));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
