// Popup: list logins for the active tab and fill the one the person chooses. Opening the popup
// is the user gesture that grants activeTab; nothing runs on a page before that. The look is the app's list
// (popup.css); the search is the app's too: the host decides which field matched and how many logins match in each.
// Every string that comes from a vault or a page goes through Display.line and into textContent, never innerHTML.
(async function () {
  const $ = (id) => document.getElementById(id);
  const noticeEl = $('notice');
  const statusEl = $('status');
  const noticeUnlock = $('noticeunlock');
  const unlockBtn = $('unlock');
  const siteGroup = $('sitegroup');
  const forSiteEl = $('forsite');
  const siteNote = $('sitenote');
  const siteNoteBody = $('sitenotebody');
  const noticeTitle = $('noticetitle');
  const listEl = $('logins');
  const searchEl = $('search');
  const queryEl = $('q');
  const pillsEl = $('pills');
  const resultsEl = $('results');
  const createEl = $('create');
  const vaultBar = $('vaultbar');
  const vaultSelect = $('vaultselect');
  const line = Display.line;

  // One notice at a time. `kind` is info (accent) or warning (orange).
  const say = (text, kind = 'info') => {
    statusEl.textContent = text;
    noticeTitle.hidden = true;
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
    passkey: () => icon('trait icon', ['M14.5 14.5L21 8l-2-2-1.5 1.5M18 7l-2 2'], [['circle', { cx: 9, cy: 15, r: 4 }]]),
  };

  // The only setting is the browser's save prompt, which needs the optional `privacy` permission (not in Safari).
  // Every state with the normal header ends with the Settings button, except Psss not running (`notRunning`). Safari's manifest has
  // no `privacy` permission, so its popup has no Settings button.
  const settingsEl = $('settings');
  const hasSettings = api.runtime.getManifest().optional_permissions?.includes('privacy') === true;
  const footer = (visible) => { settingsEl.parentElement.hidden = !(visible && hasSettings); };
  footer(true);
  const notRunning = (text) => { say(text); footer(false); };
  // What the host says when it cannot reach the app, in the words the person sees. Everything else that fails is "could not be reached".
  const RELAY_WORDS = {
    [PROTOCOL.errors.notRunning]: 'Psss is not open.',
    [PROTOCOL.errors.notVerified]: 'Psss could not be verified.'
  };
  const relayDown = (error) => error === 'not-installed' || Object.hasOwn(RELAY_WORDS, error);
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
  let siteLogins = [];  // this site's logins in the chosen vault: what makes "Create" say "Update"
  // The vault the popup lists, fills from and saves into. It starts as the vault the app shows and changes only when the person
  // picks another here. Any number of vaults can be open, so there is no "the" open vault: every request names this one.
  let chosenId;
  const currentVault = () => Vaults.pick(vaults, chosenId);
  const vaultId = () => currentVault()?.id;
  const isOpen = () => { const v = currentVault(); return !v || v.state === 'open'; };  // no list at all: an older host, nothing to unlock
  const vaultName = (v, max = 32) => Vaults.name(v, max);

  // ---------- vaults: the button, the menu and what each state says ----------

  async function refreshVaults(list) {
    if (!list) {
      const reply = await Host.vaults();
      list = reply.ok && Array.isArray(reply.vaults) ? reply.vaults : [];
    }
    vaults = list;
    chosenId = currentVault()?.id;
    drawVaultBar();
  }

  // With two or more vaults: the vault glyph, then a plain native pick list of the vault names in the order the app reports them
  // (its fixed order: the chosen or shown vault is not moved first, an open vault is not moved up). Names only, no padlock: the
  // notice says when a vault is locked. No Lock and no Add Vault here: those are the app's.
  function drawVaultBar() {
    vaultBar.hidden = vaults.length < 2;
    vaultSelect.replaceChildren();
    if (vaultBar.hidden) return;
    for (const o of Vaults.options(vaults, chosenId)) {
      const option = document.createElement('option');
      option.value = o.value;
      option.textContent = o.text;
      option.selected = o.selected;
      vaultSelect.append(option);
    }
  }
  vaultSelect.addEventListener('change', () => {
    const v = vaults.find((x) => x.id === vaultSelect.value);
    if (v) chooseVault(v);
  });

  const notice = (v, hint) => Vaults.notice(v, hint, vaults.length);

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

  // Choosing a vault changes which vault the popup fills from. Other vaults stay as they are: none locks, and an open one needs no
  // unlock. The app is told too (it shows that vault, which is also what Unlock works on), but a refusal to switch never stops the
  // popup from using a vault that is open.
  async function chooseVault(v) {
    if (v.id === chosenId) return;
    const before = chosenId;
    chosenId = v.id;
    vaultSelect.disabled = true;
    const reply = await Host.switchVault(v.id);
    vaultSelect.disabled = false;
    if (reply.vaults) vaults = reply.vaults;
    if (!reply.ok && reply.error === PROTOCOL.errors.notFound) {
      chosenId = Vaults.pick(vaults, before)?.id;
      drawVaultBar();
      say('Psss could not switch vaults.', 'warning');
      return;
    }
    drawVaultBar();  // the pick list shows the vault chosen now
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
    if (Object.hasOwn(RELAY_WORDS, reply.error)) notRunning(RELAY_WORDS[reply.error]);
    else if (reply.error === 'not-installed') notRunning('Psss is not connected. Open the Psss app once, then try again.');
    else say(`Psss could not unlock ${vaultName(v)}.`, 'warning');
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
    const reply = await Host.candidates(origin, vaultId());
    if (!reply.ok) {
      siteGroup.hidden = true;
      if (reply.error === PROTOCOL.errors.locked || reply.error === PROTOCOL.errors.notAvailable) {
        // The vault closed since the list was read (a lock in the app): ask what it is now.
        await refreshVaults();
        if (!showVaultState()) return;
      }
      const words = {
        'not-installed': 'Psss is not connected. Open the Psss app once, then try again.',
        ...RELAY_WORDS,
        [PROTOCOL.errors.locked]: 'Psss is locked. Open the app to unlock.',
      }[reply.error] ?? 'Psss could not be reached.';
      if (reply.error === PROTOCOL.errors.locked) say(words); else notRunning(words);
      searchEl.hidden = reply.error === PROTOCOL.errors.locked || relayDown(reply.error);
      return;
    }
    searchEl.hidden = false;
    const logins = reply.candidates.map((c) => ({ ...c, matches: true }));
    siteLogins = logins;
    let sampleCards = [];
    if (checkout) {
      const cards = await Host.cardCandidates(origin, vaultId());
      if (cards.ok && cards.candidates.length) {
        sampleCards = cards.candidates.map((c) => ({ ...c, card: true, matches: true }));
      }
    }
    // The one login for the page is the default action, as in the app's picker.
    const rows = [...logins, ...sampleCards];
    render(listEl, rows, { main: rows.length === 1 });
    if (!rows.length) {
      // Nothing for this site here: a notice that names the vault and the ways on. Psss does not search the other vaults for the
      // person, and the notice has no button: the search field and the vault pick list are already on screen.
      siteNoteBody.textContent = `${vaultName(currentVault())} has none for this site. Search all logins above${vaults.length >= 2 ? ', or choose another vault' : ''}.`;
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
    b.textContent = label;
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
  // Two or more rows: Return does nothing, the person picks.
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
    const found = await Host.search(origin, query, [...chosen], vaultId());
    if (mine !== latest) return; // a newer search is on its way
    if (!found.ok) {
      if (found.error === PROTOCOL.errors.locked || found.error === PROTOCOL.errors.notAvailable) {
        // The chosen vault closed since the list was read: ask what it is now. Nothing from another vault is shown instead.
        await refreshVaults();
        showVaultState();
        return;
      }
      say('Psss could not search.');
      return;
    }
    // While searching, the results replace this site's list: the counts count every login, this site's included.
    siteGroup.hidden = true;
    pillsEl.hidden = false;
    drawPills(found.counts);
    // Two groups, as the app's list groups its rows. A group with no rows is left out.
    const { site, other } = Groups.split(found.results);
    const groups = [];
    if (site.length) groups.push(group('For This Site', site));
    if (other.length) groups.push(group('Other Matches', other));
    if (!groups.length) {
      const none = document.createElement('ul');
      none.className = 'card';
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'Nothing found.';
      none.append(li);
      groups.push(none);
    }
    resultsEl.replaceChildren(...groups);
  }

  // ---------- sign-up forms ----------

  // Generate a strong password, fill the password and its confirmation, and save the login, in one labeled action. The popup
  // closes when focus leaves it, so saving later could lose the password. The save happens with the click. The login goes into
  // the chosen vault, which the button names with two or more vaults; when that vault already has this site and username
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
      label.textContent = multi ? `${where} already has ${line(account, 60)} for this site.` : `${line(account, 60)} is already saved for this site.`;
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
    // The save goes into the vault named on the button. Check it is still open before anything is filled.
    const before = currentVault();
    const fresh = await Host.vaults();
    const now = fresh.ok ? fresh.vaults?.find((v) => v.id === before?.id) : undefined;
    if (before && (!now || now.state !== 'open')) {
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

  // A heading above a card of rows, outside the card.
  function group(title, rows) {
    const wrap = document.createElement('section');
    wrap.className = 'group';
    const head = document.createElement('h2');
    head.className = 's';
    head.textContent = title;
    const card = document.createElement('ul');
    card.className = 'card';
    render(card, rows, {});
    wrap.append(head, card);
    return wrap;
  }

  // The part of a field that matched the search, with the matching part in bold. `prefix` goes before it ("Saved for ").
  function hitLine(c, prefix = '') {
    const el = document.createElement('div');
    el.className = 's';
    el.append(document.createTextNode(prefix));
    const [start, length] = c.hitRange ?? [0, 0];
    el.append(document.createTextNode(line(c.hit.slice(0, start), 100)));
    if (length) { const b = document.createElement('span'); b.className = 'hit'; b.textContent = line(c.hit.slice(start, start + length), 100); el.append(b); }
    el.append(document.createTextNode(line(c.hit.slice(start + length), 100)));
    return el;
  }

  function plainLine(text, wraps = false) {
    const el = document.createElement('div');
    el.className = wraps ? 's wrap' : 's';
    el.textContent = text;
    return el;
  }

  // The lines under a name. A login for this page: its account (the page's own site is not repeated; none when the name is the
  // account), with the matched part in bold when the search found it in the username. A login in Other Matches: "Saved for <site>"
  // or "No website", never cut to one line, so a lookalike site can be read in full. A card: its ending.
  function sublines(c) {
    if (c.card) return [plainLine(line(c.account))];
    const lines = [];
    const inUsername = c.found === 'username' && c.hit !== undefined;
    if (c.matches) {
      const account = line(c.account);
      if (inUsername) lines.push(hitLine(c));
      else if (account && account !== line(c.title)) lines.push(plainLine(account));
      return lines;
    }
    if (inUsername) lines.push(hitLine(c));
    if (c.found === 'website' && c.hit !== undefined && Groups.savedSite(c)) lines.push(hitLine(c, 'Saved for '));
    else lines.push(plainLine(Groups.savedFor(c), true));
    return lines;
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
    text.append(name, ...sublines(c));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn${main && c.matches ? ' pri' : ''}`;
    button.textContent = c.card ? 'Fill card' : 'Fill';
    // Said for a person who cannot see the groups: the account, and for another site where it is saved.
    const account = c.card ? '' : line(c.account);
    const where = c.card || c.matches ? '' : `, ${Groups.savedFor(c).replace(/^./, (ch) => ch.toLowerCase())}`;
    button.setAttribute('aria-label', `${c.card ? 'Fill card' : 'Fill'} ${title}${account && account !== title ? `, ${account}` : ''}${where}`);
    button.addEventListener('click', () => fill(c.ref, button, !c.matches, c.card));
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

  async function fill(ref, button, manual, card = false) {
    button.disabled = true;
    // Revalidate: the tab may have navigated while the popup was open.
    const [current] = await api.tabs.query({ active: true, currentWindow: true });
    if (!current || current.id !== tab.id || !OriginPolicy.sameOrigin(current.url, origin)) {
      say('The page changed. Open Psss again.');
      return;
    }
    // `manual`: the login is in Other Matches, saved for another site or none. The person chose it in the list.
    const cred = card ? await Host.card(ref, origin, vaultId()) : await Host.credential(ref, origin, vaultId(), manual);
    if (!cred.ok && (cred.error === PROTOCOL.errors.locked || cred.error === PROTOCOL.errors.notAvailable)) {
      // The vault closed between the list and this click (a lock in the app): say so and offer Unlock. Nothing was released.
      await refreshVaults();
      showVaultState();
      return;
    }
    // The app released nothing because it had not shown that login for this page lately (the list is over five minutes old, or the
    // app locked or restarted since): listing again is the way forward.
    if (!cred.ok && cred.error === PROTOCOL.errors.notFound) { say('That list is out of date. Open Psss again.'); return; }
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
