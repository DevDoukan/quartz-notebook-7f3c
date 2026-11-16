'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {encrypt,decrypt,publicKey}=require('../tools/vendor-key-backup.cjs');
test('vendor seed backup authenticates ciphertext, product identity and password',async()=>{
 const seed=crypto.randomBytes(32),password=crypto.randomBytes(24).toString('base64'),pub=publicKey(seed);
 const a=await encrypt(seed,password),b=await encrypt(seed,password);
 assert.notEqual(a.salt,b.salt);assert.notEqual(a.iv,b.iv);assert.notEqual(a.data,b.data);
 const restored=await decrypt(a,password,pub);assert.deepEqual(restored,seed);restored.fill(0);
 await assert.rejects(decrypt(a,'wrong-password-123456',pub));
 await assert.rejects(decrypt(a,password,publicKey(crypto.randomBytes(32))));
 for(const field of ['tag','data','salt','iv']){const raw=Buffer.from(a[field],'base64');raw[0]^=1;await assert.rejects(decrypt({...a,[field]:raw.toString('base64')},password,pub));}
 await assert.rejects(decrypt({...a,version:2},password,pub));
 await assert.rejects(decrypt({...a,data:a.data+'!'},password,pub));
 await assert.rejects(encrypt(seed,'short'));
 seed.fill(0);
});
