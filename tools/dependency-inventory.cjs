'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]||process.cwd()),components=[],notices=[];
function scanModules(dir){
 if(!fs.existsSync(dir))return;
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
  const folder=path.join(dir,entry.name);
  if(entry.name.startsWith('@')){scanScope(folder);continue;}
  inspect(folder);
 }
}
function scanScope(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}))if(entry.isDirectory())inspect(path.join(dir,entry.name));}
function inspect(folder){
 const file=path.join(folder,'package.json');if(!fs.existsSync(file))return;
 const value=JSON.parse(fs.readFileSync(file,'utf8')),licenses=fs.readdirSync(folder).filter(name=>/^(license|licence|copying|notice)(\.|$)/i.test(name)&&fs.statSync(path.join(folder,name)).isFile());
 components.push({name:value.name,version:value.version,license:value.license||'REVIEW_REQUIRED',path:path.relative(root,folder).split(path.sep).join('/'),noticeFiles:licenses});
 for(const name of licenses)notices.push(`\n${'='.repeat(72)}\n${value.name}@${value.version} (${value.license||'REVIEW_REQUIRED'})\n${name}\n\n${fs.readFileSync(path.join(folder,name),'utf8')}\n`);
 scanModules(path.join(folder,'node_modules'));
}
scanModules(path.join(root,'node_modules'));
const nodeLicense=fs.readFileSync(path.join(root,'runtime','LICENSE.txt'),'utf8');
fs.writeFileSync(path.join(root,'DEPENDENCY-INVENTORY.json'),JSON.stringify({format:'kalkan-dependency-inventory-v1',version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,components:components.sort((a,b)=>a.name.localeCompare(b.name))},null,2));
fs.writeFileSync(path.join(root,'THIRD-PARTY-NOTICES.txt'),'Kalkan DLP third-party software notices\n\nNode.js runtime license and bundled notices\n'+nodeLicense+notices.join('\n'));
console.log(`${components.length} üretim bağımlılığı ve lisans bildirimi derlendi.`);
