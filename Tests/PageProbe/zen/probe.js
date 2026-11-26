// Throwaway probe: the optional "tabs" permission, asked on a click. Shows only the host name and stores nothing.
const api = globalThis.browser ?? globalThis.chrome;
const status = document.getElementById('status');
const page = document.getElementById('page');
const wanted = { permissions: ['tabs'] };

async function show(note = '') {
  const allowed = await api.permissions.contains(wanted);
  status.textContent = `${note}${allowed ? 'Allowed.' : 'Not allowed.'}`;
  // The latest tab that isn't this add-on's own page, so "Open as a Page" still shows whether web addresses are readable.
  const own = api.runtime.getURL('');
  const tabs = (await api.tabs.query({ currentWindow: true })).filter((t) => !t.url?.startsWith(own));
  const url = tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]?.url;
  page.textContent = url ? `Last web tab: ${new URL(url).hostname || url.split(':')[0]}` : 'The address of the last tab is hidden.';
}

document.getElementById('allow').addEventListener('click', () => {
  // Asked first thing in the click: a request after an await is refused.
  api.permissions.request(wanted).then((yes) => show(yes ? '' : 'You declined. '), (e) => { status.textContent = e.message; });
});
document.getElementById('remove').addEventListener('click', () => api.permissions.remove(wanted).then(() => show()));
document.getElementById('tab').addEventListener('click', () => api.tabs.create({ url: api.runtime.getURL('probe.html') }));
show();
