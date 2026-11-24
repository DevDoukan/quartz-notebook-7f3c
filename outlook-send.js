'use strict';

function officeResult(invoke) {
  return new Promise((resolve, reject) => invoke(result => {
    if (result.status === 'succeeded') resolve(result.value);
    else reject(new Error('Outlook ileti alanı okunamadı.'));
  }));
}

function createOutlookEvaluator(origin, credential, request = globalThis.fetch) {
  const address = new URL(origin);
  if (address.protocol !== 'https:' || address.username || address.password ||
      address.pathname !== '/' || address.search || address.hash ||
      !/^o1_[a-f0-9]{64}$/.test(credential)) {
    throw new Error('Şirket Outlook denetim bağlantısı geçersiz.');
  }
  const endpoint = new URL('/api/agent/outlook/inspect', address).href;
  return async (message, signal) => {
    signal?.throwIfAborted();
    const response = await request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + credential },
      body: JSON.stringify(message),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal
    });
    if (!response.ok) throw new Error('Şirket Outlook denetimi tamamlanamadı.');
    const result = await response.json();
    if (!['allow', 'warn', 'block'].includes(result?.decision) ||
        !Number.isSafeInteger(result.policyRevision) || result.policyRevision < 1) {
      throw new Error('Şirket Outlook denetim yanıtı geçersiz.');
    }
    return result;
  };
}

function registerOutlookSend(office, loadSession, request = globalThis.fetch) {
  if (typeof loadSession !== 'function') throw new Error('Outlook oturum sağlayıcısı gerekli.');
  office.actions.associate('kalkanOnMessageSend', event => {
    const evaluate = async (message, signal) => {
      const session = await loadSession(signal);
      signal.throwIfAborted();
      if (!session || !Number.isSafeInteger(session.expires) || session.expires <= Date.now()) {
        throw new Error('Outlook denetim oturumu sona erdi.');
      }
      return createOutlookEvaluator(session.origin, session.credential, request)(message, signal);
    };
    const supportsWarning = office.context.requirements.isSetSupported('Mailbox', '1.14');
    return handleOutlookSend(event, office.context.mailbox.item, evaluate, 15000, supportsWarning);
  });
}

function outlookItemSessionLoader(office, expectedOrigin) {
  const origin = new URL(expectedOrigin).origin;
  return async signal => {
    signal?.throwIfAborted();
    const item = office.context.mailbox.item;
    const value = await officeResult(callback => item.sessionData.getAsync('kalkan.outlook.session', callback));
    signal?.throwIfAborted();
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Outlook oturumu bulunamadı.');
    const session = JSON.parse(value);
    if (!session || session.origin !== origin) throw new Error('Outlook şirket oturumu uyuşmuyor.');
    createOutlookEvaluator(origin, session.credential);
    return session;
  };
}

async function setOutlookItemSession(office, expectedOrigin, session) {
  const origin = new URL(expectedOrigin).origin;
  if (!session || session.origin !== origin || !Number.isSafeInteger(session.expires) ||
      session.expires <= Date.now() || session.expires > Date.now() + 15 * 60 * 1000) {
    throw new Error('Outlook şirket oturumu geçersiz.');
  }
  createOutlookEvaluator(origin, session.credential);
  const value = JSON.stringify({ origin, credential: session.credential, expires: session.expires });
  await officeResult(callback => office.context.mailbox.item.sessionData.setAsync(
    'kalkan.outlook.session', value, callback));
}

function renewableOutlookSessionLoader(office, expectedOrigin, request = globalThis.fetch) {
  const load = outlookItemSessionLoader(office, expectedOrigin);
  const origin = new URL(expectedOrigin).origin;
  return async signal => {
    const session = await load(signal);
    if (!Number.isSafeInteger(session.expires) || session.expires <= Date.now()) {
      throw new Error('Outlook bağlantısı yeniden kurulmalı.');
    }
    if (session.expires - Date.now() > 2 * 60 * 1000) return session;
    const response = await request(new URL('/api/agent/outlook/renew', origin).href, {
      method: 'POST', headers: { Authorization: 'Bearer ' + session.credential },
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal
    });
    if (!response.ok) throw new Error('Outlook bağlantısı yenilenemedi.');
    const value = await response.json();
    signal?.throwIfAborted();
    const renewed = { origin, credential: value.credential, expires: value.expires };
    await setOutlookItemSession(office, origin, renewed);
    return renewed;
  };
}

async function collectOutlookMessage(item, signal) {
  signal?.throwIfAborted();
  const [sender, to, cc, bcc, subject, body, files] = await Promise.all([
    officeResult(callback => item.from.getAsync(callback)),
    officeResult(callback => item.to.getAsync(callback)),
    officeResult(callback => item.cc.getAsync(callback)),
    officeResult(callback => item.bcc.getAsync(callback)),
    officeResult(callback => item.subject.getAsync(callback)),
    officeResult(callback => item.body.getAsync('text', callback)),
    officeResult(callback => item.getAttachmentsAsync(callback))
  ]);
  signal?.throwIfAborted();
  if (!Array.isArray(files) || files.length > 20) throw new Error('Outlook ek sınırı aşıldı.');
  const attachments = [];
  let totalBytes = 0;
  for (const file of files) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 10 * 1024 * 1024 - totalBytes) {
      attachments.push({ name: file.name, unreadable: true });
      continue;
    }
    try {
      const value = await officeResult(callback => item.getAttachmentContentAsync(file.id, callback));
      signal?.throwIfAborted();
      if (value.format !== 'base64' || typeof value.content !== 'string' ||
          value.content.length > 13981016 || value.content.length % 4 !== 0 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(value.content)) {
        throw new Error('Ek okunamadı.');
      }
      const padding = value.content.endsWith('==') ? 2 : value.content.endsWith('=') ? 1 : 0;
      const bytes = value.content.length / 4 * 3 - padding;
      if (bytes > 10 * 1024 * 1024 - totalBytes) throw new Error('Ek boyutu sınırı aşıldı.');
      totalBytes += bytes;
      attachments.push({ name: file.name, base64: value.content });
    } catch {
      attachments.push({ name: file.name, unreadable: true });
    }
  }
  signal?.throwIfAborted();
  return {
    sender: sender.emailAddress,
    to: to.map(value => value.emailAddress),
    cc: cc.map(value => value.emailAddress),
    bcc: bcc.map(value => value.emailAddress),
    subject, body, attachments
  };
}

async function handleOutlookSend(event, item, evaluate, timeoutMs = 15000,
  supportsWarningOverride = globalThis.Office?.context?.requirements?.isSetSupported('Mailbox', '1.14') === true) {
  let timer;
  const controller = new AbortController();
  try {
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Denetim zaman aşımı.'));
      }, timeoutMs);
    });
    const inspection = async () => {
      const message = await collectOutlookMessage(item, controller.signal);
      const result = await evaluate(message, controller.signal);
      controller.signal.throwIfAborted();
      if (result?.decision === 'allow' || result?.decision === 'warn') {
        const current = await collectOutlookMessage(item, controller.signal);
        if (JSON.stringify(current) !== JSON.stringify(message)) {
          throw new Error('İleti denetim sırasında değişti. Yeniden gönderin.');
        }
      }
      return result;
    };
    const result = await Promise.race([inspection(), timeout]);
    if (result?.decision === 'allow') event.completed({ allowEvent: true });
    else if (result?.decision === 'warn' && supportsWarningOverride) event.completed({
      allowEvent: false,
      sendModeOverride: 'promptUser',
      errorMessage: 'Kalkan DLP hassas veya taranamayan içerik buldu. Göndermeden önce iletiyi kontrol edin.'
    });
    else event.completed({
      allowEvent: false,
      errorMessage: result?.unreadableAttachments > 0
        ? 'Kalkan DLP bir veya daha fazla eki tarayamadı. Ekleri kontrol edip yeniden deneyin.'
        : 'Kalkan DLP politikası gönderime izin vermedi. Şirket BT ekibinizle görüşün.'
    });
  } catch {
    event.completed({
      allowEvent: false,
      errorMessage: 'Kalkan DLP denetimi tamamlanamadı. Yeniden deneyin veya şirket BT ekibinizle görüşün.'
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

if (typeof module !== 'undefined') module.exports = { collectOutlookMessage, handleOutlookSend, createOutlookEvaluator, registerOutlookSend, outlookItemSessionLoader, setOutlookItemSession, renewableOutlookSessionLoader };
