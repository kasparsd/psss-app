// Injected into the top frame. Everything it needs lives inside the function because
// scripting.executeScript serializes it. Values never come back to the extension: the result holds role names only.
//
// Modes: 'login', 'card', 'address' (write the released `fields`, keyed by autocomplete role), 'probe-card' ({ checkout: true } when
// there is a card number field) and 'probe' ({ card: [roles], address: [roles], paymentFrame }). Probes write nothing.
// `options` (the iPhone popup): `pageOrder` lists a probe's roles in the order of their fields on the page, and `focusEmptyCode`
// focuses the security code field after a card fill that had no code to write.
function psssFillPage(fields, mode, expectedOrigin, options = {}) {
  const result = { filled: [] };
  if (window !== window.top || location.origin !== expectedOrigin) return result;

  const loginAliases = {
    username: ['username', 'user', 'login', 'loginname', 'email', 'account', 'accountname'],
    'current-password': ['password', 'currentpassword', 'loginpassword'],
    'one-time-code': ['otp', 'totp', 'verificationcode', 'onetimecode']
  };
  // Each list is English first, then German, French, Spanish, Italian, Dutch, Polish, Portuguese and Latvian, folded (no accents).
  // Words that mean two things in a checkout (nombre, nome, cp, cap, rue) are left out.
  const words = (text) => text.split(/\s+/).filter(Boolean);
  const cardAliases = {
    'cc-number': ['cardnumber', 'cardno', 'creditcardnumber', 'ccnumber', 'ccnum', 'cardnum', ...words(`
      kartennummer kreditkartennummer kartennr kreditkartennr
      numerodecarte numerocarte numerodelacarte numerodecartebancaire
      numerodetarjeta numerotarjeta numerodelatarjeta
      numerodicarta numerocarta numerodellacarta
      kaartnummer creditcardnummer kaartnr
      numerkarty numerkartykredytowej nrkarty
      numerodocartao numerocartao numerodecartao
      kartesnumurs kartesnr bankaskartesnumurs kreditkartesnumurs`)],
    'cc-name': ['nameoncard', 'cardholder', 'cardholdername', 'ccname', 'cardholdersname', 'cardname', ...words(`
      karteninhaber karteninhabername nameaufderkarte namedeskarteninhabers
      titulairedelacarte nomsurlacarte nomdutitulaire nomdutitulairedelacarte
      titulardelatarjeta nombreenlatarjeta nombredeltitular
      intestatariodellacarta nomesullacarta titolaredellacarta
      kaarthouder naamopkaart naamopdekaart naamkaarthouder naamvandekaarthouder
      wlascicielkarty posiadaczkarty imieinazwiskonakarcie imieinazwiskowlascicielakarty
      titulardocartao nomenocartao nomedotitular
      kartesturetajs kartesipasnieks vardsuzkartes`)],
    'cc-exp': ['expiry', 'expiration', 'expirationdate', 'expirydate', 'validthru', 'ccexp', 'expdate', 'ccexpdate', 'cardexpiry',
      'cardexpiration', 'cardexp', ...words(`
      gultigbis ablaufdatum gultigkeitsdatum verfallsdatum
      datedexpiration dateexpiration datedecheance
      fechadecaducidad fechadeexpiracion fechadevencimiento caducidad vencimiento validohasta
      datadiscadenza scadenza
      vervaldatum geldigtot
      datawaznosci terminwaznosci waznado
      datadevalidade datadeexpiracao validade validoate
      derigslidz derigumatermins`)],
    'cc-exp-month': ['expirymonth', 'expirationmonth', 'ccexpmonth', 'expmonth', ...words(`
      ablaufmonat
      moisdexpiration
      mesdeexpiracion mesdecaducidad mesdevencimiento
      mesediscadenza
      vervalmaand
      miesiacwaznosci miesiacwygasniecia
      mesdevalidade mesdeexpiracao
      derigumamenesis`)],
    'cc-exp-year': ['expiryyear', 'expirationyear', 'ccexpyear', 'expyear', ...words(`
      ablaufjahr
      anneedexpiration
      anodeexpiracion anodecaducidad anodevencimiento
      annodiscadenza
      vervaljaar
      rokwaznosci rokwygasniecia
      anodevalidade anodeexpiracao
      derigumagads`)],
    'cc-csc': ['cvv', 'cvc', 'cvv2', 'cvc2', 'cvvcode', 'cvccode', 'cccsc', 'cardcvv', 'cardcvc', 'cardsecuritycode',
      'cardverification', 'cardverificationcode', 'cardverificationvalue', ...words(`
      securitycode
      sicherheitscode kartenprufnummer
      codedesecurite cryptogramme cryptogrammevisuel
      codigodeseguridad
      codicedisicurezza
      beveiligingscode controlegetal
      kodbezpieczenstwa kodcvv kodcvc
      codigodeseguranca
      drosibaskods cvvkods cvckods`)]
  };
  // Boxes called only this (in any of these languages) are what sign-in checks and captchas are called too.
  const genericCodes = words(`securitycode sicherheitscode codigodeseguridad codedesecurite codicedisicurezza beveiligingscode
    kodbezpieczenstwa drosibaskods codigodeseguranca`);
  const addressAliases = {
    name: ['name', 'fullname', 'recipient', 'recipientname', ...words(`
      vollername vollstandigername
      nomcomplet
      nombrecompleto nombreyapellidos
      nomecompleto nominativo
      volledigenaam
      imieinazwisko
      pilnsvards vardsuzvards`)],
    'given-name': ['firstname', 'givenname', 'fname', ...words(`
      vorname
      prenom
      primernombre
      voornaam
      imie
      primeironome
      vards`)],
    'family-name': ['lastname', 'familyname', 'surname', 'lname', ...words(`
      nachname familienname
      nomdefamille nomfamille
      apellido apellidos
      cognome
      achternaam familienaam
      nazwisko
      apelido sobrenome
      uzvards`)],
    organization: ['organization', 'organisation', 'company', 'companyname', ...words(`
      firmenname unternehmen
      societe entreprise nomdelentreprise
      empresa compania nombredelaempresa
      azienda societa ragionesociale
      bedrijf bedrijfsnaam
      nazwafirmy
      nomedaempresa
      uznemums uznemumanosaukums kompanija organizacija`)],
    'street-address': ['streetaddress', ...words(`
      strasseundhausnummer
      direccioncompleta
      indirizzocompleto
      straatenhuisnummer
      ulicainumerdomu
      moradacompleta
      pilnaadrese`)],
    'address-line1': ['address', 'address1', 'addressline1', 'addr1', 'street', 'street1', ...words(`
      adresse adresse1 adresszeile1 strasse strasse1 anschrift
      direccion direccion1 calle
      indirizzo indirizzo1
      adres adres1 adresregel1 straat straatnaam
      ulica
      endereco endereco1 morada logradouro
      adrese adrese1 adresesrinda1 iela`)],
    'address-line2': ['address2', 'addressline2', 'addr2', 'street2', 'apartment', 'apt', 'suite', 'apartmentsuite', ...words(`
      adresse2 adresszeile2 adresszusatz
      complementdadresse
      direccion2
      indirizzo2
      adres2 adresregel2
      endereco2 complemento
      adrese2 adresesrinda2 dzivoklis`)],
    'address-level2': ['city', 'town', 'towncity', 'locality', ...words(`
      ort stadt wohnort
      ville commune
      ciudad localidad poblacion municipio
      citta comune localita
      plaats stad woonplaats
      miasto miejscowosc
      cidade
      pilseta`)],
    'address-level1': ['state', 'province', 'stateprovince', 'region', 'county', ...words(`
      bundesland bundesstaat kanton
      provincia comunidadautonoma
      provincie
      wojewodztwo
      distrito
      regions`)],
    'postal-code': ['postalcode', 'postcode', 'postal', 'zip', 'zipcode', ...words(`
      postleitzahl plz
      codepostal
      codigopostal
      codicepostale
      kodpocztowy
      pastaindekss pastakods`)],
    country: ['country', 'countrycode', ...words(`
      land
      pays
      pais
      paese nazione
      kraj
      valsts`)],
    'country-name': ['countryname', ...words(`
      landesname landnaam
      nomdupays
      nombredelpais
      nomedelpaese
      nazwakraju
      nomedopais
      valstsnosaukums`)],
    email: ['email', 'emailaddress', 'emailadresse', ...words(`
      adresseemail adressemail courriel
      correoelectronico
      indirizzoemail postaelettronica
      emailadres
      adresemail
      enderecodeemail correioeletronico correioelectronico
      epasts epastaadrese`)],
    tel: ['tel', 'telephone', 'phone', 'phonenumber', 'mobile', ...words(`
      telefon telefonnummer handy handynummer mobiltelefon
      numerodetelephone
      telefono movil numerodetelefono
      cellulare numeroditelefono
      telefoonnummer telefoon mobielnummer mobiel
      numertelefonu
      telefone telemovel celular numerodetelefone
      talrunis talrunanumurs`)]
  };
  // Folded as a browser would match a name: accents and compatibility forms removed, a few letters spelled out.
  const plain = (value) => String(value ?? '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
  const normalize = (value) => plain(value).replace(/[^a-z0-9]/g, '');

  // A page can be built to make every look slow. Past this, a card or address fill writes nothing more.
  let deadline = Date.now() + 2000;
  const LATE = {};
  const tick = () => { if (Date.now() > deadline) throw LATE; };
  const timed = (look, none) => () => {
    try { return look(); } catch (error) { if (error !== LATE) throw error; return none; }
  };

  // A form control or a named image can stand in for a property of its form or of the document (`<input name="parentNode">`),
  // so those are read through the interface's own getters and methods.
  const dom = (node, type, name) => {
    const get = typeof globalThis[type] === 'function' ? Object.getOwnPropertyDescriptor(globalThis[type].prototype, name)?.get : undefined;
    return get ? get.call(node) : node[name];
  };
  const call = (node, type, name, ...args) => (globalThis[type]?.prototype?.[name] ?? node[name])?.apply(node, args);
  const query = (selector) => [...call(document, 'Document', 'querySelectorAll', selector)];
  // The parent in the tree as it is drawn: a slot for a slotted element, a shadow root's host.
  const up = (node) => {
    const slot = dom(node, 'Element', 'assignedSlot');
    if (slot) return slot;
    const parent = dom(node, 'Node', 'parentNode');
    if (!parent) return null;
    const type = dom(parent, 'Node', 'nodeType');
    return type === 11 ? parent.host ?? null : type === 9 ? null : parent;
  };
  const MAX_DEPTH = 512;
  const chains = new Map();
  // The containers of an element, nearest first, or undefined when it is nested deeper than any real page.
  const ancestors = (element) => {
    if (!chains.has(element)) {
      let list = [];
      for (let node = up(element); node; node = up(node)) {
        if (list.length === MAX_DEPTH) { list = undefined; break; }
        list.push(node);
      }
      chains.set(element, list);
    }
    return chains.get(element);
  };

  // Logins keep the plain test. Cards and addresses use `seen`, which also rejects what a person cannot see.
  const visible = (input) => {
    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return rect.width > 0 && rect.height > 0 && style.visibility === 'visible' &&
      style.display !== 'none' && !input.matches(':disabled') && !input.readOnly;
  };
  // Smaller than this in either direction is not a field a person can use.
  const MIN_SIZE = 10;
  const box = (element) => call(element, 'Element', 'getBoundingClientRect');
  const faint = (color) => {
    const alpha = /^rgba\([^)]*,\s*([\d.]+)\)$|\/\s*([\d.]+)%?\s*\)$/.exec(color ?? '');
    return color === 'transparent' || Boolean(alpha && Number(alpha[1] ?? alpha[2]) < 0.1);
  };
  // A field with no text colour, border or background of its own shows nothing.
  const colourless = (style) => faint(style.color) && faint(style.webkitTextFillColor || style.color) &&
    faint(style.backgroundColor) && (style.backgroundImage || 'none') === 'none' && (style.boxShadow || 'none') === 'none' &&
    noBorder(style);
  // What a hit test does not see: paint that is see-through, masked or turned away.
  const painted = (element, chain) => {
    let opacity = 1;
    let backface = false;
    let turned = false;
    for (const node of [element, ...chain]) {
      const style = getComputedStyle(node);
      if (style.display === 'none') return false;
      opacity *= Number(style.opacity || 1);
      const filter = style.filter || '';
      if (/url\(/.test(filter)) return false;
      for (const [, amount, percent] of filter.matchAll(/opacity\(([\d.]+)(%?)\)/g)) opacity *= percent ? amount / 100 : Number(amount);
      if ([style.maskImage, style.webkitMaskImage].some((mask) => mask && mask !== 'none')) return false;
      backface ||= style.backfaceVisibility === 'hidden';
      const matrix = /^matrix3d\((.+)\)$/.exec(style.transform || '');
      turned ||= Boolean(matrix && Number(matrix[1].split(',')[10]) < 0) || /[xy\s].*(?:deg|rad|turn)/.test(style.rotate || '');
    }
    const own = getComputedStyle(element);
    return opacity >= 0.1 && own.visibility === 'visible' && !(backface && turned) && !colourless(own);
  };

  const noBorder = (style) => ['Top', 'Right', 'Bottom', 'Left']
    .every((side) => !parseFloat(style['border' + side + 'Width']) || faint(style['border' + side + 'Color']));
  // Whether an element lying over a field leaves it showing: it has no background, border, shadow or picture of its own.
  // A custom element or one with a shadow root may draw anything.
  const clear = (node) => !/^(?:img|canvas|video|picture|iframe|object|embed|input|textarea|select|button|progress|meter)$|-/i
    .test(dom(node, 'Element', 'tagName')) && !dom(node, 'Element', 'shadowRoot') &&
    !/svg/.test(dom(node, 'Element', 'namespaceURI') ?? '') && [undefined, '::before', '::after', '::first-line'].every((pseudo) => {
      const style = getComputedStyle(node, pseudo);
      if (/before|after/.test(pseudo ?? '') && /^(?:|none|normal)$/.test(style.content ?? '')) return true;
      return faint(style.backgroundColor) && noBorder(style) && [style.backgroundImage, style.boxShadow, style.backdropFilter,
        style.webkitBackdropFilter, style.outlineStyle, style.borderImageSource, style.textDecorationLine]
        .every((value) => !value || value === 'none');
    });

  // The final word on whether a field shows: bring its middle into view as a person could (scrolling what scrolls, never what
  // only cuts off), ask the page what is drawn there, and put every scroll position back. Clipping of every kind, being
  // off the page, behind something, inert or behind a modal dialog all end with the field not being the thing on top.
  // `at` is where in the view to put the field (0.5 the middle); without it, nothing moves unless the field is out of view.
  const hit = (element, chain, at) => {
    const root = dom(document, 'Document', 'documentElement');
    const body = dom(document, 'Document', 'body');
    const width = Math.min(dom(root, 'Element', 'clientWidth') || window.innerWidth, window.innerWidth);
    const height = Math.min(dom(root, 'Element', 'clientHeight') || window.innerHeight, window.innerHeight);
    const rootStyle = getComputedStyle(root);
    const bodyStyle = body ? getComputedStyle(body) : rootStyle;
    // The root's overflow, or the body's when the root says nothing, belongs to the window.
    const fromBody = (rootStyle.overflowX || 'visible') === 'visible' && (rootStyle.overflowY || 'visible') === 'visible';
    const pageStyle = fromBody ? bodyStyle : rootStyle;
    const scrolls = (value) => /auto|scroll/.test(value || '');
    const locked = (value) => /hidden|clip/.test(value || '');
    // How far to scroll so that `middle` lands in the span, or 0 when it may stay.
    const off = (middle, from, size, share = 0.5) => at === undefined && middle >= from && middle <= from + size
      ? 0 : middle - (from + size * share);
    const centre = () => { const r = box(element); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const moved = [];
    const startX = window.scrollX;
    const startY = window.scrollY;
    try {
      for (const node of chain) {
        if (node === root || (node === body && fromBody)) continue;
        const style = getComputedStyle(node);
        if (!scrolls(style.overflowX) && !scrolls(style.overflowY)) continue;
        const [x, y] = centre();
        const outer = box(node);
        const dx = scrolls(style.overflowX) ? off(x, outer.left, outer.width) : 0;
        const dy = scrolls(style.overflowY) ? off(y, outer.top, outer.height, at) : 0;
        if (!dx && !dy) continue;
        moved.push([node, dom(node, 'Element', 'scrollLeft'), dom(node, 'Element', 'scrollTop')]);
        call(node, 'Element', 'scrollBy', { left: dx, top: dy, behavior: 'instant' });
      }
      const [x, y] = centre();
      const dx = locked(pageStyle.overflowX) ? 0 : off(x, 0, width);
      const dy = locked(pageStyle.overflowY) ? 0 : off(y, 0, height, at);
      if (dx || dy) window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
      const rect = box(element);
      const labels = new Set(element.labels ?? []);
      // On top at a point: the field itself, with nothing above it but parts of its own label that paint nothing over it.
      const top = (px, py) => {
        for (const found of call(document, 'Document', 'elementsFromPoint', px, py) ?? []) {
          if (found === element) return true;
          if (chain.includes(found)) return false;
          const line = [found, ...(ancestors(found) ?? [])];
          if (!line.some((node) => labels.has(node))) return false;
          const joins = line.findIndex((node) => chain.includes(node));
          if (!(joins < 0 ? line : line.slice(0, joins)).every(clear)) return false;
        }
        return false;
      };
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;
      // The middle, one side of it and one edge: a sliver is not enough, an icon over one end is.
      return top(midX, midY) && (top(rect.left + rect.width / 4, midY) || top(rect.right - rect.width / 4, midY)) &&
        (top(midX, rect.top + 3) || top(midX, rect.bottom - 3));
    } finally {
      for (const [node, left, topAt] of moved.reverse()) call(node, 'Element', 'scrollTo', { left, top: topAt, behavior: 'instant' });
      if (window.scrollX !== startX || window.scrollY !== startY) window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
    }
  };

  // Open modal dialogs, found once for each look at the page.
  let openModals;
  const modals = () => {
    if (!openModals) {
      try { openModals = query(':modal'); } catch { openModals = []; /* an engine without the selector: the hit test still applies */ }
    }
    return openModals;
  };
  const rendered = (element) => {
    tick();
    const rect = box(element);
    if (!(rect.width >= MIN_SIZE && rect.height >= MIN_SIZE)) return false;
    const chain = ancestors(element);
    if (!chain) return false;
    if (call(element, 'Element', 'checkVisibility', { checkOpacity: true, checkVisibilityCSS: true }) === false) return false;
    if (modals().length && !modals().some((modal) => chain.includes(modal))) return false;
    // A bar fixed over one part of the view can cover a field that shows once it is scrolled elsewhere.
    return painted(element, chain) && [undefined, 0.5, 0.25, 0.75].some((at) => { tick(); return hit(element, chain, at); });
  };
  const seen = (input) => !input.matches(':disabled') && !input.readOnly && rendered(input);

  // Roles a name made of several words can give (billing_address_postcode, "ZIP / Postal code"). Only card and address roles take
  // part, never the sign-in ones.
  const inferable = (role) => Object.hasOwn(cardAliases, role) || Object.hasOwn(addressAliases, role);
  const tables = new WeakMap();
  const aliasRoles = (aliases) => {
    if (!tables.has(aliases)) {
      const table = new Map();
      for (const role of Object.keys(aliases).filter(inferable)) {
        for (const alias of aliases[role]) table.set(alias, new Set([...(table.get(alias) ?? []), role]));
      }
      tables.set(aliases, table);
    }
    return tables.get(aliases);
  };
  const noise = new Set(['required', 'optional', 'mandatory', 'field', 'input', 'txt', 'value',
    'mm', 'yy', 'yyyy', 'mmyy', 'mmyyyy', 'jj', 'aa', 'aaaa', 'mmjj', 'mmaa']);
  // Words that may stand before the one that names the field: where it is, whose it is, how the page's builder names boxes.
  const around = new Set(['billing', 'shipping', 'delivery', 'mailing', 'payment', 'card', 'credit', 'customer', 'contact', 'recipient',
    'checkout', 'your', 'my', 'primary', 'default', 'new', 'home', 'work', 'address', 'addr', 'street', 'line', 'postal', 'main', 'content',
    'form', 'frm', 'fld', 'field', 'input', 'txt', 'tb', 'tbx', 'ddl', 'data', 'info', 'details']);
  // The words of one source: cut at a bracket or star (a hint or a required mark), at most 200 characters, camelCase split.
  const wordsOf = (text) => {
    const whole = String(text ?? '');
    const clean = whole.replace(/contentplaceholder\d*/gi, ' ');
    const stop = clean.search(/[(*]/);
    const piece = (stop < 0 ? clean : clean.slice(0, stop)).slice(0, 200).replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
    const found = plain(piece).split(/[^a-z0-9]+/).filter(Boolean);
    while (found.length && noise.has(found.at(-1))) found.pop();
    // What was cut off: "Card number (last 4 digits)" is not the card number.
    found.cut = stop < 0 ? '' : plain(clean.slice(stop, stop + 200));
    return found.length > 6 ? Object.assign([], { cut: found.cut }) : found;
  };
  const partialCard = /\b(?:last|ending|final|masked|partial|letzte|letzten|derniers|ultimos|ultimas|ultime|laatste|ostatnie|pedejie|pedejos)\b/;
  // A number in the hint: a count of digits (16) is fine, a few digits (4, 1234) means a part of the number.
  const partialDigits = (hint) => (hint.match(/\d+/g) ?? []).some((run) => run.length > 2 || Number(run) < 13 || Number(run) > 19);
  // A person's name takes fewer words before it than a place does: street_name, home_name and form_name are not a person.
  const personRoles = new Set(['name', 'given-name', 'family-name', 'cc-name']);
  const aroundPerson = new Set(['billing', 'shipping', 'delivery', 'mailing', 'recipient', 'customer', 'contact', 'your', 'my', 'card', 'credit',
    'payment', 'checkout', 'primary', 'main', 'txt', 'tb', 'tbx']);
  // Card words give context to card roles only.
  const cardWords = new Set(['card', 'credit', 'payment']);
  // The role the longest run of words at the end of a source names, when every word before it only adds context.
  const roleOfWords = (found, table) => {
    for (let start = 0; start < found.length; start++) {
      const run = found.slice(start).join('');
      const roles = table.get(run);
      if (!roles) continue;
      if (roles.size !== 1) return undefined;
      const [role] = roles;
      if (role === 'cc-number' && (partialCard.test(found.cut ?? '') || partialDigits(found.cut ?? ''))) return undefined;
      const allowed = personRoles.has(role) ? aroundPerson : around;
      const clear = found.slice(0, start).every((word) => (allowed.has(word) && (role.startsWith('cc-') || !cardWords.has(word))) || /^ctl\d+$/.test(word) || table.get(word)?.has(role));
      return clear ? { role, run } : undefined;
    }
    return undefined;
  };
  // Every source that names a role must name the same one.
  const inferRole = (sources, aliases) => {
    tick();
    const table = aliasRoles(aliases);
    const named = sources.map((text) => roleOfWords(wordsOf(text), table)).filter(Boolean);
    const roles = new Set(named.map(({ role }) => role));
    if (roles.size !== 1) return undefined;
    const [role] = roles;
    return { role, runs: named.map(({ run }) => run) };
  };

  // With `extended`, a name that is not exact is also read word by word. Logins never do.
  const describe = (input, aliases, extended = false) => {
    const tokens = String(input.autocomplete ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.at(-1) === 'webauthn') tokens.pop();
    const field = tokens.at(-1);
    const context = tokens.slice(0, -1).join(' ');
    const validContext = /^(?:section-\S+(?: |$))?(?:(?:billing|shipping)(?: |$))?(?:home|work|mobile|fax|pager)?$/.test(context);
    const group = context.split(' ').filter((token) => token.startsWith('section-') || token === 'billing' || token === 'shipping').join(' ');
    if (field && field !== 'on' && field !== 'off') {
      return { input, role: validContext ? field : undefined, group, declared: validContext, ambiguous: !validContext };
    }
    if (field === 'off') return { input, group };
    const sources = [input.name, input.id, input.getAttribute('aria-label'), ...[...(input.labels ?? [])].map((label) => label.textContent)];
    const names = sources.map(normalize);
    // A box for a phone's country code is not the country.
    const dialing = /^(?:tel|number)$/i.test(input.type ?? '') || /^\s*\+\d/.test(input.placeholder ?? '');
    const notCountry = (role) => !(dialing && (role === 'country' || role === 'country-name'));
    const matched = Object.keys(aliases).filter((role) => notCountry(role) && aliases[role].some((alias) => names.includes(alias)));
    // "Security code" alone is also what sign-in checks and captchas are called.
    const generic = matched[0] === 'cc-csc' && !names.some((name) => !genericCodes.includes(name) && aliases['cc-csc'].includes(name));
    if (!matched.length && extended) {
      const guess = inferRole([...sources, input.placeholder], aliases);
      if (guess && !notCountry(guess.role)) return { input, group, ambiguous: false };
      // A guess is never declared, and never marks the field ambiguous (sign-in rules read that).
      if (guess) {
        return { input, role: guess.role, group, declared: false, inferred: true, ambiguous: false,
          generic: guess.role === 'cc-csc' && guess.runs.every((run) => genericCodes.includes(run)) };
      }
    }
    return { input, role: matched.length === 1 ? matched[0] : undefined, group, generic, ambiguous: matched.length > 1 };
  };
  const inputTypes = 'input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=password], input[type=number], input[type=month], select';
  const active = dom(document, 'Document', 'activeElement');
  const unique = (matches) => matches.length === 1 ? matches[0] : matches.find(({ input }) => input === active);
  const preferred = (matches) => {
    const declared = matches.filter((entry) => entry.declared);
    return unique(declared.length ? declared : matches);
  };
  const inScope = (list, anchor) => list.filter((entry) => entry.input.form === anchor.input.form && entry.group === anchor.group);

  // How many containers the two fields share: the higher, the nearer.
  const shared = (a, b) => {
    const others = new Set(ancestors(b.input));
    return (ancestors(a.input) ?? []).filter((node) => others.has(node)).length;
  };
  const nearest = (matches, anchor) => {
    const depth = Math.max(...matches.map((entry) => shared(entry, anchor)));
    return matches.filter((entry) => shared(entry, anchor) === depth);
  };
  const within = (node, selector) => [...(call(node, 'Element', 'querySelectorAll', selector) ?? [])];
  // Parts of a page that are about something else than what surrounds them.
  const apart = (node) => /^(?:FOOTER|HEADER|NAV|ASIDE|DIALOG|ARTICLE)$/.test(dom(node, 'Element', 'tagName')) ||
    /^(?:contentinfo|banner|navigation|search|dialog)$/.test(call(node, 'Element', 'getAttribute', 'role') ?? '');
  const headed = (node) => within(node, 'h1, h2, h3, h4, h5, h6, legend, [role=heading]').length > 0;
  // The containers each of two fields has to itself, up to the first one they share.
  const branches = (a, b) => {
    const first = ancestors(a.input) ?? [], second = ancestors(b.input) ?? [];
    return [first.filter((node) => !second.includes(node)), second.filter((node) => !first.includes(node))];
  };
  // With no form: not across a footer, header or dialog, into a part with its own heading, or out of a sign-in box.
  const sameBlock = (entry, anchor) => {
    tick();
    const [own, theirs] = branches(entry, anchor);
    if ([...own, ...theirs].some(apart)) return false;
    if ([own, theirs].some((branch) => branch.length && headed(branch.at(-1)))) return false;
    return !own.length || !within(own.at(-1), 'input[type=password]').some((input) => !describe(input, cardAliases, true).role);
  };
  // A box only labelled like a security code (a captcha, a sign-in check) must sit close to the card number.
  const closeCode = (entry, anchor, list) => {
    if (entry.declared) return true;
    const [own] = branches(entry, anchor);
    if (own.some((node) => apart(node) || /^(?:FIELDSET|SECTION|FORM)$/.test(dom(node, 'Element', 'tagName')))) return false;
    if (own.length && headed(own.at(-1))) return false;
    const [from, to] = [list.indexOf(entry), list.indexOf(anchor)].sort((a, b) => a - b);
    return list.slice(from + 1, to).filter(({ role }) => !role?.startsWith('cc-')).length <= 2;
  };
  // Whether two fields sit in a group that holds nothing but card fields and their labels: no other field, no heading, no text
  // that could be one, and no picture.
  const grouped = (a, b) => {
    tick();
    const theirs = ancestors(b.input) ?? [];
    const group = (ancestors(a.input) ?? []).find((node) => theirs.includes(node));
    if (!group) return false;
    if (within(group, 'input:not([type=hidden]), select, textarea')
      .some((input) => !describe(input, cardAliases, true).role?.startsWith('cc-'))) return false;
    if (within(group, 'h1, h2, h3, h4, h5, h6, legend, fieldset, [role=heading], [role=group], img, svg, canvas, picture, iframe, video, hr')
      .length) return false;
    const length = (node) => String(dom(node, 'Node', 'textContent') ?? '').replace(/\s/g, '').length;
    const named = within(group, 'label, select, button');
    const outer = named.filter((node) => !(ancestors(node) ?? []).some((parent) => named.includes(parent)));
    return length(group) === outer.reduce((sum, node) => sum + length(node), 0);
  };
  const codeFits = (entry, anchor, list) => closeCode(entry, anchor, list) && (!entry.generic || inScope(list, anchor)
    .filter((other) => other === anchor || (other.role?.startsWith('cc-exp') && (anchor.input.form || sameBlock(other, anchor))))
    .some((other) => grouped(entry, other)));
  // The field for one role that belongs with `anchor`: same form and section. With no form, also the same block and the nearest,
  // and never one from a container that holds another field of the anchor's own role (that is another card or address).
  const member = (list, anchor, role) => {
    // The field a choice starts from is never its own rival.
    if (role === anchor.role) return anchor;
    const scope = inScope(list, anchor);
    let matches = scope.filter((entry) => entry.role === role);
    if (!anchor.input.form) matches = matches.filter((entry) => entry === anchor || sameBlock(entry, anchor));
    if (role === 'cc-csc') matches = matches.filter((entry) => codeFits(entry, anchor, list));
    // In a form, a repeated address field goes to the one in the nearest container, if only one is.
    if (anchor.input.form && matches.length && Object.hasOwn(addressAliases, role)) {
      const declared = matches.filter((entry) => entry.declared);
      return unique(nearest(declared.length ? declared : matches, anchor));
    }
    if (anchor.input.form || !matches.length) return preferred(matches);
    // A field found by its label only is not a rival of one the page declares.
    const rivals = scope.filter((entry) => entry !== anchor && entry.role === anchor.role && (entry.declared || !anchor.declared));
    matches = matches.filter((entry) => entry === anchor || !rivals.some((rival) => shared(entry, rival) >= shared(entry, anchor)));
    const declared = matches.filter((entry) => entry.declared);
    if (declared.length) matches = declared;
    return matches.length ? unique(nearest(matches, anchor)) : undefined;
  };

  // More fields than this for one kind is not a checkout, and testing each would stall the page.
  const MAX_FIELDS = 120;
  // Every field is described, but only those that could be written are tested for being on screen.
  const strictFields = (aliases, wanted) => {
    // The page may have rearranged itself since the last look.
    chains.clear();
    openModals = undefined;
    const found = query(inputTypes + ', textarea').slice(0, 2000).map((input) => { tick(); return describe(input, aliases, true); });
    const candidates = found.filter(wanted);
    if (candidates.length > MAX_FIELDS) return [];
    const shown = new Set(candidates.filter(({ input }) => seen(input)));
    return found.filter((entry) => !wanted(entry) || shown.has(entry));
  };
  // Where a field is: its form and every container.
  const place = (input) => [input.form, ...(ancestors(input) ?? [])];
  // What a field is called and what it takes.
  const identity = (input) => JSON.stringify([input.type,
    ...['name', 'id', 'autocomplete', 'aria-label'].map((name) => input.getAttribute(name))]);
  const targets = (list, anchor, roles) => roles.map((role) => ({ role, entry: member(list, anchor, role) }))
    .filter(({ entry }) => entry)
    .map((target) => ({ ...target, place: place(target.entry.input), identity: identity(target.entry.input) }));

  const cardTargets = timed(() => {
    const isCard = ({ role }) => Boolean(role?.startsWith('cc-'));
    const all = strictFields({ ...loginAliases, ...cardAliases }, isCard);
    const numbers = all.filter(({ role, input }) => role === 'cc-number' && ['text', 'tel', 'number'].includes(input.type));
    const focused = all.find(({ input }) => input === active);
    let anchor;
    if (focused?.input.form) anchor = preferred(inScope(numbers, focused));
    else if (focused?.role?.startsWith('cc-')) {
      const near = inScope(numbers, focused);
      if (near.length) anchor = unique(nearest(near, focused));
    }
    anchor ??= preferred(numbers);
    return anchor ? targets(all, anchor, ['cc-number', 'cc-name', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc']) : [];
  }, []);

  // One section only: the focused one, else shipping, else the first, a section with a street before one without. A choice
  // needs a street or at least two different address fields, so a lone postcode box is never the address. A page that declares
  // any address field is taken at its word: only declared fields count. A page that declares none must label both a street and
  // a postal code, once each, close together.
  const addressTargets = timed(() => {
    const isAddress = ({ role }) => Object.hasOwn(addressAliases, role ?? '');
    const every = strictFields({ ...cardAliases, ...addressAliases }, isAddress);
    const found = every.filter(isAddress);
    const declared = found.filter((entry) => entry.declared);
    const all = declared.length ? declared : found;
    const isStreet = ({ role }) => role === 'street-address' || role === 'address-line1';
    const isPostal = ({ role }) => role === 'postal-code';
    const complete = (entry) => {
      const scope = inScope(all, entry);
      const streets = scope.filter(isStreet), codes = scope.filter(isPostal);
      if (streets.length !== 1 || codes.length !== 1) return false;
      const [from, to] = [every.indexOf(streets[0]), every.indexOf(codes[0])].sort((a, b) => a - b);
      return (entry.input.form || sameBlock(codes[0], streets[0])) &&
        every.slice(from + 1, to).filter((other) => !isAddress(other)).length <= 2;
    };
    const anchors = all.filter((entry) => (isStreet(entry) || isPostal(entry)) && (declared.length || complete(entry)));
    const focused = all.find(({ input }) => input === active);
    const own = focused ? inScope(anchors, focused) : [];
    const streetsFirst = (list) => [...list.filter(isStreet), ...list.filter((entry) => !isStreet(entry))];
    const nearby = own.length && !focused.input.form
      ? [...own].sort((x, y) => shared(y, focused) - shared(x, focused)) : own;
    const shipping = ({ group }) => group.split(' ').includes('shipping');
    const starts = [
      ...streetsFirst(own.includes(focused) && isStreet(focused) ? [focused, ...nearby] : nearby),
      ...(focused?.group ? [focused] : []),
      ...[isStreet, isPostal].flatMap((kind) => [...anchors.filter((entry) => kind(entry) && shipping(entry)), ...anchors.filter(kind)])
    ];
    // A handful of starting points is more than any real page needs.
    for (const start of [...new Set(starts)].slice(0, 8)) {
      const chosen = targets(all, start, Object.keys(addressAliases));
      if (chosen.some(({ entry }) => isStreet(entry)) || chosen.length >= 2) return chosen;
    }
    return [];
  }, []);

  // A guess from outside the frame, which is never read or filled.
  const paymentFrame = timed(() => query('iframe').slice(0, 50).filter(rendered).some((frame) => {
    let host = '';
    try { host = new URL(frame.getAttribute('src') ?? '', location.href).hostname; } catch { /* no usable address */ }
    if (/(?:^|[\s;])payment(?:[\s;]|$)/i.test(frame.getAttribute('allow') ?? '')) return true;
    return [host, frame.getAttribute('name'), frame.getAttribute('title')].some((text) =>
      /(?:^|[^a-z])(?:pay|payments?|card|credit ?card|cardnumber)(?:[^a-z]|$)|stripe|adyen|braintree/i.test(text ?? ''));
  }), false);

  const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const language = () => dom(document, 'Document', 'documentElement')?.lang;
  const digitRuns = (text) => String(text ?? '').match(/\d+/g) ?? [];
  // The month an option's words name, by its name in English or the page's language, else by its one number. 0 when the words
  // say something that cannot be trusted (two answers, or a count from zero), undefined when they say nothing.
  const monthNamed = (text) => {
    const words = fold(text).split(/[^\p{L}]+/u).filter(Boolean);
    const named = new Set();
    for (const locale of [language(), 'en']) {
      for (const style of ['long', 'short']) {
        try {
          const format = locale && new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' });
          for (let month = 1; format && month <= 12; month++) {
            if (words.includes(fold(format.format(new Date(Date.UTC(2000, month - 1, 15)))).replace(/\.$/, ''))) named.add(month);
          }
        } catch { /* an unknown language tag */ }
      }
    }
    const numbers = digitRuns(text).filter((run) => run.length <= 2).map(Number);
    if (!named.size && !digitRuns(text).length) return undefined;
    const answers = new Set([...named, ...numbers]);
    const [answer] = answers;
    return answers.size === 1 && answer <= 12 ? answer : 0;
  };

  // Matches a list option. Months and years go by the option's words whenever those hold a number or a month's name, and only
  // by value when no option's words do. Everything else goes by value, then (for addresses) by words, and more than one match
  // by words is no match.
  const pick = (select, wanted, role) => {
    // No list of countries, months or years is this long, and reading one would stall the page.
    if (select.options.length > 500) return undefined;
    const options = [...select.options].filter((option) => option.value && !option.disabled);
    const only = (matches) => matches.length === 1 ? matches[0] : undefined;
    if (role === 'cc-exp-month') {
      const month = Number(wanted[0]);
      const named = options.map((option) => monthNamed(option.text));
      if (named.some((answer) => answer !== undefined)) {
        // A number 0 anywhere means the words count from zero: which month is which is then anyone's guess.
        if (options.some((option) => digitRuns(option.text).some((run) => Number(run) === 0))) return undefined;
        return only(options.filter((option, index) => named[index] === month));
      }
      const zeroBased = options.some((option) => Number(option.value) === 0) && !options.some((option) => Number(option.value) === 12);
      return only(options.filter((option) => Number(option.value) === (zeroBased ? month - 1 : month)));
    }
    if (role === 'cc-exp-year') {
      const year = wanted[0];
      const same = (text) => text === year || text === year.slice(-2);
      if (options.some((option) => digitRuns(option.text).length)) {
        return only(options.filter((option) => digitRuns(option.text).length === 1 && same(digitRuns(option.text)[0])));
      }
      return only(options.filter((option) => same(option.value)));
    }
    if (role.startsWith('cc-')) return options.find((option) => wanted.includes(option.value));
    const words = wanted.map(fold).filter(Boolean);
    for (const read of [(option) => option.value, (option) => option.text]) {
      const matches = options.filter((option) => words.includes(fold(read(option))));
      if (matches.length) return matches.length === 1 ? matches[0] : undefined;
    }
    return undefined;
  };

  // Once every field is written, a page's handlers may have changed, moved, removed or replaced any of them. `filled` keeps
  // the roles whose value stayed as written. The others are `left`: what became of their values is not known, so nothing may be
  // claimed about them. A card number or security code that did not stay is also taken back, from the element it was written to.
  // No other element is changed, whatever it holds now: only what this fill wrote is the fill's to change.
  const secrets = new Set(['cc-number', 'cc-csc']);
  const settle = () => {
    if (!records.length) return;
    // Looking again has its own time budget.
    deadline = Date.now() + 2000;
    const look = () => mode === 'card' ? cardTargets() : addressTargets();
    const shows = (input) => timed(() => seen(input), false)();
    const holds = (record, now) => {
      if (record.refused) return false;
      const { input, target, value, role } = record;
      const next = now.find((other) => other.role === role)?.entry.input;
      let holder = input;
      if (input.isConnected === false) {
        // A new element the page put in its place may hold the value; one that was already there is another field.
        holder = next && !present.has(next) ? next : undefined;
      } else if (next && next !== input && !shows(input)) {
        return false;  // hidden, with another field shown for the role
      } else if (secrets.has(role)) {
        const at = place(input);
        if (at.length !== target.place.length || at.some((node, index) => node !== target.place[index])) return false;
      }
      return Boolean(holder) && (holder.tagName === 'SELECT' ? holder.value === value : same(holder.value, value, role));
    };
    let held = records;
    // Taking a value back runs the page's handlers again, so look until nothing more goes.
    while (held.length) {
      chains.clear();
      const now = look();
      const gone = held.filter((record) => !holds(record, now));
      if (!gone.length) break;
      held = held.filter((record) => !gone.includes(record));
      for (const { role, input, before } of gone) {
        if (secrets.has(role) && input.value !== '' && input.value !== before) { set(input, before); announce(input); }
      }
    }
    result.filled = held.map(({ role }) => role);
    const left = records.filter((record) => !held.includes(record)).map(({ role }) => role);
    if (left.length) result.left = left;
  };

  const stillThere = (target) => {
    const now = (mode === 'card' ? cardTargets() : addressTargets()).find(({ role }) => role === target.role);
    return Boolean(now) && now.entry.input === target.entry.input && now.identity === target.identity &&
      now.place.length === target.place.length &&
      now.place.every((node, index) => node === target.place[index]);
  };

  // A caller that stops waiting at `options.until` (milliseconds since 1970) knows nothing is written after it.
  const expired = () => options.until !== undefined && !(Date.now() < options.until);

  // What was written to card and address fields, for `settle` to check once all of them are done, and the fields the page had
  // before the first of those writes.
  const records = [];
  let present;

  const write = (target, value, role, others = []) => {
    if (!target || typeof value !== 'string' || !value || expired()) return;
    // Card and address targets remember the form they were chosen in.
    const entry = target.entry ?? target;
    const { input } = entry;
    // An earlier field's page script may have hidden, moved or repurposed this one: it must still be the field a fresh look picks.
    if (mode !== 'login' && !stillThere(target)) return;
    if (input.tagName === 'SELECT') {
      if (mode === 'login') value = [...input.options].find((option) => option.value === value && !option.disabled)?.value;
      else value = pick(input, [value, ...others], role)?.value;
      if (!value) return;
    } else if (mode !== 'login') {
      if (input.tagName !== 'TEXTAREA') value = value.replace(/\s*[\r\n]+\s*/g, ', ');
      // A cut value would be wrong data, so a field too short for it is left alone.
      if (input.maxLength >= 0 && value.length > input.maxLength) return;
    }
    if (mode !== 'login') present ??= new Set(query(inputTypes + ', textarea'));
    const before = input.value;
    set(input, value);
    if (input.value !== value) { set(input, before); return; }
    // Recorded first: the page's handlers run inside `announce`.
    if (mode !== 'login') records.push({ role, target, input, before, value });
    announce(input);
    result.filled.push(role);
  };

  // The element's own setter, past anything a framework put on the element.
  function set(input, value) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value);
  }
  function announce(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // What a page may do to a value and still have it as written: letter case and spacing, separators in numbers, a masked card
  // number or code, a year written long. Nothing here accepts an empty, shorter or different value.
  const separated = new Set(['cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'tel', 'postal-code']);
  const bare = (text, role) => {
    const value = String(text ?? '').normalize('NFC').replace(/\p{Cf}/gu, '');
    return (separated.has(role) ? value.replace(/[\s\p{Pd}./()]/gu, '') : value.replace(/\s+/g, ' ').trim()).toUpperCase();
  };
  const same = (shown, wrote, role) => {
    const now = bare(shown, role), then = bare(wrote, role);
    if (!now) return false;
    if (now === then) return true;
    if (role === 'cc-number') {
      // A mask stands for each digit it hides, so it is as long as the number.
      const masked = /^(\d*)[•●∙·*X#]+(\d{4})$/.exec(now);
      return now.length === then.length && (Boolean(masked && then.startsWith(masked[1]) && then.endsWith(masked[2])) ||
        /^[•●∙·*#]+$/.test(now));
    }
    if (role === 'cc-csc') return now.length === then.length && /^[•●∙·*]+$/.test(now);
    if (role === 'cc-exp') {
      const short = (text) => text.length === 6 ? text.replace(/^(\d\d)20(\d\d)$/, '$1$2').replace(/^20(\d{4})$/, '$1') : text;
      return /^\d{4}$/.test(short(now)) && short(now) === short(then);
    }
    if (role === 'cc-exp-year') return now === '20' + then || then === '20' + now;
    if (role === 'cc-exp-month') return /^\d{1,2}$/.test(now) && Number(now) === Number(then);
    return false;
  };

  if (mode === 'probe-card') return cardTargets().length ? { ...result, checkout: true } : result;
  if (mode === 'probe') {
    const roles = (targets) => (options.pageOrder ? [...targets].sort((a, b) =>
      call(a.entry.input, 'Node', 'compareDocumentPosition', b.entry.input) & 4 ? -1 : 1) : targets).map(({ role }) => role);
    const card = roles(cardTargets());
    return { ...result, card, address: roles(addressTargets()), paymentFrame: !card.length && paymentFrame() };
  }

  if (mode === 'card') {
    const iso = /^\d{4}-\d{2}$/.test(fields['cc-exp'] ?? '') ? fields['cc-exp'] : undefined;
    const chosen = cardTargets();
    // The page's own script may space or mask the number, but must leave it there, in the same place.
    const stuck = (target) => stillThere(target) && same(target.entry.input.value, fields['cc-number'], 'cc-number');
    for (const target of chosen) {
      const { role, entry } = target;
      let value = fields[role];
      const { input } = entry;
      if (iso) {
        const [year, month] = iso.split('-');
        const hints = [input.placeholder, ...[...(input.labels ?? [])].map((label) => label.textContent), input.getAttribute('aria-label')]
          .map((text) => String(text ?? '').toLowerCase().replace(/\s/g, ''));
        if (role === 'cc-exp' && input.type !== 'month') {
          // The order and the separator the field shows: MM/YY, YY/MM, MM-YYYY, YYYY/MM, MMYY, MM/AA.
          const shape = hints.map((text) => /(mm)([^a-z0-9]?)(yyyy|yy|aaaa|aa)|(yyyy|yy|aaaa|aa)([^a-z0-9]?)(mm)/.exec(text)).find(Boolean);
          // MM/YY is what checkouts expect when nothing says otherwise.
          const separator = shape ? shape[2] ?? shape[5] : '/';
          const long = shape ? (shape[3] ?? shape[4]).length === 4 : input.maxLength === 7;
          const written = long ? year : year.slice(2);
          value = shape?.[4] ? written + separator + month : month + separator + written;
        }
        if (role === 'cc-exp-month') value = month;
        if (role === 'cc-exp-year') {
          const short = input.tagName !== 'SELECT' && (input.maxLength === 2 ||
            hints.some((text) => /^(?:yy|aa)$|\((?:yy|aa)\)/.test(text)));
          value = short ? year.slice(2) : year;
        }
      }
      // Nothing more of a card goes to a page that has not kept the number.
      if (role !== 'cc-number' && !stuck(chosen[0])) break;
      write(target, value, role);
      // Nothing else of a card goes to a page that did not take the number, and what it did not keep is taken back.
      if (role === 'cc-number' && !(records.length && stuck(target))) {
        // A number moved elsewhere counts as not taken, whatever it still shows.
        if (records.length) records[0].refused = true;
        break;
      }
    }
    settle();
    if (options.focusEmptyCode && !fields['cc-csc'] && result.filled[0] === 'cc-number') {
      const code = chosen.find(({ role }) => role === 'cc-csc');
      if (code && stillThere(code)) code.entry.input.focus();
    }
    return result;
  }

  if (mode === 'address') {
    const given = { ...fields };
    // A first and last name are made only from a name of exactly two words.
    const words = String(fields.name ?? '').trim().split(/\s+/);
    if (words.length === 2) {
      given['given-name'] ||= words[0];
      given['family-name'] ||= words[1];
    }
    const lines = String(fields['street-address'] ?? '').split(/\r?\n/);
    given['address-line1'] ||= lines[0];
    given['address-line2'] ||= lines.slice(1).join(', ');
    given['street-address'] ||= [fields['address-line1'], fields['address-line2']].filter(Boolean).join('\n');
    // `country` is a two-letter code, or the text an import left.
    const country = String(fields.country ?? '');
    const countryNames = [];
    if (/^[A-Za-z]{2}$/.test(country)) {
      for (const locale of [language(), 'en']) {
        try {
          const label = locale && new Intl.DisplayNames([locale], { type: 'region' }).of(country.toUpperCase());
          if (label && label.toUpperCase() !== country.toUpperCase()) countryNames.push(label);
        } catch { /* an unknown language tag or code */ }
      }
    }
    given['country-name'] ||= countryNames[0] ?? (country.length > 2 ? country : undefined);
    const targetsNow = addressTargets();
    // A page with one street box and no second one gets the whole street in it.
    const hasLine2 = targetsNow.some(({ role }) => role === 'address-line2');
    for (const target of targetsNow) {
      const { role, entry } = target;
      let value = given[role];
      if (role === 'address-line1' && !hasLine2 && given['address-line2']) value = [value, given['address-line2']].filter(Boolean).join(', ');
      // A list of countries may be asked for as a code or a name. A text box found by its label expects the name.
      if (role === 'country' && !entry.declared && entry.input.tagName !== 'SELECT') value = given['country-name'] ?? value;
      const others = role === 'country' || role === 'country-name'
        ? [country, given['country-name'], ...countryNames].filter(Boolean) : [];
      write(target, value, role, others);
    }
    settle();
    return result;
  }

  if (mode !== 'login') return result;
  const all = query(inputTypes)
    .filter(visible).map((input) => describe(input, { ...loginAliases, ...cardAliases }));
  const passwordFields = all.filter(({ input, role, ambiguous }) => input.type === 'password' &&
    (role === 'current-password' || (!role && !ambiguous && input.autocomplete.toLowerCase() !== 'off')));
  const password = preferred(passwordFields);
  const textLike = ({ input }) => ['text', 'email', 'tel'].includes(input.type);
  if (!password && all.some(({ input }) => input.type === 'password')) return result;
  const scope = password ? inScope(all, password) : all;
  let user = preferred(scope.filter((entry) => textLike(entry) && entry.role === 'username'));
  if (!user && password) {
    const accountLooksLikeEmail = /^[^@\s]+@[^@\s]+$/.test(fields.username ?? '');
    const preceding = scope.filter((entry) => textLike(entry) && (!entry.role || (entry.role === 'email' && accountLooksLikeEmail)) &&
      !entry.ambiguous &&
      entry.input.autocomplete.toLowerCase() !== 'off' &&
      entry.input.compareDocumentPosition(password.input) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (preceding.length === 1) user = preceding[0];
  }
  write(user, fields.username, 'username');
  write(password, fields['current-password'], 'current-password');
  return result;
}

// Reports what the page looks like, without values other than the username the person typed.
// A sign-up form has a new-password field, or two password fields (password and confirmation).
function psssProbePage() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly;
  };
  const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible);
  const tokens = (el) => el.autocomplete.toLowerCase().split(/\s+/);
  const signup = passwords.find((el) => tokens(el).includes('new-password'));
  const first = signup ?? passwords[0];
  const sameForm = passwords.filter((el) => el.form === first?.form);
  const newPassword = Boolean(signup) ||
    (sameForm.length >= 2 && !sameForm.some((el) => tokens(el).includes('current-password')));
  const scope = first?.form ?? document;
  const textLike = 'input:not([type]), input[type=text], input[type=email], input[type=tel]';
  const before = first
    ? [...scope.querySelectorAll(textLike)].filter(visible).filter((el) => el.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)
    : [];
  const user = before.filter((el) => /user|email|login|account/i.test(el.autocomplete + el.type + el.name + el.id)).pop()
    ?? before[before.length - 1];
  return { newPassword, username: user?.value?.trim() ?? '' };
}

// Puts one generated password into every visible password field of the sign-up form
// (the password and its confirmation). Never returns the password.
function psssFillPasswords(secret) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly;
  };
  const all = [...document.querySelectorAll('input[type=password]')].filter(visible);
  const role = (el) => el.autocomplete.toLowerCase().split(/\s+/);
  const anchor = all.find((el) => role(el).includes('new-password')) ?? all.find((el) => !role(el).includes('current-password'));
  const fields = anchor ? all.filter((el) => el.form === anchor.form && !role(el).includes('current-password')) : [];
  for (const el of fields) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, secret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { filled: fields.length };
}
