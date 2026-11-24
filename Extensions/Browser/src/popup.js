// Popup: list logins for the active tab and fill the one the person chooses. Opening the popup
// is the user gesture that grants activeTab; nothing runs on a page before that. The look is the app's list
// (popup.css); the search is the app's too: the host decides which field matched and how many logins match in each.
// Every string that comes from a vault or a page goes through Display.line and into textContent, never innerHTML.
(async function () {
  const $ = (id) => document.getElementById(id);
  const siteEl = $('site');
  const noticeEl = $('notice');
  const statusEl = $('status');
  const noticeUnlock = $('noticeunlock');
  const unlockBtn = $('unlock');
  const siteGroup = $('sitegroup');
  const forSiteEl = $('forsite');
  const siteNote = $('sitenote');
  const listEl = $('logins');
  const searchEl = $('search');
  const queryEl = $('q');
  const pillsEl = $('pills');
  const resultsEl = $('results');
  const createEl = $('create');
  const vaultBar = $('vaultbar');
  const vaultBtn = $('vaultbtn');
  const vaultMenu = $('vaultmenu');
  const line = Display.line;

  // One notice at a time. `kind` is info (accent) or warning (orange).
  const say = (text, kind = 'info') => {
    statusEl.textContent = text;
    noticeEl.dataset.kind = kind;
    noticeEl.hidden = !text;
    if (!text) noticeUnlock.hidden = true;
  };

  // Static icons, drawn here so they take the text colour (light and dark).
  const NS = 'http://www.w3.org/2000/svg';
  function icon(className, paths, shapes = []) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    for (const d of paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
    for (const [tag, attrs] of shapes) {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      svg.append(e);
    }
    return svg;
  }
  const ICONS = {
    caret: () => icon('icon', ['M8 9l4-4 4 4M8 15l4 4 4-4']),
    check: () => icon('icon', ['M5 12.5l4.5 4.5L19 7']),
    locked: () => icon('icon', ['M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5'], [['rect', { x: 5, y: 10.5, width: 14, height: 9.5, rx: 2.2 }]]),
    unlocked: () => icon('icon', ['M8.2 10.5V8a3.8 3.8 0 0 1 7.3-1.4'], [['rect', { x: 5, y: 10.5, width: 14, height: 9.5, rx: 2.2 }]]),
    warning: () => icon('icon', ['M12 3.8L21.2 20H2.8z', 'M12 10v4.2', 'M12 17v.01']),
    passkey: () => icon('trait icon', ['M14.5 14.5L21 8l-2-2-1.5 1.5M18 7l-2 2'], [['circle', { cx: 9, cy: 15, r: 4 }]]),
  };

  // The only setting is the browser's save prompt, which needs the optional `privacy` permission (not in Safari).
  const settingsEl = $('settings');
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
  siteEl.textContent = line(pageHost, 80);

  // The search takes the focus the moment the popup opens, so typing starts at once (before the host has answered).
  searchEl.hidden = false;
  queryEl.focus();

  // What the toolbar button says about an unlock the last popup could not report (the Touch ID prompt closed it): a check when
  // the vault opened, an exclamation mark when it was cancelled or did not work. Read once, then cleared.
  async function takeBadge() {
    try {
      const text = await api.action.getBadgeText({});
      if (text) await api.action.setBadgeText({ text: '' });
      return text || '';
    } catch {
      return '';
    }
  }
  const badge = await takeBadge();

  let checkout = false;
  try {
    const [{ result } = {}] = await api.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] }, func: psssFillPage, args: [{}, 'probe-card', origin]
    });
    checkout = result?.checkout === true;
  } catch {
    // The login picker can still open when access to the page has not been granted.
  }

  let vaults = [];
  let siteLogins = [];  // this site's logins in the current vault: what makes "Create" say "Update"
  const currentVault = () => vaults.find((v) => v.active);
  const isOpen = () => { const v = currentVault(); return !v || v.state === 'open'; };  // no list at all: an older host, nothing to unlock
  const vaultName = (v, max = 32) => line(v?.name || 'Vault', max);

  // ---------- vaults: the button, the menu and what each state says ----------

  // Words under a vault's name in the menu: where it is kept, or the state when it is not simply locked or open.
  const STATE_WORDS = {
    'needs-password': 'Needs vault password',
    'not-downloaded': 'Not downloaded yet',
    'not-found': 'Not found',
    unreadable: 'Can’t be read',
  };
  const UNAVAILABLE = new Set(['not-downloaded', 'not-found', 'unreadable']);
  const SPOKEN = {
    open: 'Open',
    locked: 'Locked',
    'needs-password': 'Locked, needs vault password',
    'not-downloaded': 'Not available, not downloaded yet',
    'not-found': 'Not available, not found',
    unreadable: 'Not available, can’t be read',
  };

  async function refreshVaults(list) {
    if (!list) {
      const reply = await Host.vaults();
      list = reply.ok && Array.isArray(reply.vaults) ? reply.vaults : [];
    }
    vaults = list;
    drawVaultBar();
  }

  // The button names the current vault with a caret, only with two or more vaults. Rows: name, location or state words,
  // a check on the current one, a padlock or warning at the end. No Lock and no Add Vault here: those are the app's.
  function drawVaultBar() {
    vaultBar.hidden = vaults.length < 2;
    closeMenu();
    vaultMenu.replaceChildren();
    if (vaultBar.hidden) return;
    const name = vaultName(currentVault(), 24);
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;
    vaultBtn.replaceChildren(label, ICONS.caret());
    vaultBtn.setAttribute('aria-label', `Vault: ${name}. Switch vault`);
    const head = document.createElement('div');
    head.className = 'ph s';
    head.textContent = 'Vault';
    vaultMenu.append(head, ...vaults.map((v) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(v.active));
      const check = document.createElement('span');
      check.className = 'chk';
      if (v.active) check.append(ICONS.check());
      const text = document.createElement('span');
      text.className = 'text';
      const title = document.createElement('div');
      title.textContent = vaultName(v, 40);
      const where = document.createElement('div');
      where.className = 's';
      where.textContent = STATE_WORDS[v.state] ?? line(v.location, 40);
      text.append(title, where);
      const glyph = document.createElement('span');
      glyph.className = 'lock';
      glyph.setAttribute('role', 'img');
      glyph.setAttribute('aria-label', SPOKEN[v.state] ?? 'Locked');
      glyph.append(v.state === 'open' ? ICONS.unlocked() : UNAVAILABLE.has(v.state) ? ICONS.warning() : ICONS.locked());
      item.append(check, text, glyph);
      item.addEventListener('click', () => chooseVault(v));
      return item;
    }));
  }

  function closeMenu() {
    vaultMenu.hidden = true;
    vaultBtn.setAttribute('aria-expanded', 'false');
  }
  vaultBtn.addEventListener('click', () => {
    const show = vaultMenu.hidden;
    vaultMenu.hidden = !show;
    vaultBtn.setAttribute('aria-expanded', String(show));
    if (show) (vaultMenu.querySelector('[aria-checked="true"]') ?? vaultMenu.querySelector('button')).focus();
  });
  document.addEventListener('click', (e) => { if (!vaultBar.contains(e.target)) closeMenu(); });
  vaultBar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenu(); vaultBtn.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...vaultMenu.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    if (vaultMenu.hidden || !items.length) return;
    e.preventDefault();
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });

  // What the notice says for a vault that cannot list logins, and whether Unlock is offered. `hint` is how the last Unlock ended.
  function notice(v, hint) {
    const n = vaultName(v);
    const another = vaults.length >= 2 ? ', or choose another vault above' : '';
    switch (hint) {
      case 'cancelled': return { text: 'Touch ID was cancelled. Choose Unlock to try again.', kind: 'warning', unlock: true };
      case 'failed': return { text: 'Touch ID did not work. Choose Unlock to try again.', kind: 'warning', unlock: true };
      case 'needs-app': return { text: `Open Psss to unlock ${n}.`, kind: 'info', unlock: false };
      case 'opened': return { text: `Unlock ${n} in Psss.`, kind: 'info', unlock: false };
      default:
    }
    switch (v.state) {
      case 'needs-password': {
        const why = v.reason === 'changed' ? `Touch ID changed since ${n} was set up.`
          : v.reason === 'locked-out' ? 'Touch ID is locked out right now.' : `Touch ID is off for ${n}.`;
        return { text: `${why} Unlock with the vault password.`, kind: 'info', unlock: true };
      }
      case 'not-downloaded': return { text: `${n} isn’t downloaded yet. Psss lists nothing from it here. Open Psss to download it${another}.`, kind: 'warning', unlock: false };
      case 'not-found': return { text: `${n} was not found. Psss lists nothing from it here. Open Psss to locate it${another}.`, kind: 'warning', unlock: false };
      case 'unreadable': return { text: `${n} can’t be read. Psss lists nothing from it here. Open Psss for details${another}.`, kind: 'warning', unlock: false };
      default: return { text: `${n} is locked. Choose Unlock to use Touch ID.`, kind: 'info', unlock: true };
    }
  }

  function hideEverything() {
    searchEl.hidden = true;
    siteGroup.hidden = true;
    createEl.hidden = true;
    listEl.replaceChildren();
    resultsEl.replaceChildren();
    pillsEl.hidden = true;
  }

  // Draws the header's Unlock button (with two or more vaults) or the notice's (with one) and the notice itself, for the current
  // vault. Returns true when the vault is open and the logins can be listed.
  function showVaultState(hint) {
    const v = currentVault();
    unlockBtn.hidden = true;
    noticeUnlock.hidden = true;
    unlockBtn.disabled = noticeUnlock.disabled = false;
    if (!v || v.state === 'open') return true;
    hideEverything();
    const n = notice(v, hint);
    say(n.text, n.kind);
    if (n.unlock) {
      (vaults.length >= 2 ? unlockBtn : noticeUnlock).hidden = false;
      const label = `Unlock ${vaultName(v)}`;
      unlockBtn.setAttribute('aria-label', label);
      noticeUnlock.setAttribute('aria-label', label);
    }
    return false;
  }

  // Choosing a vault makes it the app's current vault (one per device) and locks the open one. It does not unlock: when the new
  // vault is locked, the header shows Unlock.
  async function chooseVault(v) {
    closeMenu();
    if (v.active) return;
    vaultBtn.disabled = true;
    const reply = await Host.switchVault(v.id);
    vaultBtn.disabled = false;
    if (reply.vaults) { vaults = reply.vaults; drawVaultBar(); }
    if (!reply.ok) {
      say(reply.error === PROTOCOL.errors.unsupported
        ? `Psss cannot switch vaults from the browser yet. Open Psss and choose ${vaultName(v)}.`
        : 'Psss could not switch vaults.', 'warning');
      return;
    }
    say('');
    if (showVaultState()) await afterOpen();
  }

  // ---------- unlocking ----------

  // The Touch ID prompt takes focus and the browser closes this popup, so the request goes through the background script, which
  // outlives it and leaves a check on the toolbar button. Only when no background answers does the popup ask the host itself.
  async function requestUnlock(id) {
    try {
      const reply = await api.runtime.sendMessage({ psss: 'unlock-vault', vault: id });
      if (reply && reply.v === PROTOCOL.version) return reply;
    } catch {
      // No background script reached: ask directly.
    }
    return Host.unlockVault(id);
  }

  async function unlock() {
    const v = currentVault();
    if (!v) return;
    unlockBtn.disabled = noticeUnlock.disabled = true;
    if (v.state === 'locked') say(`Unlocking ${vaultName(v)}… Use Touch ID. If this window closes, click the Psss button again.`, 'info');
    const reply = await requestUnlock(v.id);
    if (reply.vaults) { vaults = reply.vaults; drawVaultBar(); }
    if (reply.ok && isOpen()) {
      await takeBadge();
      say('');
      showVaultState();
      await afterOpen();
      return;
    }
    const hint = reply.ok ? 'opened' : reply.error;
    if (reply.vaults) { showVaultState(hint); return; }
    unlockBtn.disabled = noticeUnlock.disabled = false;
    say(reply.error === 'not-installed' ? 'Psss is not connected. Open the Psss app once, then try again.' : `Psss could not unlock ${vaultName(v)}.`, 'warning');
  }
  unlockBtn.addEventListener('click', unlock);
  noticeUnlock.addEventListener('click', unlock);

  // The vault is open: list this site's logins, run the search again and offer the sign-up form.
  async function afterOpen() {
    searchEl.hidden = false;
    await loadSite();
    await runSearch();
    drawCreate();
  }

  // ---------- this site's logins ----------

  async function loadSite() {
    say('');
    listEl.replaceChildren();
    siteNote.hidden = true;
    const reply = await Host.candidates(origin);
    if (!reply.ok) {
      siteGroup.hidden = true;
      if (reply.error === PROTOCOL.errors.locked || reply.error === PROTOCOL.errors.notAvailable) {
        // The vault closed since the list was read (a lock in the app): ask what it is now.
        await refreshVaults();
        if (!showVaultState()) return;
      }
      say({
        'not-installed': 'Psss is not connected. Open the Psss app once, then try again.',
        [PROTOCOL.errors.locked]: 'Psss is locked. Open the app to unlock.',
      }[reply.error] ?? 'Psss could not be reached.');
      searchEl.hidden = reply.error === PROTOCOL.errors.locked || reply.error === 'not-installed';
      return;
    }
    searchEl.hidden = false;
    const logins = reply.candidates.map((c) => ({ ...c, matches: true }));
    siteLogins = logins;
    let sampleCards = [];
    if (checkout) {
      const cards = await Host.cardCandidates(origin);
      if (cards.ok && cards.candidates.length) {
        sampleCards = cards.candidates.map((c) => ({ ...c, card: true, matches: true }));
      }
    }
    // The one login for the page is the default action, as in the app's picker.
    const rows = [...logins, ...sampleCards];
    render(listEl, rows, { main: rows.length === 1 });
    forSiteEl.textContent = `For ${line(pageHost)}`;
    if (!rows.length) {
      // Nothing for this site here. With several vaults say which one was looked at, and that the person can choose another:
      // Psss does not search the other vaults for them.
      siteNote.textContent = vaults.length >= 2
        ? `No logins for ${line(pageHost)} in ${vaultName(currentVault())}. Choose another vault above.`
        : 'No saved logins for this site.';
      siteNote.hidden = false;
    }
    siteGroup.hidden = searching();
    if (sampleCards.length) say('Sample cards are available for this checkout.');
  }

  // ---------- search: the app's pills and matching, decided by the host ----------

  const FIELDS = [['name', 'Name'], ['website', 'Website'], ['username', 'Username']];
  const chosen = new Set();
  const pills = new Map(FIELDS.map(([field, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    b.setAttribute('aria-pressed', 'false');
    b.dataset.field = field;
    b.addEventListener('click', () => {
      chosen.has(field) ? chosen.delete(field) : chosen.add(field);
      runSearch();
    });
    pillsEl.append(b);
    return [field, { button: b, label }];
  }));
  function drawPills(counts) {
    for (const [field, { button, label }] of pills) {
      const n = counts?.[field] ?? 0;
      const on = chosen.has(field);
      button.replaceChildren(document.createTextNode(`${label} `), Object.assign(document.createElement('span'), { className: 'n', textContent: String(n) }));
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', `${label}, ${n}`);
      button.disabled = n === 0 && !on;  // dimmed, never hidden, so the three stay where they are
    }
  }

  const searching = () => queryEl.value.trim() !== '';
  let timer;
  let latest = 0;
  queryEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 150);
  });

  // Return presses the one Fill there is: the only result of a search, or the only login for this site when the field is empty.
  // A login saved for another site is Fill…, which still asks first. Two or more rows: Return does nothing, the person picks.
  queryEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    clearTimeout(timer);
    await runSearch();
    const rows = [...(searching() ? resultsEl : listEl).querySelectorAll('li.row')];
    if (rows.length === 1) rows[0].querySelector('button')?.click();
  });

  async function runSearch() {
    const query = queryEl.value.trim();
    const mine = ++latest;
    if (!query) {
      resultsEl.replaceChildren();
      pillsEl.hidden = true;
      siteGroup.hidden = !listEl.children.length && siteNote.hidden;
      return;
    }
    if (!isOpen()) return;
    const found = await Host.search(origin, query, [...chosen]);
    if (mine !== latest) return; // a newer search is on its way
    if (!found.ok) {
      say(found.error === PROTOCOL.errors.locked ? 'Psss is locked. Open the app to unlock.' : 'Psss could not search.');
      return;
    }
    // While searching, the results replace this site's list: the counts count every login, this site's included.
    siteGroup.hidden = true;
    pillsEl.hidden = false;
    drawPills(found.counts);
    render(resultsEl, found.results, {});
    if (!found.results.length) {
      const none = document.createElement('li');
      none.className = 'none';
      none.textContent = 'Nothing found.';
      resultsEl.append(none);
    }
  }

  // ---------- sign-up forms ----------

  // Generate a strong password, fill the password and its confirmation, and save the login, in one labeled action. The popup
  // closes when focus leaves it, so saving later could lose the password. The save happens with the click. The login goes into
  // the current vault, which the button names with two or more vaults; when that vault already has this site and username
  // the button says Update, which changes only the password.
  const accountEl = $('account');
  const generateEl = $('generate');
  const createdEl = $('created');
  let signUp = null;  // what the page's form said, once probed
  async function probeSignUp() {
    try {
      [{ result: signUp } = {}] = await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: psssProbePage });
    } catch { signUp = null; }
    if (!signUp?.newPassword) { signUp = null; return; }
    accountEl.value = signUp.username;
    accountEl.addEventListener('input', drawCreate);
    generateEl.addEventListener('click', generateAndSave);
  }

  const existingFor = (account) => account ? siteLogins.find((l) => l.account === account) : undefined;

  function drawCreate() {
    createEl.hidden = !(signUp && isOpen());
    if (createEl.hidden) return;
    const multi = vaults.length >= 2;
    const account = accountEl.value.trim();
    const existing = existingFor(account);
    const where = vaultName(currentVault());
    const title = $('createtitle');
    const label = $('accountlabel');
    if (existing) {
      title.textContent = 'Update a login';
      label.textContent = multi ? `${where} already has ${line(account, 60)} for ${line(pageHost)}.` : `${line(account, 60)} is already saved for ${line(pageHost)}.`;
      generateEl.textContent = `Update ${line(existing.title, 40)} (${line(account, 60)})`;
    } else {
      title.textContent = 'Create a login';
      label.textContent = 'Username or email';
      generateEl.textContent = 'Generate, Fill and Save';
    }
  }

  async function generateAndSave() {
    const account = accountEl.value.trim();
    if (!account) { createdEl.textContent = 'Enter the username or email first.'; accountEl.focus(); return; }
    generateEl.disabled = true;
    const [current] = await api.tabs.query({ active: true, currentWindow: true });
    if (!current || current.id !== tab.id || !OriginPolicy.sameOrigin(current.url, origin)) {
      createdEl.textContent = 'The page changed. Open Psss again.';
      return;
    }
    // The save goes into the vault named on the button. Check it is still the current, open one before anything is filled.
    const before = currentVault();
    const fresh = await Host.vaults();
    const now = fresh.ok ? fresh.vaults?.find((v) => v.active) : undefined;
    if (before && (!now || now.id !== before.id || now.state !== 'open')) {
      if (fresh.ok) { await refreshVaults(fresh.vaults); showVaultState(); }
      createdEl.textContent = 'The vault changed. Open Psss again.';
      return;
    }
    const made = await Host.generate();
    if (!made.ok) { createdEl.textContent = 'Psss could not generate a password.'; generateEl.disabled = false; return; }
    const [{ result } = {}] = await api.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] }, func: psssFillPasswords, args: [made.password]
    });
    if (!result?.filled) { createdEl.textContent = 'No password fields found on this page.'; generateEl.disabled = false; return; }
    const saved = await Host.save(origin, before?.id ?? '', account, made.password);
    const where = vaults.length >= 2 ? ` in ${vaultName(before)}` : '';
    createdEl.textContent = saved.ok
      ? `${saved.result === 'updated' ? 'Updated' : 'Saved'} the login for ${line(account, 60)}${where}. The password is filled in.`
      : 'The password is filled in, but Psss could not save it. Do not submit the form yet.';
    generateEl.disabled = !saved.ok;
  }

  // ---------- rows ----------

  function render(target, rows, { main = false }) {
    target.replaceChildren(...rows.map((c) => row(c, main)));
  }

  // The second line: what the search matched with the matching part in bold, otherwise the account (or the website when the
  // name is the account, so the line says something the name does not) or the card ending.
  function subline(c) {
    const el = document.createElement('div');
    el.className = 's';
    const prefix = !c.matches && c.found === 'website' ? 'Saved for ' : '';
    el.append(document.createTextNode(prefix));
    if (c.hit !== undefined) {
      const [start, length] = c.hitRange ?? [0, 0];
      el.append(document.createTextNode(line(c.hit.slice(0, start), 100)));
      if (length) { const b = document.createElement('span'); b.className = 'hit'; b.textContent = line(c.hit.slice(start, start + length), 100); el.append(b); }
      el.append(document.createTextNode(line(c.hit.slice(start + length), 100)));
    } else {
      const same = !c.card && c.website && line(c.title) === line(c.account);
      el.append(document.createTextNode(line(same ? c.website : c.account)));
    }
    return el;
  }

  const hue = (text) => 1 + [...text].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 7) % 6;

  function row(c, main) {
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.ref = c.ref;
    const title = line(c.title);
    const tile = document.createElement('div');
    tile.className = `ic c${hue(title)}`;
    tile.setAttribute('aria-hidden', 'true');
    tile.textContent = [...title][0]?.toUpperCase() ?? '?';
    const text = document.createElement('div');
    text.className = 'grow';
    const name = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = title;
    name.append(strong);
    text.append(name, subline(c));
    if (!c.matches && c.website && c.found !== 'website') {
      const site = document.createElement('div');
      site.className = 's';
      site.textContent = `Saved for ${line(c.website)}`;
      text.append(site);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn${main && c.matches ? ' pri' : ''}`;
    button.textContent = c.card ? 'Fill card' : c.matches ? 'Fill' : 'Fill…';
    button.setAttribute('aria-label', `${c.matches ? 'Fill' : 'Fill, saved for another site:'} ${c.card ? title : line(c.account)} on ${line(pageHost)}`);
    button.addEventListener('click', () => (c.matches ? fill(c.ref, button, false, c.card) : confirmFill(li, c)));
    li.append(tile, text);
    if (c.passkey) {
      const trait = ICONS.passkey();
      trait.setAttribute('role', 'img');
      trait.removeAttribute('aria-hidden');
      trait.setAttribute('aria-label', 'Passkey');
      li.append(trait);
    }
    li.append(button);
    return li;
  }

  // A login saved for another site is released only after a second, explicit click that names both sites.
  function confirmFill(li, c) {
    const original = [...li.childNodes];
    const warning = document.createElement('p');
    warning.className = 'warning';
    warning.textContent = `${line(c.title)} is saved for ${line(c.website) || 'another site'}, not ${line(pageHost)}. Fill it here anyway?`;
    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'btn pri confirm-fill';
    fillBtn.textContent = 'Fill anyway';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn cancel';
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

  // ---------- start ----------

  await refreshVaults();
  await probeSignUp();
  if (!showVaultState(badge === '!' ? 'cancelled' : undefined)) return;
  await loadSite();
  drawCreate();
})();
