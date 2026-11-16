const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {openStore}=require('../store'),{openAccess,normalizeLocal}=require('../agent-access'),{scanDirectory,extract}=require('../scanner'),{pdf}=require('./helpers');
test('Windows handle broker enforces roots, protects data and rejects hard links and junction escapes',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-broker-')),company=path.join(root,'company'),outside=path.join(root,'outside'),data=path.join(root,'private');await fs.mkdir(company);await fs.mkdir(outside);
 const store=openStore(data);t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});const access=openAccess(store,{mode:true,dataDir:data,brokerPath:path.join(__dirname,'..','.build','agent','KalkanFileBroker.exe')});
 await fs.writeFile(path.join(company,'clean.txt'),'Company meeting');await fs.writeFile(path.join(company,'sensitive.txt'),'4242424242424242');await fs.writeFile(path.join(outside,'secret.txt'),'private-data');await fs.writeFile(path.join(data,'secret.txt'),'service-private');
 await assert.rejects(access.read(path.join(company,'clean.txt')),/klasör/);await access.setRoots([company]);assert.equal((await access.read(path.join(company,'clean.txt'))).toString(),'Company meeting');
 await assert.rejects(access.read(path.join(outside,'secret.txt')));await assert.rejects(access.setRoots([data]),/veri klasör/);
 await fs.symlink(outside,path.join(company,'junction'),'junction');await assert.rejects(access.read(path.join(company,'junction','secret.txt')));
 await fs.link(path.join(data,'secret.txt'),path.join(company,'hardlink.txt'));await assert.rejects(access.read(path.join(company,'hardlink.txt')),/baglantili/);
 const list=await access.list(company);assert.ok(list.entries.some(e=>e.name==='junction'&&e.isSymbolicLink()));
 const scan=await scanDirectory(company,{mode:'block',enabled:['card']},{access});assert.equal(scan.findings.length,1);assert.equal(scan.files,2);assert.equal(scan.errors,1);assert.ok(scan.skipped>=1);
 assert.throws(()=>normalizeLocal('\\\\server\\share\\secret.txt'));assert.throws(()=>normalizeLocal('C:\\company\\file.txt:secret'));assert.throws(()=>normalizeLocal('C:\\'));
});
test('PDF content is detected independently of a misleading extension',async()=>{
 const text=await extract(pdf('Card: 4242424242424242'),'.txt');assert.ok(text.includes('4242424242424242'));await assert.rejects(extract(Buffer.from([0x50,0x4b,3,4,0,0,0]),'.txt'),/Arşiv/);
});
test('protected machine configuration remains unreadable even with an old broad trusted root',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-common-denied-')),common=path.join(root,'Protected Common'),data=path.join(common,'Data'),company=path.join(root,'Company');await fs.mkdir(company,{recursive:true});const store=openStore(data);t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});const secret=path.join(common,'central-connection.json');await fs.writeFile(secret,'{"credential":"private-machine-secret"}');await fs.writeFile(path.join(company,'clean.txt'),'Allowed company document');
 const access=openAccess(store,{mode:true,dataDir:data,protectedRoots:[common],brokerPath:path.join(__dirname,'..','.build','agent','KalkanFileBroker.exe')});await assert.rejects(access.setRoots([common]),/veri klasör/);store.set('trustedRoots',[root]);await assert.rejects(access.read(secret),/Korunan/);await assert.rejects(access.list(common),/Korunan/);assert.equal((await access.read(path.join(company,'clean.txt'))).toString(),'Allowed company document');
});
