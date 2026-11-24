// Popup: list logins for the active tab and fill the one the person chooses. Opening the popup
// is the user gesture that grants activeTab; nothing runs on a page before that.
(async function () {
  const siteEl = document.getElementById('site');
  const statusEl = document.getElementById('status');
  const listEl = document.getElementById('logins');
  const searchEl = document.getElementById('search');
  const queryEl = document.getElementById('q');
  const resultsEl = document.getElementById('results');
  const say = (text) => { statusEl.textContent = text; };
  // The only setting is the browser's save prompt, which needs the optional `privacy` permission (not in Safari).
  const settingsEl = document.getElementById('settings');
  if (!api.runtime.getManifest().optional_permissions?.includes('privacy')) settingsEl.parentElement.hidden = true;
  settingsEl.addEventListener('click', async () => {
    await api.tabs.create({ url: api.runtime.getURL('settings.html') });
    window.close();
  });

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const origin = tab && OriginPolicy.fillableOrigin(tab.url);
  if (!origin) {
    say('Psss fills only on secure (https) pages.');
    return;
  }
  const pageHost = new URL(origin).host;
  siteEl.textContent = pageHost;

  let checkout = false;
  try {
    const [{ result } = {}] = await api.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] }, func: psssFillPage, args: [{}, 'probe-card', origin]
    });
    checkout = result?.checkout === true;
  } catch {
    // The login picker can still open when access to the page has not been granted.
  }

  const reply = await Host.candidates(origin);
  if (!reply.ok) {
    say({
      'not-installed': 'Psss is not connected. Open the Psss app once, then try again.',
      [PROTOCOL.errors.locked]: 'Psss is locked. Open the app to unlock.',
    }[reply.error] ?? 'Psss could not be reached.');
    return;
  }

  const logins = reply.candidates.map((c) => ({ ...c, matches: true }));
  let sampleCards = [];
  if (checkout) {
    const cards = await Host.cardCandidates(origin);
    if (cards.ok && cards.candidates.length) {
      sampleCards = cards.candidates.map((c) => ({ ...c, card: true, matches: true }));
    }
  }
  render(listEl, [...logins, ...sampleCards]);
  searchEl.hidden = false;
  if (sampleCards.length) {
    say('Sample cards are available for this checkout.');
  } else if (!logins.length) {
    say('No saved logins for this site. Search all logins below.');
    queryEl.focus();
  }

  await offerCreate();

  let timer;
  queryEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 150);
  });

  async function search() {
    const query = queryEl.value.trim();
    if (!query) { resultsEl.replaceChildren(); return; }
    const found = await Host.search(origin, query);
    if (queryEl.value.trim() !== query) return; // a newer search is on its way
    if (!found.ok) { say('Psss could not search.'); return; }
    const shown = new Set([...listEl.querySelectorAll('li')].map((li) => li.dataset.ref));
    const rows = found.results.filter((r) => !shown.has(r.ref));
    render(resultsEl, rows);
    if (!rows.length) {
      const none = document.createElement('li');
      none.textContent = 'Nothing found.';
      resultsEl.append(none);
    }
  }

  // Sign-up forms: generate a strong password, fill the password and its confirmation, and save the
  // login, in one labeled action. The popup closes when focus leaves it, so saving later could lose
  // the password. The save happens with the click.
  async function offerCreate() {
    let page;
    try {
      [{ result: page } = {}] = await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: psssProbePage });
    } catch { return; }
    if (!page?.newPassword) return;
    const createEl = document.getElementById('create');
    const accountEl = document.getElementById('account');
    const generateEl = document.getElementById('generate');
    const createdEl = document.getElementById('created');
    createEl.hidden = false;
    accountEl.value = page.username;
    generateEl.addEventListener('click', async () => {
      const account = accountEl.value.trim();
      if (!account) { createdEl.textContent = 'Enter the username or email first.'; accountEl.focus(); return; }
      generateEl.disabled = true;
      const [current] = await api.tabs.query({ active: true, currentWindow: true });
      if (!current || current.id !== tab.id || !OriginPolicy.sameOrigin(current.url, origin)) {
        createdEl.textContent = 'The page changed. Open Psss again.';
        return;
      }
      const made = await Host.generate();
      if (!made.ok) { createdEl.textContent = 'Psss could not generate a password.'; generateEl.disabled = false; return; }
      const [{ result } = {}] = await api.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] }, func: psssFillPasswords, args: [made.password]
      });
      if (!result?.filled) { createdEl.textContent = 'No password fields found on this page.'; generateEl.disabled = false; return; }
      const saved = await Host.save(origin, account, made.password);
      createdEl.textContent = saved.ok
        ? `${saved.result === 'updated' ? 'Updated' : 'Saved'} the login for ${account}. The password is filled in.`
        : 'The password is filled in, but Psss could not save it. Do not submit the form yet.';
      generateEl.disabled = !saved.ok;
    });
  }

  function render(target, rows) {
    target.replaceChildren(...rows.map(row));
  }

  function row(c) {
    const li = document.createElement('li');
    li.dataset.ref = c.ref;
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = c.title;
    const account = document.createElement('span');
    account.className = 'secondary';
    account.textContent = c.account;
    text.append(name, account);
    if (!c.matches && c.website) {
      const site = document.createElement('span');
      site.className = 'secondary';
      site.textContent = `Saved for ${c.website}`;
      text.append(document.createElement('br'), site);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = c.card ? 'Fill card' : c.matches ? 'Fill' : 'Fill…';
    button.setAttribute('aria-label', `${c.matches ? 'Fill' : 'Fill, saved for another site:'} ${c.card ? c.title : c.account} on ${pageHost}`);
    button.addEventListener('click', () => (c.matches ? fill(c.ref, button, false, c.card) : confirmFill(li, c)));
    li.append(text, button);
    return li;
  }

  // A login saved for another site is released only after a second, explicit click that names both sites.
  function confirmFill(li, c) {
    const original = [...li.childNodes];
    const warning = document.createElement('p');
    warning.className = 'warning';
    warning.textContent = `${c.title} is saved for ${c.website || 'another site'}, not ${pageHost}. Fill it here anyway?`;
    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'confirm-fill';
    fillBtn.textContent = 'Fill anyway';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cancel';
    cancel.textContent = 'Cancel';
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(cancel, fillBtn);
    li.classList.add('confirm');
    li.replaceChildren(warning, actions);
    cancel.addEventListener('click', () => { li.classList.remove('confirm'); li.replaceChildren(...original); });
    fillBtn.addEventListener('click', () => fill(c.ref, fillBtn, true));
    cancel.focus();
  }

  async function fill(ref, button, manual, card = false) {
    button.disabled = true;
    // Revalidate: the tab may have navigated while the popup was open.
    const [current] = await api.tabs.query({ active: true, currentWindow: true });
    if (!current || current.id !== tab.id || !OriginPolicy.sameOrigin(current.url, origin)) {
      say('The page changed. Open Psss again.');
      return;
    }
    const cred = card ? await Host.card(ref, origin) : await Host.credential(ref, origin, manual);
    if (!cred.ok) { say(card ? 'Psss could not release that card.' : 'Psss could not release that login.'); button.disabled = false; return; }
    const fields = cred.fields ?? { username: cred.account, 'current-password': cred.secret };
    const [{ result } = {}] = await api.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: psssFillPage,
      args: [fields, card ? 'card' : 'login', origin]
    });
    if (result?.filled?.length) window.close();
    else { say(card ? 'No matching checkout fields found on this page.' : 'No sign-in fields found on this page.'); button.disabled = false; }
  }
})();
