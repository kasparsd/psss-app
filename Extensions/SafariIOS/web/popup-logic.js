// What the iPhone and iPad Safari popup does, without any DOM: which state it is in, what it asks Psss and the page, and the
// words it shows (docs/plans/ios-safari-fill.md, section 4; the approved mock is Design/Mocks `#/ios-safari-fill`).
// `popup.js` draws the views this returns. Uses `Display` (display.js) and `OriginPolicy` (origin.js) of the browser extension.
//
// Secrets: the values of a card or an address exist only inside `fill`, for that one tap. They are never part of a view, never
// stored, never logged, and the reference to them is dropped once they have gone to the page.
var SafariFillPopup = (function () {
  /** The only links the popup opens, both on a tap. The app side (slice 6) parses them. Neither carries anything secret. */
  const LINKS = Object.freeze({
    /** Opens Psss, unlocks this vault and lets Safari fill from it. Without a vault identifier Psss decides which one. */
    share: (vault) => 'psss://safari-fill' + (UUID.test(vault ?? '') ? `?vault=${vault}` : ''),
    /** Only opens Psss, to copy from an item. Safari is given nothing. */
    app: 'psss://open'
  });

  const UUID = /^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/;
  const REF = /^[0-9a-f]{32}\.[0-9A-F-]{36}$/;
  /**
   * How long the first load, a vault change or one Fill may take, with everything asked of Psss and of Safari, before the popup
   * gives up. The first answer of Psss has taken about 10 seconds on a busy Mac.
   */
  const TIMEOUT = 20000;
  const SLOW = Object.freeze({ slow: true });
  const MAX_VAULTS = 50, MAX_ROWS = 100, MAX_TEXT = 4096;

  // For each role the page may report: the role asked from Psss (and the key of its value), and the word for it in a sentence.
  const ROLES = {
    card: {
      'cc-name': ['cc-name', 'name on card'], 'cc-number': ['cc-number', 'card number'], 'cc-exp': ['cc-exp', 'expiry'],
      'cc-exp-month': ['cc-exp', 'expiry'], 'cc-exp-year': ['cc-exp', 'expiry'], 'cc-csc': ['cc-csc', 'security code']
    },
    address: {
      name: ['name', 'name'], 'given-name': ['name', 'name'], 'family-name': ['name', 'name'], organization: ['organization', 'company'],
      'street-address': ['street-address', 'street address'], 'address-line1': ['street-address', 'street address'],
      'address-line2': ['street-address', 'street address'], 'address-level2': ['address-level2', 'city'],
      'address-level1': ['address-level1', 'region'], 'postal-code': ['postal-code', 'postal code'], country: ['country', 'country'],
      'country-name': ['country', 'country'], email: ['email', 'email'], tel: ['tel', 'phone']
    }
  };
  const known = (kind, role) => typeof role === 'string' && Object.hasOwn(ROLES[kind], role);

  /** What `release` is asked for: what the page reported, as the values it is made from, and always the number of a card. */
  function requestRoles(kind, pageRoles) {
    const asked = pageRoles.filter((role) => known(kind, role)).map((role) => ROLES[kind][role][0]);
    return [...new Set(kind === 'card' ? ['cc-number', ...asked] : asked)];
  }

  /** The origin of a page that may be filled: HTTPS only, in every build. */
  function secureOrigin(url) {
    const origin = OriginPolicy.fillableOrigin(url);
    return origin?.startsWith('https://') ? origin : null;
  }

  // ---------- replies ----------

  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value) => typeof value === 'string' && value.length <= MAX_TEXT;
  const list = (value, max, item) => Array.isArray(value) && value.length <= max && value.every((entry) => object(entry) && item(entry));

  /** The rows of a `status` reply, or null when it is not one. */
  function readStatus(reply) {
    const good = list(reply.vaults, MAX_VAULTS, (v) => UUID.test(v.id) && text(v.name) && typeof v.ready === 'boolean') &&
      list(reply.cards, MAX_ROWS, (c) => REF.test(c.ref) && text(c.title) && text(c.brand) && /^[0-9]{4}$/.test(c.lastFour) &&
        (c.expiry === undefined || /^[0-9]{4}-[0-9]{2}$/.test(c.expiry)) && typeof c.hasCode === 'boolean') &&
      list(reply.addresses, MAX_ROWS, (a) => REF.test(a.ref) && text(a.label) && text(a.fullName) && text(a.city));
    return good ? { vaults: reply.vaults, cards: reply.cards, addresses: reply.addresses } : null;
  }

  /** The values of a `release` reply that the page fill may get, or null when it is not one. */
  function readFields(reply, kind) {
    if (!object(reply.fields)) return null;
    const wanted = new Set(Object.values(ROLES[kind]).map(([key]) => key));
    const fields = {};
    for (const [key, value] of Object.entries(reply.fields)) {
      if (!wanted.has(key)) continue;
      if (!text(value)) return null;
      fields[key] = value;
    }
    return fields;
  }

  // ---------- words ----------

  // A name from the vault is a part of its own, so the page can keep its writing direction away from the words around it.
  const named = (name) => ({ name: Display.line(name) || 'Vault' });
  const joined = (words) => words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
  const capital = (words) => words.charAt(0).toUpperCase() + words.slice(1);

  /**
   * What a Fill did, from role names only. `page` is what the page had places for, in its order; `saved` says whether the item
   * had a value for a role; `written` is what the page fill wrote. A field with a saved value and a place that was not written
   * was missed. A word whose places were written only in part (one of two street boxes, a month without its year) has a
   * sentence of its own: either of the others would be false.
   */
  function summary(kind, page, saved, written) {
    const wrote = new Set(written.filter((role) => known(kind, role)));
    const order = [...new Set([...page.filter((role) => known(kind, role)), ...wrote])];
    const missed = new Set(order.filter((role) => !wrote.has(role) && saved(role)).map((role) => ROLES[kind][role][1]));
    const done = new Set(order.filter((role) => wrote.has(role)).map((role) => ROLES[kind][role][1]).filter((word) => !missed.has(word)));
    const part = new Set(order.filter((role) => wrote.has(role)).map((role) => ROLES[kind][role][1]));
    const untouched = [...missed].filter((word) => !part.has(word));
    const sentences = [];
    if (done.size) sentences.push(`${capital(joined([...done]))} ${done.size > 1 ? 'are' : 'is'} in the form.`);
    if (untouched.length) {
      const many = untouched.length > 1;
      sentences.push(`${capital(joined(untouched))} ${many ? 'were' : 'was'} not filled. Type ${many ? 'them' : 'it'} on the page.`);
    }
    for (const word of missed) if (part.has(word)) sentences.push(`Part of the ${word} was not filled. Check it on the page.`);
    return { partly: missed.size > 0, text: sentences.join(' ') };
  }

  function savedIn(kind, fields) {
    return (role) => {
      const value = fields[ROLES[kind][role][0]];
      if (!value) return false;
      // A second street box has something to hold only when the street has a second line.
      return role !== 'address-line2' || value.split(/\r?\n/).slice(1).join('').trim() !== '';
    };
  }

  function cardRow(card) {
    const brand = card.brand === 'American Express' ? 'Amex' : Display.line(card.brand, 40);
    const expiry = card.expiry ? `${card.expiry.slice(5)}/${card.expiry.slice(2, 4)}` : '';
    const name = Display.line(card.title) || 'Card';
    return {
      ref: card.ref, name,
      detail: [`${brand} •• ${card.lastFour}`.trim(), expiry].filter(Boolean).join(' · '),
      label: [`Fill ${name}`, `${brand} ending ${card.lastFour}`.trim(), expiry && `expires ${expiry}`].filter(Boolean).join(', ')
    };
  }

  function addressRow(address) {
    const name = Display.line(address.label) || 'Address';
    const detail = [address.fullName, address.city].map((part) => Display.line(part)).filter(Boolean).join(' · ');
    return { ref: address.ref, name, detail, label: [`Fill ${name}`, detail].filter(Boolean).join(', ') };
  }

  // ---------- notices ----------

  const notice = (kind, textParts, { title, open } = {}) => ({ type: 'notice', kind, title, text: [textParts].flat(), open });
  const warning = (title, words, open) => notice('warning', words, { title, open });
  const BLOCKED = {
    'not-allowed': () => warning('Safari hasn’t allowed Psss on this page', 'Nothing was filled. Close this, open Psss again, and allow it if Safari asks.'),
    insecure: () => warning('This page isn’t secure', 'Psss fills only pages that use HTTPS. Nothing was filled.'),
    changed: () => warning('The page changed', 'Nothing was filled. Close this and open Psss again.')
  };
  const unavailable = () => warning('Psss can’t fill right now', 'Nothing was filled. Open Psss, then try again in Safari.', LINKS.share());
  const locked = (vault, tapped) => notice('info',
    [tapped ? 'Nothing was filled. ' : '', named(vault.name), ' is locked. Open Psss to unlock it.'], { open: LINKS.share(vault.id) });
  const paymentFrame = () => [
    notice('info', 'This page’s card form belongs to its payment provider, so Psss can’t fill it. Open Psss to copy the number.',
      { title: 'Card fields are in a payment frame' }),
    { type: 'open', open: LINKS.app }
  ];
  const nothingRecognized = () => notice('info', 'Psss found no card or address fields on this page.');
  const loading = () => notice('progress', 'Loading cards and addresses…');
  // The values went to the page and what happened to them is unknown, or the page did not keep one as written. Nothing is
  // claimed either way; Psss is offered for copying.
  const unknown = () => warning('Check the form',
    'Psss couldn’t confirm what was filled. Check the fields on this page, or open Psss to copy the details.', LINKS.app);
  const noVault = () => notice('info', 'Open Psss to create or open a vault. Then come back to Safari and try again.',
    { title: 'No vault yet', open: LINKS.app });

  // ---------- the popup ----------

  /**
   * `api` is the browser's extension API, `pageFill` the injected function (page-fill.js), `show` draws a view and `close`
   * closes the popup. A view is `{ header, parts, busy, result }`; `header` lists the vaults, or is null, and
   * `result` marks what a Fill ended in. The popup has no Done button of its own: Safari draws Done above it.
   */
  function create({ api, pageFill, show, close, timeout = TIMEOUT }) {
    let tab, origin, page, status, chosen;
    let view = { header: null, parts: [], busy: false, result: false };
    let latest = 0;
    let busy = false;

    // Whatever is drawn while a Fill runs is its result.
    const draw = (next) => { view = { header: null, parts: [], busy: false, result: busy, ...next }; show(view); };
    const header = () => status?.vaults.length
      ? { chosen, vaults: status.vaults.map((v) => ({ id: v.id, name: Display.line(v.name, 40) || 'Vault' })) }
      : null;
    const vault = () => status.vaults.find((v) => v.id === chosen);
    const cannot = () => draw({ parts: [unavailable()] });
    const blocked = (reason) => reason === 'slow' ? cannot() : draw({ header: reason === 'changed' ? header() : null, parts: [BLOCKED[reason]()] });
    const unconfirmed = () => draw({ header: header(), parts: [unknown()] });
    const recognized = () => page.card.length > 0 || page.address.length > 0;

    const deadline = () => Date.now() + timeout;
    /** What `call` answers by `end`. Throws SLOW without calling when that time has passed, and when no answer comes by then. */
    async function within(end, call) {
      const left = end - Date.now();
      if (left <= 0) throw SLOW;
      let timer;
      try {
        return await Promise.race([call(), new Promise((_, refuse) => { timer = setTimeout(() => refuse(SLOW), left); })]);
      } finally {
        clearTimeout(timer);
      }
    }

    const activeTab = async (end) => (await within(end, () => api.tabs.query({ active: true, currentWindow: true })))[0];
    const inject = async (end, args) => {
      const [injection] = await within(end, () => api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: pageFill, args }));
      if (!injection || injection.error || !injection.result) throw new Error('no result');
      return injection.result;
    };
    /** Role names only: `{ card, address, paymentFrame }`, or null when the top frame is no longer the page that was listed. */
    const probe = async (end) => {
      const result = await inject(end, [{}, 'probe', origin, { pageOrder: true }]);
      return Array.isArray(result.card) && Array.isArray(result.address) ? result : null;
    };

    /** The same tab, still on the same secure origin, in its top frame: `{ page }`, or `{ reason }` it may not be filled. */
    async function check(end) {
      try {
        const now = await activeTab(end);
        if (!now || now.id !== tab.id) return { reason: 'changed' };
        if (!now.url) return { reason: 'not-allowed' };
        if (secureOrigin(now.url) !== origin) return { reason: 'changed' };
        const found = await probe(end);
        return found ? { page: found } : { reason: 'changed' };
      } catch (error) {
        return { reason: error === SLOW ? 'slow' : 'not-allowed' };
      }
    }

    /** One request to the handler. Always answers; anything that is not a reply of this protocol is `unavailable`. */
    async function ask(end, message) {
      try {
        const reply = await within(end, () => api.runtime.sendNativeMessage('app.psss.Psss', { v: 1, ...message }));
        if (object(reply) && reply.v === 1 && (reply.ok === true || (reply.ok === false && typeof reply.error === 'string'))) return reply;
      } catch {
        // Nothing of an error is shown or kept.
      }
      return { ok: false, error: 'unavailable' };
    }

    async function askStatus(end) {
      const reply = await ask(end, { type: 'status', origin });
      return reply.ok ? readStatus(reply) : null;
    }

    /** The cards and addresses of the chosen vault that the page has places for. `above` goes first. */
    function listView(above) {
      const current = vault();
      if (!current.ready) {
        // Nothing of the ready vault is shown under another vault's name.
        return draw({ header: header(), parts: recognized() ? [locked(current, false)] : page.paymentFrame ? paymentFrame() : [nothingRecognized()] });
      }
      const parts = above ? [above] : [];
      if (page.paymentFrame && !page.card.length) parts.push(...paymentFrame());
      if (page.card.length) {
        if (status.cards.length) parts.push({ type: 'group', kind: 'card', heading: 'Cards for This Page', rows: status.cards.map(cardRow) });
        else {
          parts.push(notice('info', `Add a card in Psss.${status.vaults.length > 1 ? ' Or choose another vault above.' : ''}`,
            { title: ['No cards in ', named(current.name)], open: LINKS.share(current.id) }));
        }
      }
      if (page.address.length) {
        if (status.addresses.length) {
          parts.push({ type: 'group', kind: 'address', heading: 'Addresses for This Page', rows: status.addresses.map(addressRow) });
        } else {
          parts.push(notice('info', 'Open Psss to add one.', { title: ['No addresses in ', named(current.name)], open: LINKS.share(current.id) }));
        }
      }
      if (!recognized() && !page.paymentFrame) parts.push(nothingRecognized());
      draw({ header: header(), parts });
    }

    /** Takes a fresh status and keeps the chosen vault when it is still listed. */
    function take(next) {
      status = next;
      if (!next.vaults.some((v) => v.id === chosen)) chosen = (next.vaults.find((v) => v.ready) ?? next.vaults[0])?.id;
    }

    async function load(end) {
      const mine = ++latest;
      const next = await askStatus(end);
      if (mine !== latest) return;
      // A page with nothing to fill says so whether or not Psss answers.
      const bare = !recognized();
      if (!next) { if (!bare) cannot(); return; }
      take(next);
      if (!next.vaults.length) { if (!bare) draw({ parts: [noVault()] }); return; }
      listView();
    }

    async function start() {
      draw({ parts: [loading()] });
      const end = deadline();
      try {
        tab = await activeTab(end);
      } catch (error) {
        if (error === SLOW) return cannot();
        tab = undefined;
      }
      if (!tab?.url) return blocked('not-allowed');
      origin = secureOrigin(tab.url);
      if (!origin) return blocked('insecure');
      try {
        page = await probe(end);
      } catch (error) {
        return blocked(error === SLOW ? 'slow' : 'not-allowed');
      }
      if (!page) return blocked('changed');
      if (!recognized()) draw({ parts: page.paymentFrame ? paymentFrame() : [nothingRecognized()] });
      await load(end);
    }

    async function choose(id) {
      if (busy || id === chosen || !status?.vaults.some((v) => v.id === id)) return;
      chosen = id;
      draw({ header: header(), parts: [loading()] });
      await load(deadline());
    }

    /** One tap on Fill. A second tap while this runs does nothing. */
    async function fill(kind, ref) {
      if (busy || !status || !Object.hasOwn(ROLES, kind)) return;
      const row = (kind === 'card' ? status.cards : status.addresses).find((entry) => entry.ref === ref);
      if (!row || !vault()?.ready) return;
      busy = true;
      show({ ...view, busy: true });
      const attempt = { end: deadline(), written: false };
      try {
        await release(kind, row, attempt);
      } catch {
        if (attempt.written) unconfirmed();
        else cannot();
      } finally {
        busy = false;
      }
    }

    async function release(kind, row, attempt) {
      const { end } = attempt;
      const name = kind === 'card' ? cardRow(row).name : addressRow(row).name;
      const nothing = () => draw({
        header: header(),
        parts: [warning('Nothing was filled', ['This page’s fields didn’t take ', named(name), '. Open Psss to copy the details.'], LINKS.app)]
      });
      let now = await check(end);
      if (now.reason) return blocked(now.reason);
      page = now.page;
      if (!page[kind].length) return nothing();
      const reply = await ask(end, { type: 'release', origin, vault: chosen, kind, ref: row.ref, roles: requestRoles(kind, page[kind]) });
      if (!reply.ok) {
        if (reply.error === 'locked') {
          // Nothing is ready any more.
          status = { ...status, cards: [], addresses: [], vaults: status.vaults.map((v) => ({ ...v, ready: false })) };
          return draw({ header: header(), parts: [locked(vault(), true)] });
        }
        if (reply.error !== 'not-found') return cannot();
        const next = await askStatus(end);
        if (!next) return cannot();
        if (!next.vaults.length) return draw({ parts: [noVault()] });
        take(next);
        if (!vault().ready) return draw({ header: header(), parts: [locked(vault(), true)] });
        return listView(notice('warning', 'Nothing was filled. Tap Fill again.'));
      }
      let fields = readFields(reply, kind);
      if (!fields) return cannot();
      now = await check(end);
      if (now.reason) { fields = null; return blocked(now.reason); }
      page = now.page;
      const roles = page[kind];
      const saved = savedIn(kind, fields);
      const had = new Set(roles.filter((role) => known(kind, role) && saved(role)));
      const noCode = kind === 'card' && !fields['cc-csc'] && !row.hasCode;
      if (Date.now() >= end) { fields = null; return cannot(); }
      let result;
      attempt.written = true;
      try {
        // The page writes nothing after `until`, which is when the popup stops waiting.
        result = await inject(end, [fields, kind, origin, { until: end, ...(noCode ? { focusEmptyCode: true } : {}) }]);
      } catch {
        return unconfirmed();
      } finally {
        fields = null;
      }
      if (!Array.isArray(result.filled) || (result.left !== undefined && result.left?.length !== 0)) return unconfirmed();
      const written = result.filled.filter((role) => known(kind, role));
      if (!written.length) {
        // The page answered: nothing it was given is in it.
        const after = await check(end);
        return after.reason === 'changed' ? blocked('changed') : nothing();
      }
      const done = summary(kind, roles, (role) => had.has(role), written);
      const parts = [done.partly ? warning(['Partly filled ', named(name)], done.text) : notice('info', done.text, { title: ['Filled ', named(name)] })];
      if (noCode && roles.includes('cc-csc')) parts.push({ type: 'text', text: 'Tap the security code field and enter the code from your card.' });
      draw({ header: header(), parts });
    }

    /** Safari asks about the link over the page in front, so the popup closes to let the question be seen. */
    async function open(url) {
      if (url !== LINKS.app && !url?.startsWith(LINKS.share())) return;
      try {
        const end = deadline();
        // Half the time for finding the tab, so some is left to open the link.
        const now = await activeTab(end - timeout / 2).catch(() => undefined);
        await within(end, () => api.tabs.update(now?.id ?? tab.id, { url }));
      } catch {
        return;  // the popup stays, with its button
      }
      close();
    }

    return { start, choose, fill, open };
  }

  return { LINKS, create, requestRoles, secureOrigin, readStatus, readFields, summary, cardRow, addressRow };
})();
if (typeof module !== 'undefined') module.exports = { SafariFillPopup };
