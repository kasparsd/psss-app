// The only code that talks to the native host. Chrome, Edge, Firefox and Safari all expose
// runtime.sendNativeMessage. Safari ignores the host name and talks to the containing app's
// app extension; Chrome and Firefox start the registered host process for each message.
var api = globalThis.browser ?? globalThis.chrome;

var Host = (function () {
  let counter = 0;

  async function send(type, fields) {
    const id = String(++counter);
    let reply;
    try {
      reply = await api.runtime.sendNativeMessage(PROTOCOL.host, { v: PROTOCOL.version, id, type, ...fields });
    } catch (e) {
      // "Specified native messaging host not found", or the host exited.
      return { ok: false, error: 'not-installed' };
    }
    if (!reply || reply.id !== id || reply.v !== PROTOCOL.version) return { ok: false, error: 'bad-reply' };
    return reply;
  }

  return {
    ping: () => send('ping'),
    candidates: (origin) => send('candidates', { origin }),
    cardCandidates: (origin) => send('card-candidates', { origin }),
    card: (ref, origin) => send('card', { ref, origin }),
    generate: () => send('generate'),
    save: (origin, vault, account, secret) => send('save', { origin, vault, account, secret }),
    search: (origin, query, fields = []) => send('search', { origin, query, fields }),
    vaults: () => send('vaults'),
    switchVault: (vault) => send('switch-vault', { vault }),
    unlockVault: (vault) => send('unlock-vault', { vault }),
    credential: (ref, origin, manual = false) => send('credential', { ref, origin, ...(manual ? { manual: true } : {}) })
  };
})();
