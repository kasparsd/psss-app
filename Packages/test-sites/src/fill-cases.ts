// Pages that try to make the Safari and browser page fill write where a person cannot see, the wrong field or a wrong value.
// `values` names every field (by id) that must hold something afterwards. Every other text box must stay empty.
// `filled`, when given, is the list of roles the fill must report.
export type FillCase = { name: string; mode: 'card' | 'address'; html: string; values: Record<string, string>; focus?: string; filled?: string[] };

const f = (id: string, autocomplete: string, extra = '') => `<input id="${id}" autocomplete="${autocomplete}" ${extra}>`;
const labelled = (id: string, label: string, extra = '') => `<label>${label} <input id="${id}" ${extra}></label>`;
const trap = (style: string) => f('trap', 'cc-number', `style="${style}"`);
const wrapped = (style: string, inner = trap('')) => `<div style="${style}">${inner}</div>`;
const css = (rules: string) => `<style>${rules}</style>`;
const NUMBER = '4111111111111111';

/** A field a person cannot see: nothing may be written. */
const unseen: [string, string][] = [
  ['unreachable-right-root', css('html{overflow:hidden}') + trap('position:absolute;left:5000px')],
  ['unreachable-right-body', css('body{overflow:hidden}') + trap('position:absolute;left:5000px')],
  ['unreachable-below-root', css('html,body{overflow:hidden;height:100%}') + trap('position:absolute;top:90000px')],
  ['translated-away', css('html,body{overflow:hidden}') + trap('transform:translateX(9999px)')],
  ['root-without-height', css('html,body{height:0;overflow:hidden}') + trap('')],
  ['body-without-height', css('html{overflow:hidden}body{height:0;overflow:hidden;position:relative}') + trap('')],
  ['root-clip-path', css('html{clip-path:inset(50%)}') + trap('')],
  ['sliver', trap('position:absolute;left:-190px;width:191px')],
  ['one-pixel-clip', wrapped('width:1px;height:1px;overflow:hidden')],
  ['empty-auto-box', wrapped('width:0;height:0;overflow:auto')],
  ['one-pixel-scroll-box', wrapped('width:1px;height:1px;overflow:scroll')],
  ['negative-in-scroll-box', wrapped('margin-left:150px;width:200px;height:60px;overflow:auto;position:relative', trap('position:absolute;left:-150px;width:140px'))],
  ['contain-paint', wrapped('contain:paint;height:0')],
  ['clip', trap('position:absolute;clip:rect(0,0,0,0)')],
  ['clip-on-parent', wrapped('position:absolute;clip:rect(0 0 0 0)')],
  ['clip-path-side', trap('clip-path:inset(0 0 0 100%)')],
  ['clip-path-pixels', trap('clip-path:inset(200px)')],
  ['clip-path-nearly', trap('clip-path:inset(49% 49%)')],
  ['clip-path-polygon', trap('clip-path:polygon(0 0,0 0,0 0)')],
  ['mask', trap('-webkit-mask-image:linear-gradient(transparent,transparent);mask-image:linear-gradient(transparent,transparent)')],
  ['faint-filter', trap('filter:opacity(0.001)')],
  ['faint-chain', wrapped('opacity:.3', wrapped('opacity:.3'))],
  ['turned-away', trap('transform:rotateY(180deg);backface-visibility:hidden')],
  ['colourless', trap('border:0;background:transparent;color:transparent')],
  ['covered', trap('') + '<div style="position:fixed;inset:0;background:white;z-index:9"></div>'],
  ['covered-by-moved-box', trap('') + '<div style="width:300px;height:100px;background:red;transform:translateY(-40px);position:relative"></div>'],
  ['behind-modal', trap('') + '<dialog id="d">Wait</dialog><script>document.getElementById("d").showModal()</script>'],
  ['drawer-closed', wrapped('position:fixed;left:100%;top:0')],
  ['inert', '<div inert>' + trap('') + '</div>'],
  ...([['slot-clipped', 'width:0;height:0;overflow:hidden'], ['slot-clip-path', 'clip-path:inset(50%)'], ['slot-transparent', 'opacity:0'],
    ['slot-masked', 'mask-image:linear-gradient(transparent,transparent);-webkit-mask-image:linear-gradient(transparent,transparent)']] as const)
    .map(([name, style]): [string, string] => [name, `<div id="host">${trap('')}</div><script>document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<div style="${style}"><slot></slot></div>'</script>`]),
  ['slot-inert', `<div id="host">${trap('')}</div><script>document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<div inert><slot></slot></div>'</script>`],
  ['named-parent', wrapped('width:1px;height:1px;overflow:hidden', `<form>${trap('')}<input type="hidden" name="parentElement"><input type="hidden" name="parentNode"><input type="hidden" name="assignedSlot"></form>`)],
  ['named-parent-from-outside', wrapped('width:1px;height:1px;overflow:hidden', `<form id="form">${trap('')}</form>`) + '<input type="hidden" name="parentNode" form="form">'],
];

const addressBlock = `<div id="block"><div>${f('m', 'name')}</div><div>${f('s', 'address-line1')}</div><div>${f('y', 'address-level2')}</div><div>${f('z', 'postal-code')}</div></div>`;
const card = (name: string, html: string, values: Record<string, string>, focus?: string): FillCase => ({ name, mode: 'card', html, values, focus });
const address = (name: string, html: string, values: Record<string, string>, focus?: string): FillCase => ({ name, mode: 'address', html, values, focus });
const select = (id: string, autocomplete: string, options: [string, string][]) =>
  `<select id="${id}" autocomplete="${autocomplete}"><option value="">Choose</option>${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
const expiry = (name: string, extra: string, value: string) => card(name, f('n', 'cc-number') + f('e', 'cc-exp', extra), { n: NUMBER, e: value });
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fillCases: FillCase[] = [
  ...unseen.map(([name, html]) => card(name, html, {})),

  // Fields a person can see or scroll to are filled.
  card('plain', f('n', 'cc-number'), { n: NUMBER }),
  card('below-the-fold', '<div style="height:2000px"></div>' + f('n', 'cc-number'), { n: NUMBER }),
  card('scrolling-drawer', `<div style="position:fixed;inset:0;overflow:auto"><div style="height:1500px"></div>${f('n', 'cc-number')}</div>`, { n: NUMBER }),
  card('scroll-box', `<div style="height:100px;overflow:auto"><div style="height:400px"></div>${f('n', 'cc-number')}</div>`, { n: NUMBER }),
  card('inside-modal', `<dialog id="d">${f('n', 'cc-number')}</dialog><script>document.getElementById("d").showModal()</script>`, { n: NUMBER }),
  card('own-floating-label', `<div style="position:relative">${f('n', 'cc-number', 'style="width:300px;height:44px"')}<label for="n" style="position:absolute;inset:0">Card number</label></div>`, { n: NUMBER }),
  card('icon-over-one-end', `<div style="position:relative;width:300px">${f('n', 'cc-number', 'style="width:300px;height:44px"')}<span style="position:absolute;right:4px;top:8px;width:40px;height:28px;background:blue"></span></div>`, { n: NUMBER }),
  card('slotted', `<div id="host">${f('n', 'cc-number')}</div><script>document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<div><slot></slot></div>'</script>`, { n: NUMBER }),
  card('named-properties', `<img name="documentElement"><img name="activeElement"><img name="body"><img name="querySelectorAll"><img name="elementsFromPoint"><form><input type="hidden" name="getBoundingClientRect"><input type="hidden" name="parentNode"><input type="hidden" name="tagName">${f('n', 'cc-number')}</form>`, { n: NUMBER }),

  // The security code goes only beside the number.
  card('two-factor-box', `<div>${f('n', 'cc-number')}</div><div><h2>Verify sign-in</h2>${labelled('x', 'Security code')}</div>`, { n: NUMBER }),
  card('captcha-in-form', `<form>${f('n', 'cc-number')}<fieldset>${labelled('x', 'Security code')}</fieldset></form>`, { n: NUMBER }),
  card('distant-code', `<form>${f('n', 'cc-number')}<input><input><input><input>${labelled('x', 'Security code')}</form>`, { n: NUMBER }),
  card('code-beside-number', `<div><div>${f('n', 'cc-number')}</div><div>${labelled('c', 'Security code')}</div></div>`, { n: NUMBER, c: '987' }),
  card('number-cleared', f('n', 'cc-number', 'oninput="this.value=\'\'"') + f('c', 'cc-csc') + f('h', 'cc-name'), {}),
  card('number-reformatted', f('n', 'cc-number', 'oninput="this.value=this.value.replace(/(.{4})(?!$)/g,\'$1 \')"') + f('c', 'cc-csc'), { n: '4111 1111 1111 1111', c: '987' }),
  card('number-moved', `<form>${f('n', 'cc-number', 'oninput="document.getElementById(\'o\').appendChild(this)"')}${f('c', 'cc-csc')}</form><form id="o"></form>`, {}),
  card('code-moved', `<form>${f('n', 'cc-number', 'oninput="document.getElementById(\'o\').appendChild(document.getElementById(\'c\'))"')}${f('c', 'cc-csc')}</form><form id="o"></form>`, { n: NUMBER }),
  card('code-clipped-later', f('n', 'cc-number', 'oninput="document.getElementById(\'w\').style.cssText=\'position:absolute;clip:rect(0 0 0 0)\'"') + `<div id="w">${f('c', 'cc-csc')}</div>`, { n: NUMBER }),

  // Formless pages: nothing from a footer, a header or a sign-in box.
  address('footer', `<div>${f('s', 'street-address')}</div><footer><div>${labelled('a', 'Email', 'type="email"')}</div><div>${labelled('b', 'Name')}</div><div>${labelled('c', 'Phone')}</div></footer>`, { s: 'Brivibas 1, Apt 2' }),
  address('sign-in-box', `<div>${f('z', 'postal-code')}${f('y', 'address-level2')}</div><div><input id="a" name="email" type="email"><input type="password"></div>`,
    { z: 'LV-1010', y: 'Rigacity' }),
  card('footer-card-name', `<div>${f('n', 'cc-number')}</div><footer>${f('h', 'cc-name')}</footer>`, { n: NUMBER }),

  // Which address section.
  address('declared-before-locator', `<header><form>${labelled('x', 'Zip')}</form></header><form>${f('s', 'address-line1')}${f('z', 'postal-code')}</form>`, { s: 'Brivibas 1, Apt 2', z: 'LV-1010' }),
  address('focused-section', `<form>${f('b', 'billing email')}${f('t', 'billing tel')}${f('z', 'shipping postal-code')}${f('m', 'shipping email')}</form>`,
    { b: 'jane@secret.test', t: '+37120000000' }, 'b'),
  address('focused-lone-field', `<form>${f('b', 'billing email')}${f('z', 'shipping postal-code')}${f('m', 'shipping email')}</form>`,
    { z: 'LV-1010', m: 'jane@secret.test' }, 'b'),

  // Values in the shape the field asks for.
  expiry('year-first', 'placeholder="YY/MM"', '31/05'),
  expiry('year-first-long', 'placeholder="YYYY/MM"', '2031/05'),
  expiry('dashes', 'placeholder="MM-YY"', '05-31'),
  expiry('no-separator', 'placeholder="MMYY" maxlength="4"', '0531'),
  card('year-box', f('n', 'cc-number') + f('y', 'cc-exp-year', 'placeholder="YY"'), { n: NUMBER, y: '31' }),
  card('zero-based-months', f('n', 'cc-number') + select('m', 'cc-exp-month', months.map((t, i) => [String(i), t])), { n: NUMBER, m: '4' }),
  // Words that count from zero say nothing sure about the month.
  card('zero-based-numbers', f('n', 'cc-number') + select('m', 'cc-exp-month', months.map((_, i) => [String(i), `Option ${i}`])), { n: NUMBER }),
  card('zero-based-values-only', f('n', 'cc-number') + select('m', 'cc-exp-month', months.map((_, i) => [String(i), '-'])), { n: NUMBER, m: '4' }),
  card('decorated-months', f('n', 'cc-number') + select('m', 'cc-exp-month', months.map((_, i) => [String(i), `Month ${i + 1}`])), { n: NUMBER, m: '4' }),
  card('decorated-years', f('n', 'cc-number') + select('y', 'cc-exp-year', Array.from({ length: 40 }, (_, i) => [String(i), `Year ${2026 + i}`])), { n: NUMBER, y: '5' }),
  card('years-index-never', f('n', 'cc-number') + select('y', 'cc-exp-year', [['31', 'Year 2050'], ['2031', 'Year 2051']]), { n: NUMBER }),
  card('endless-list', f('n', 'cc-number') + select('y', 'cc-exp-year', Array.from({ length: 600 }, (_, i) => [String(1900 + i), String(1900 + i)])), { n: NUMBER }),
  card('years-two-per-option', f('n', 'cc-number') + select('y', 'cc-exp-year', [['31', '2031 or 2032']]), { n: NUMBER }),
  card('year-by-label', f('n', 'cc-number') + select('y', 'cc-exp-year', [['31', '2024'], ['7', '2031']]), { n: NUMBER, y: '7' }),

  // A page that declares address fields is filled only there, whatever labelled boxes it also has.
  ...([['address', 'wrapped'], ['zip', 'wrapped'], ['address', 'flat'], ['zip', 'flat']] as const).map(([name, shape]) => {
    const wrap = (html: string) => shape === 'wrapped' ? `<div>${html}</div>` : html;
    return address(`locator-${name}-${shape}`, '<div>' + wrap(`<input id="x" name="${name}">`) + wrap(f('s', 'address-line1')) + wrap(f('z', 'postal-code')) + '</div>',
      { s: 'Brivibas 1, Apt 2', z: 'LV-1010' });
  }),
  address('locator-beside-focused', '<div><input id="x" name="zip">' + f('s', 'address-line1') + f('z', 'postal-code') + '</div>',
    { s: 'Brivibas 1, Apt 2', z: 'LV-1010' }, 's'),
  address('declared-never-a-rival', '<div><input name="address" id="x"><div>' + f('s', 'address-line1') + '</div></div>', { s: 'Brivibas 1, Apt 2' }),
  address('lone-address-box', '<input id="x" name="address">', {}),
  address('lone-zip-box', '<input id="x" name="zip">', {}),
  address('labelled-two-zips', '<div><input id="x" name="zip"></div><div><input id="s" name="address"><input id="z" name="zip"></div>', {}),
  address('labelled-far-apart', '<div><input id="x" name="address"><input><input><input><input id="z" name="zip"></div>', {}),
  address('labelled-pair', '<form><input id="s" name="address"><input id="z" name="zip"></form>', { s: 'Brivibas 1, Apt 2', z: 'LV-1010' }),

  // A label over its field counts only while it paints nothing there.
  card('label-covers', f('n', 'cc-number') + `<div style="position:relative">${f('c', 'cc-csc')}<label for="c" style="position:absolute;inset:0;background:white">Name</label></div>`, { n: NUMBER }),
  card('label-part-covers', f('n', 'cc-number') + `<div>${f('c', 'cc-csc')}</div><label for="c">Code<div style="position:absolute;left:0;top:200px;width:300px;height:60px;background:white"></div></label><style>#c{position:absolute;left:10px;top:215px}</style>`, { n: NUMBER }),
  card('wrapping-label-covers', f('n', 'cc-number') + `<label style="position:relative;display:inline-block">${f('c', 'cc-csc')}<span style="position:absolute;inset:0;background:white"></span></label>`, { n: NUMBER }),
  card('label-pseudo-covers', f('n', 'cc-number') + `<style>label::after{content:'';position:absolute;inset:0;background:white}</style><div style="position:relative">${f('c', 'cc-csc')}<label for="c" style="position:absolute;inset:0"></label></div>`, { n: NUMBER }),
  card('narrow-wrapping-label', f('n', 'cc-number') + `<label style="position:relative;display:inline-block">${f('c', 'cc-csc', 'style="width:80px;height:40px"')}<span style="position:absolute;inset:0">CVV</span></label>`, { n: NUMBER, c: '987' }),

  // "Security code" alone counts only inside a group that holds nothing but the card.
  card('generic-in-card', `<div>${labelled('n', 'Card number', 'autocomplete="cc-number"')}${labelled('c', 'Security code')}</div>`, { n: NUMBER, c: '987' }),
  card('says-card', `<div><h2>Pay</h2></div><div>${f('n', 'cc-number')}<p>Three digits</p>${labelled('c', 'Card verification code')}</div>`, { n: NUMBER, c: '987' }),
  ...([['heading', '<h2>Verify your phone</h2>'], ['pseudo-heading', '<div class="title">Verify your phone</div>'], ['picture', '<img alt="captcha" width="80" height="30">'],
    ['field', '<input id="other">'], ['checkbox', '<input type="checkbox">'], ['rule', '<hr>']] as const).flatMap(([name, between]) => [
    card(`generic-after-${name}`, `<div>${f('n', 'cc-number')}${between}${labelled('x', 'Security code')}</div>`, { n: NUMBER }),
  ]),
  card('generic-in-group', `<div>${f('n', 'cc-number')}<div role="group" aria-label="Verify">${labelled('x', 'Security code')}</div></div>`, { n: NUMBER }),

  // Each write looks again at what the page has become.
  card('code-leaves-block', `<div>${f('n', 'cc-number', 'oninput="document.getElementById(\'o\').appendChild(document.getElementById(\'c\'))"')}${f('c', 'cc-csc')}</div><footer id="o"></footer>`, { n: NUMBER }),
  card('number-leaves-block', `<div>${f('n', 'cc-number', 'oninput="document.getElementById(\'o\').appendChild(this)"')}${f('c', 'cc-csc')}</div><div id="o"></div>`, {}),
  { ...card('number-cleared-later', f('n', 'cc-number') + f('h', 'cc-name', 'oninput="document.getElementById(\'n\').value=\'\'"') + f('e', 'cc-exp') + f('c', 'cc-csc'),
    { h: 'Jane Q Doe' }), filled: ['cc-name'] },
  { ...card('next-becomes-file', f('n', 'cc-number', 'oninput="document.getElementById(\'h\').type=\'file\'"') + f('h', 'cc-name') + f('c', 'cc-csc'),
    { n: NUMBER, c: '987' }), filled: ['cc-number', 'cc-csc'] },
  card('code-repurposed', f('n', 'cc-number', 'oninput="const c=document.getElementById(\'c\');c.setAttribute(\'autocomplete\',\'off\');c.name=\'coupon\'"') + f('c', 'cc-csc'), { n: NUMBER }),
  ...([['spaced', "this.value.replace(/(.{4})(?!$)/g,'$1 ')", '4111 1111 1111 1111'], ['masked', "'•••• •••• •••• '+this.value.slice(-4)", '•••• •••• •••• 1111'],
    ['stars', "this.value.slice(0,6)+'******'+this.value.slice(-4)", '411111******1111']] as const).map(([name, code, shown]) => ({
    ...card(`number-${name}-on-change`, f('n', 'cc-number', `onchange="this.value=${code}"`) + f('c', 'cc-csc'), { n: shown, c: '987' }),
    filled: ['cc-number', 'cc-csc'],
  })),

  // A bar fixed over part of the view hides nothing that scrolls out from under it.
  card('under-fixed-footer', `<div style="height:640px"></div>${f('n', 'cc-number')}<div style="height:900px"></div><div style="position:fixed;left:0;right:0;bottom:0;height:120px;background:white">Pay</div>`, { n: NUMBER }),
  card('under-sticky-header', `<div style="position:sticky;top:0;height:120px;background:white;z-index:2">Shop</div><div style="height:900px"></div>${f('n', 'cc-number')}<div style="height:900px"></div><script>scrollTo(0, 960)</script>`, { n: NUMBER }),
  card('under-covering-bar', `${f('n', 'cc-number')}<div style="position:fixed;left:0;right:0;top:0;height:120px;background:white"></div>`, {}),

  // Inside a closed shadow root the engine still reports full transparency and clipping. Fainter paint it hides: see docs/items.md.
  ...([['transparent', 'opacity:0'], ['clipped', 'width:0;height:0;overflow:hidden']] as const).map(([name, style]) => card(`closed-slot-${name}`,
    `${f('n', 'cc-number')}<div id="host">${f('c', 'cc-csc')}</div><script>document.getElementById('host').attachShadow({mode:'closed'}).innerHTML='<div style="${style}"><slot></slot></div>'</script>`, { n: NUMBER })),

  // A postcode widget (a delivery check, a store finder) never takes the place of the address.
  ...([['wrapper', (w: string) => `<div>${w}</div>`], ['header', (w: string) => `<header>${w}</header>`], ['form', (w: string) => `<form>${w}</form>`]] as const)
    .flatMap(([shape, wrap]) => [undefined, 'm', 'y', 's', 'x'].map((focus) => address(`widget-in-${shape}-focus-${focus ?? 'none'}`,
      wrap(f('x', 'postal-code')) + addressBlock, { m: 'Jane Doe', s: 'Brivibas 1, Apt 2', y: 'Rigacity', z: 'LV-1010' }, focus))),
  address('widget-in-same-form', `<form><div>${f('x', 'postal-code')}</div>${addressBlock}</form>`,
    { m: 'Jane Doe', s: 'Brivibas 1, Apt 2', y: 'Rigacity', z: 'LV-1010' }),
  address('widget-beside-flat-fields', `<div><div>${f('x', 'postal-code')}</div><div>${f('s', 'address-line1')}</div><div>${f('z', 'postal-code')}</div></div>`,
    { s: 'Brivibas 1, Apt 2' }, 's'),
  address('lone-postcode', f('x', 'postal-code'), {}, 'x'),
  address('postcode-and-city', f('z', 'postal-code') + f('y', 'address-level2'), { z: 'LV-1010', y: 'Rigacity' }),
  address('street-before-postcode-block', `<form>${f('x', 'shipping postal-code')}${f('w', 'shipping address-level2')}</form><form>${f('s', 'address-line1')}</form>`,
    { s: 'Brivibas 1, Apt 2' }),

  // Label parts that paint in other ways.
  ...([['progress', '<progress style="position:absolute;inset:0;width:100%;height:100%"></progress>', ''],
    ['meter', '<meter value="1" style="position:absolute;inset:0;width:100%;height:100%"></meter>', ''],
    ['decoration', '<span style="position:absolute;inset:0;font-size:40px;text-decoration:underline 60px white">MMMMMMMMMM</span>', ''],
    ['first-line', '<div class="line" style="position:absolute;inset:0;font-size:40px">MMMMMMMMMM</div>', '<style>.line::first-line{background:white}</style>'],
    ['shadow', '<div id="part" style="position:absolute;inset:0"></div>', ''],
    ['custom-element', '<x-cover style="position:absolute;inset:0"></x-cover>', '']] as const).map(([name, part, style]) => card(`label-part-${name}`,
    `${style}${f('n', 'cc-number')}<label style="position:relative;display:inline-block">${f('c', 'cc-csc')}${part}</label>` +
    (name === 'shadow' ? '<script>document.getElementById("part").attachShadow({mode:"open"}).innerHTML="<div style=\'height:100%;background:white\'></div>"</script>' : ''),
    { n: NUMBER })),

  // Renamed or retyped between writes.
  ...([['renamed', "c.name='coupon'"], ['to-password', "c.type='password'"], ['relabelled', "c.setAttribute('aria-label','Coupon')"]] as const)
    .map(([name, change]) => card(`code-${name}`, f('n', 'cc-number', `oninput="const c=document.getElementById('c');${change}"`) + f('c', 'cc-csc'), { n: NUMBER })),
];
