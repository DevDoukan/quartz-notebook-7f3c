const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect,validTC,luhn,validIBAN}=require('../detector');
test('checksums reject invalid identifiers and accept test fixtures',()=>{
  assert.equal(validTC('10000000146'),true);assert.equal(validTC('10000000147'),false);assert.equal(validTC('00000000000'),false);
  assert.equal(luhn('4242424242424242'),true);assert.equal(luhn('4242424242424243'),false);
  assert.equal(validIBAN('TR330006100519786457841326'),true);assert.equal(validIBAN('TR330006100519786457841327'),false);
});
test('masked findings have accurate lines, optional rules and no raw data',()=>{
  const input='test\nKart: 4242 4242 4242 4242\nTC: 10000000146\nIBAN: TR33 0006 1005 1978 6457 8413 26\nmail: test@example.com\npassword=very-secret-test\nçok gizli';
  const findings=inspect(input);assert.equal(findings.length,6);assert.equal(findings.find(f=>f.type==='card').line,2);assert.equal(findings.find(f=>f.type==='iban').line,4);
  assert.equal(inspect(input,['card']).length,1);assert.equal(inspect(input,[]).length,0);
  assert.ok(!JSON.stringify(findings).includes('4242'));assert.ok(!JSON.stringify(findings).includes('very-secret'));
});
test('large digit runs are not truncated into valid card candidates',()=>{
  assert.equal(inspect('42424242424242420',['card']).length,0);
  assert.equal(inspect('9 4242 4242 4242 4242 9',['card']).length,0);
});
