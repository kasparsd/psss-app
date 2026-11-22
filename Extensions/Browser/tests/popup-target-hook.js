// Test builds only (build.py package --test). Loaded by popup.html before popup.js.
// A popup opened as an ordinary tab has no "active tab" to act on, so a test points it at a
// tab by URL pattern: popup.html#target=http://localhost/*  (match patterns have no port). Everything after that is the
// production code path: host messages, origin checks and injection. Never shipped.
(() => {
  const pattern = new URLSearchParams(location.hash.slice(1)).get('target');
  if (!pattern) return;
  const real = api;
  const tabs = { query: async () => (await real.tabs.query({ url: pattern })).slice(0, 1) };
  api = new Proxy(real, { get: (o, k) => (k === 'tabs' ? tabs : o[k]) });
})();
