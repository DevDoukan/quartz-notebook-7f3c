'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { outlookManifest } = require('./outlook-manifest.cjs');

function outlookRuntimeFiles(origin) {
  const manifest = outlookManifest(origin);
  const canonicalOrigin = new URL(origin).origin;
  const files = {};
  const source = fs.readFileSync(path.join(__dirname, '..', 'outlook-send.js'), 'utf8');
  const bootstrap = '\nregisterOutlookSend(Office, renewableOutlookSessionLoader(Office, ' +
    JSON.stringify(canonicalOrigin) + '));\n';
  files['runtime.js'] = source + bootstrap;
  files['runtime.html'] = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Kalkan DLP</title>
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
<script src="runtime.js"></script></head><body></body></html>
`;
  files['manifest.xml'] = manifest;
  for (const size of [64, 128]) {
    const name = 'icon-' + size + '.png';
    files[name] = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'outlook', name));
  }
  files['status.html'] = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kalkan DLP Outlook</title>
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
<script src="session-ui.js" defer></script></head><body>
<main><h1>Kalkan DLP Outlook</h1>
<p>Gönderim öncesi denetim, şirket politikanıza göre çalışır.</p>
<p>Client yöneticinizin bu cihaz için oluşturduğu süreli bağlantı dosyasını seçin. Bağlantı bu ileti için kullanılır.</p>
<label for="session-file">Süreli bağlantı dosyası</label>
<input id="session-file" type="file" accept=".json,application/json">
<p id="session-status" role="status" aria-live="polite">Bağlantı bekleniyor.</p>
</main></body></html>
`;
  files['session-ui.js'] = source + `
Office.onReady(function () {
  const input = document.getElementById('session-file');
  const status = document.getElementById('session-status');
  input.addEventListener('change', async function () {
    const file = input.files[0];
    input.disabled = true;
    try {
      if (!file || file.size > 4096) throw new Error();
      const session = JSON.parse(await file.text());
      await setOutlookItemSession(Office, ${JSON.stringify(canonicalOrigin)}, session);
      status.textContent = 'Bu ileti şirket denetimine bağlandı. Oturum süresi dolarsa yeni bağlantı dosyası gerekir.';
    } catch {
      status.textContent = 'Bağlantı kurulamadı. Dosyanın bu şirkete ait ve süresinin geçerli olduğunu kontrol edin.';
    } finally {
      input.value = '';
      input.disabled = false;
    }
  });
});
`;
  return files;
}

function buildOutlookRuntime(origin, directory) {
  const files = outlookRuntimeFiles(origin);
  fs.mkdirSync(directory);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content);
}

if (require.main === module) {
  try {
    const [origin, directory] = process.argv.slice(2);
    if (!directory || process.argv.length !== 4) throw new Error('Kullanım: node tools/build-outlook-runtime.cjs HTTPS_ORIGIN NEW_DIRECTORY');
    buildOutlookRuntime(origin, directory);
    console.log('Outlook çalışma dosyaları oluşturuldu. Oturum sağlama ve kurumsal kabul bekliyor.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { buildOutlookRuntime, outlookRuntimeFiles };
