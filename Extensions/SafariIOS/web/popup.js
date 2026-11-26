// Draws the views of popup-logic.js. Every text from the vault goes in as text (textContent), never as HTML. Nothing here or in
// the logic stores or logs anything.
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const header = document.getElementById('vaultbar');
  const select = document.getElementById('vault');
  const main = document.getElementById('content');

  const element = (tag, className, ...children) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);  // strings become text nodes
    return node;
  };
  // A name from the vault keeps its writing direction to itself.
  const words = (parts) => [parts].flat().map((part) => typeof part === 'string' ? part : element('bdi', '', part.name));
  const button = (label, className, act) => {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', (event) => { if (event.isTrusted) act(); });
    return node;
  };

  function row(kind, item, busy) {
    const name = element('div', 'name', element('bdi', '', item.name));
    const text = element('div', 'grow', name);
    if (item.detail) text.append(element('div', 'secondary', element('bdi', '', item.detail)));
    const first = Array.from(item.name)[0].toLocaleUpperCase();
    const tile = element('div', `tile c${1 + first.codePointAt(0) % 6}`, first);
    tile.setAttribute('aria-hidden', 'true');
    const fill = button('Fill', 'btn', () => popup.fill(kind, item.ref));
    fill.setAttribute('aria-label', item.label);
    fill.disabled = busy;
    return element('li', 'row', tile, text, fill);
  }

  function part(item, busy) {
    switch (item.type) {
      case 'notice': {
        const text = element('div', 'words');
        if (item.title) text.append(element('h1', '', ...words(item.title)));
        text.append(element('p', '', ...words(item.text)));
        const node = element('div', 'notice', text);
        node.dataset.kind = item.kind;
        if (item.kind === 'progress') {
          const spinner = element('span', 'spinner');
          spinner.setAttribute('aria-hidden', 'true');
          node.prepend(spinner);
        } else {
          const icon = element('span', 'nicon');  // the stylesheet draws it from the notice's kind
          icon.setAttribute('aria-hidden', 'true');
          node.prepend(icon);
        }
        node.setAttribute('role', item.kind === 'warning' ? 'alert' : 'status');
        if (item.open) node.append(button('Open Psss', 'btn primary', () => popup.open(item.open)));
        return node;
      }
      case 'group': {
        const rows = element('ul', 'card', ...item.rows.map((entry) => row(item.kind, entry, busy)));
        const node = element('section', 'group', element('h2', 'secondary', item.heading), rows);
        node.dataset.kind = item.kind;
        return node;
      }
      case 'text': return element('p', 'hint', item.text);
      case 'open': return button('Open Psss', 'btn wide', () => popup.open(item.open));
    }
  }

  function show(view) {
    header.hidden = !(view.header && view.header.vaults.length >= 2);
    select.replaceChildren(...(header.hidden ? [] : view.header.vaults.map((v) => {
      const option = element('option', '', v.name);
      option.value = v.id;
      option.selected = v.id === view.header.chosen;
      return option;
    })));
    select.disabled = view.busy;
    main.replaceChildren(...view.parts.map((item) => part(item, view.busy)));
    main.setAttribute('aria-busy', String(view.busy || view.parts.some((item) => item.kind === 'progress')));
    // The tapped Fill button is gone: focus goes to what happened, which reads it out (its role announces it too).
    if (view.result) {
      const outcome = main.querySelector('.notice') ?? main.querySelector('button');
      if (outcome?.matches('.notice')) outcome.tabIndex = -1;
      outcome?.focus();
    }
  }

  const popup = SafariFillPopup.create({ api, pageFill: psssFillPage, show, close: () => window.close() });
  select.addEventListener('change', () => popup.choose(select.value));
  popup.start().catch(() => {
    // Nothing of the error is shown or logged: it could hold what was being filled.
    show({ header: null, busy: false, parts: [{ type: 'notice', kind: 'warning', title: 'Psss can’t fill right now',
      text: ['Nothing was filled. Open Psss, then try again in Safari.'], open: SafariFillPopup.LINKS.share() }] });
  });
})();
