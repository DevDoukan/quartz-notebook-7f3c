'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function fingerprint(root){
 const included=new Set(['public','central-public','extension','scripts','tools','tests','installer','agent','driver','licensing-php','deploy']);const files=[];
 function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Kaynak parmak izinde sembolik bağlantı desteklenmez.');if(entry.isDirectory())visit(full);else files.push(full);}}
 for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(entry.isFile()&&/\.(js|cjs|mjs|json|md|pem|cmd)$/.test(entry.name))files.push(path.join(root,entry.name));else if(entry.isDirectory()&&included.has(entry.name))visit(path.join(root,entry.name));}
 const digest=crypto.createHash('sha256');for(const file of files.sort()){digest.update(path.relative(root,file).split(path.sep).join('/')+'\n');digest.update(crypto.createHash('sha256').update(fs.readFileSync(file)).digest());}
 return {sha256:digest.digest('hex'),fileCount:files.length};
}
if(require.main===module)console.log(JSON.stringify(fingerprint(path.resolve(process.argv[2]||path.join(__dirname,'..')))));
module.exports={fingerprint};
