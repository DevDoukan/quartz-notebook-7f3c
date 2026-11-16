'use strict';
const checks=[
 ['unit-and-integration',['tools/run-unit-tests.cjs']],
 ['php-license-service',['tools/test-license-service.cjs']],
 ['browser-and-extension',['tests/browser.check.cjs']],
 ['central-browser',['tests/central-browser.check.cjs']],
 ['central-distribution',['tests/central-package.check.cjs']],
 ['endpoint-enrollment-browser',['tests/enrollment-browser.check.cjs']],
 ['central-https-load',['tests/central-load.check.cjs','current','--tls']]
];
function complete(steps){return Array.isArray(steps)&&steps.length===checks.length&&checks.every(([name],i)=>steps[i]?.name===name&&steps[i]?.passed===true&&steps[i]?.status===0);}
module.exports={checks,complete};
