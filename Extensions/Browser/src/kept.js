// What was typed in the popup, so closing and opening it carries on. Kept in the browser's session storage: in memory, never on
// disk, gone when the browser quits. Only the search text, the chosen search fields and the typed username go in. No password,
// card or anything the host returned is ever stored.
var Kept = (function () {
  const KEY = 'popup';
  const FIELDS = ['name', 'website', 'username'];
  const text = (v) => (typeof v === 'string' ? v.slice(0, 256) : '');
  const clean = (s) => ({
    query: text(s?.query),
    fields: Array.isArray(s?.fields) ? FIELDS.filter((f) => s.fields.includes(f)) : [],
    account: text(s?.account)
  });
  // Another site or vault starts afresh, so Return never acts on a search made for the last one.
  const match = (saved, origin, vault) => (saved && saved.origin === origin && saved.vault === (vault ?? '') ? clean(saved) : null);

  // A browser without session storage, or one that refuses, leaves a popup that starts empty.
  async function load(api, origin, vault) {
    try { return match((await api.storage.session.get(KEY))?.[KEY], origin, vault); } catch { return null; }
  }
  async function save(api, origin, vault, state) {
    try { await api.storage.session.set({ [KEY]: { origin, vault: vault ?? '', ...clean(state) } }); } catch { /* not kept */ }
  }
  async function clear(api) {
    try { await api.storage.session.remove(KEY); } catch { /* nothing kept */ }
  }
  return { match, load, save, clear };
})();
if (typeof module !== 'undefined') module.exports = { Kept };
