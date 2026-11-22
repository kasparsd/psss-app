const app = document.querySelector('#app');
const scenario = document.querySelector('#scenario');
const dialog = document.querySelector('#dialog');
const status = document.querySelector('#status');
const site = 'studio.example';
const types = {
  login: {label:'Login', fields:[
    ['site','Website'], ['name','Username'], ['password','Password','password',true],
    ['otp','One-time code setup key','password']
  ]},
  card: {label:'Credit card', fields:[
    ['holder','Cardholder', 'text', true], ['number','Card number','password',true],
    ['expiry','Expiry (MM/YY)','text',true], ['code','Security code','password']
  ]},
  note: {label:'Secure note', fields:[]},
  generic: {label:'KeePass entry', fields:[['site','Website'], ['name','Username'], ['password','Password','password']]}
};
const checkout = 'shop.example';
const sampleItems = [
  {type:'card', title:'Everyday card', holder:'Alex Example', number:'4242424242424242', expiry:'08/30', code:'123'},
  {type:'note', title:'Travel checklist', notes:'Sample locker instructions and trip notes.'},
  {type:'generic', title:'Design software license', tags:'software', expires:'2027-05-01',
    custom:[{name:'License key', value:'DEMO-LICENSE-123', protected:true}],
    attachments:['sample-receipt.txt']}
];
const entries = [
  {type:'login', title:'Studio North', site, name:'alex@example.net', password:'Demo-only-Maple7!', vault:'Personal'},
  {type:'login', title:'Studio North', site, name:'alex@studio.example', password:'Demo-only-River3!', vault:'Work'},
  {type:'login', title:'Postbox', site:'postbox.example', name:'alex@example.net', password:'Demo-only-Cloud4!', vault:'Personal'},
  ...sampleItems.map(item => ({...item,vault:'Personal'}))
];
const vaults = ['Personal', 'Work'];
const history = new Map();
let selected = 0;
let unlocked = false;
const storageByVault = new Map(vaults.map(vault => [vault, 'On this device']));
let currentVault = 'Personal';
let pending = null;
let draftIndex = -1;

let search = '';
const titles = {
  fill:['Fill a login','Choose the account you want to use at studio.example.'],
  locked:['Fill a login','Unlock Psss and pick up where you left off.'],
  signup:['Create a login','Generate a password on the signup form and save it to a vault.'],
  update:['Change a password','Review which account to update after changing its password.'],
  vault:['Your vault','Find, add and edit logins, cards, notes and KeePass entries.'],
  checkout:['Fill a credit card','Choose a fictional card to fill the demo checkout at shop.example.'],
  onboarding:['Bring your passwords with you','Open an existing vault, import from 1Password, or create an empty vault.']
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[char]);
const button = (action, label, primary = false) =>
  `<button type="button" data-action="${action}" class="${primary ? 'primary' : ''}">${label}</button>`;
const field = (label, id, value = '', type = 'text', required = true) =>
  `<label class="field">${label}<input ${id ? `id="${id}"` : ''} type="${type}" value="${esc(value)}"${required ? ' required' : ''} autocomplete="off"></label>`;
const options = (value = currentVault) => vaults.map(v =>
  `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('');
const notify = message => { status.textContent = message; };
const generate = () => 'Demo-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), byte =>
  byte.toString(16).padStart(2, '0')).join('') + '!';

function showModal(title, contents) {
  dialog.innerHTML = `<h2 id="dialog-title">${title}</h2>${contents}`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('input, select, button')?.focus();
}

function choices(mode, filter = '') {
  const needle = filter.toLowerCase();
  const results = entries.map((entry, index) => ({entry, index})).filter(({entry}) => {
    if (mode === 'fill') return entry.type === 'login' && entry.site === site && entry.password;
    if (mode === 'pay') return entry.type === 'card';
    return entry.vault === currentVault &&
      [entry.title, entry.name, entry.site, entry.tags, types[entry.type].label].some(value =>
        value?.toLowerCase().includes(needle));
  });
  return results.map(({entry, index}) => `<button type="button" class="choice" data-action="${mode}-${index}">
    <strong>${esc(mode === 'fill' ? entry.name : entry.title)}</strong>
    <small>${esc(mode === 'pay' ? 'Ending in ' + entry.number.slice(-4) + ' · ' + entry.vault :
      mode === 'fill' ? entry.vault : types[entry.type].label + ' · ' + (entry.name || entry.vault))}</small></button>`).join('') ||
    '<p class="muted">No matching items.</p>';
}

function render() {
  const mode = scenario.value;
  const [title, description] = titles[mode];
  app.innerHTML = `<h1>${title}</h1><p class="intro">${description}</p>`;
  if (mode === 'vault') return renderVault();
  if (mode === 'onboarding') {
    app.innerHTML += `<section class="window"><div class="pane">
      <button class="choice" data-action="open"><strong>Open a KeePass vault</strong><small>Continue with a .kdbx file from Strongbox or another KeePass app</small></button>
      <button class="choice" data-action="import"><strong>Import from 1Password</strong><small>Review a sample 1PUX migration</small></button>
      <button class="choice" data-action="create"><strong>Create a vault</strong><small>Choose on-device storage or iCloud Drive</small></button>
      </div></section>`;
    return;
  }
  if (mode === 'checkout') {
    app.innerHTML += `<section class="window"><div class="bar"><span class="origin">${checkout}</span><span>Demo website</span></div>
      <div class="split"><div class="pane"><h2>Payment details</h2><form id="checkout">
        ${types.card.fields.map(([key,label,type,required]) => field(label,'pay-'+key,'',type,required)).join('')}
        <button class="primary">Continue</button></form></div>
        <aside class="pane"><h2>Choose a card</h2><p class="muted">Selecting a card fills this demo form. Enter the security code separately.</p>${choices('pay')}</aside>
      </div></section>`;
    return;
  }
  const adding = mode === 'signup';
  const updating = mode === 'update';
  const locked = mode === 'locked' && !unlocked;
  app.innerHTML += `<section class="window">
    <div class="bar"><span class="origin">${site}</span><span>Demo website</span></div>
    <div class="split">
      <div class="pane"><p class="eyebrow">Studio North</p>
        <h2>${adding ? 'Create your account' : updating ? 'Change your password' : 'Sign in'}</h2>
        <form id="website">
          ${field('Email','web-name', adding || updating ? 'alex@example.net' : '', 'email')}
          ${field(updating ? 'New password' : 'Password','web-password','','password')}
          <div class="actions"><button class="primary">${adding ? 'Create account' : updating ? 'Change password' : 'Sign in'}</button></div>
        </form>
      </div>
      <aside class="pane" aria-label="Psss AutoFill"><p class="eyebrow">Psss AutoFill</p>
        <h2>${locked ? 'Vault locked' : adding || updating ? 'Use a generated password' : 'Logins for this site'}</h2>
        ${locked ? button('unlock','Unlock to fill',true) :
          adding || updating ? button('generate-web','Generate and fill',true) : choices('fill')}
      </aside>
    </div></section>`;
}

function privateValue(key, mask = '••••••••') {
  return `<span data-secret="${esc(key)}" data-mask="${esc(mask)}">${esc(mask)}</span>`;
}

function entryDetails(entry) {
  const fields = types[entry.type].fields.filter(([key]) => entry[key]).map(([key,label,type]) =>
    `<dt>${label}</dt><dd>${type === 'password' ? privateValue(key, key === 'number' ?
      '•••• ' + entry[key].slice(-4) : undefined) : esc(entry[key])}</dd>`);
  for (const [index, custom] of (entry.custom ?? []).entries()) {
    fields.push(`<dt>${esc(custom.name)}</dt><dd>${custom.protected ? privateValue('custom-' + index) : esc(custom.value)}</dd>`);
  }
  if (entry.notes) fields.push(`<dt>Notes</dt><dd>${entry.type === 'note' ? privateValue('notes') : esc(entry.notes)}</dd>`);
  if (entry.tags) fields.push(`<dt>Tags</dt><dd>${esc(entry.tags)}</dd>`);
  if (entry.expires) fields.push(`<dt>Expires</dt><dd>${esc(entry.expires)}</dd>`);
  if (entry.attachments?.length) fields.push(`<dt>Attachments</dt><dd>${esc(entry.attachments.join(', '))}</dd>`);
  return `<p class="eyebrow">${types[entry.type].label}</p><h2>${esc(entry.title)}</h2>
    <dl>${fields.join('')}</dl>
    ${history.has(entry) ? '<p class="muted">Previous version retained in this session.</p>' : ''}
    <div class="actions">${fields.some(field => field.includes('<span data-secret=')) ? button('reveal','Reveal protected fields') : ''}
      ${button('edit','Edit item')}</div>`;
}

function renderVault() {
  const entry = entries[selected]?.vault === currentVault ? entries[selected] : null;
  app.innerHTML += `<section class="window">
    <div class="bar"><label>Vault <select id="active-vault">${options()}</select></label><span>${esc(storageByVault.get(currentVault))}</span>${button('new','New item',true)}</div>
    <div class="split">
      <div class="pane"><label class="field">Search items<input type="search" id="search" value="${esc(search)}"></label>
        <div id="results">${choices('select',search)}</div></div>
      <section class="pane">${entry ? entryDetails(entry) : '<h2>Choose an item</h2><p class="muted">Select or add an item to this vault.</p>'}
        <div class="actions">${button('setup','Set up AutoFill')}</div>
      </section>
    </div></section>`;
}

function customField(custom = {}) {
  return `<div class="custom-field">${field('Field name','',custom.name)}
    ${field('Value','',custom.value,'password',false)}
    <label><input type="checkbox" ${custom.protected !== false ? 'checked' : ''}> Hide value in item details</label>
    ${button('remove-field','Remove field')}</div>`;
}

function editItem(index, type = entries[index]?.type) {
  const entry = entries[index] ?? {};
  draftIndex = index;
  showModal(index === -1 ? 'New ' + types[type].label.toLowerCase() : 'Edit ' + types[type].label.toLowerCase(),
    `<form id="item-editor" data-kind="${type}">${field('Title','edit-title',entry.title)}
      ${types[type].fields.map(([key,label,inputType,required]) =>
        field(label,'edit-'+key,entry[key],inputType,!!required)).join('')}
      ${type === 'login' ? button('generate-editor','Generate password') : ''}
      <label class="field">Notes<textarea id="edit-notes" rows="4" ${type === 'note' ? 'required' : ''}>${esc(entry.notes)}</textarea></label>
      <details ${type === 'generic' ? 'open' : ''}>
        <summary>KeePass fields</summary>${field('Tags','edit-tags',entry.tags,'text',false)}
        ${field('Item expiry','edit-expires',entry.expires,'date',false)}
        <div id="custom-fields">${(entry.custom ?? []).map(customField).join('')}</div>
        ${button('add-field','Add custom field')}
        <label class="field">Attachment names (demo)
          <textarea id="edit-attachments" rows="2" placeholder="One name per line">${esc(entry.attachments?.join('\n'))}</textarea></label>
      </details>
      <label class="field">Vault<select id="edit-vault">${options(entry.vault)}</select></label>
      <div class="actions"><button class="primary">Save item</button>${button('cancel','Cancel')}</div></form>`);
}

function reviewSave() {
  const match = entries.findIndex(entry => entry.type === 'login' && entry.site === site && entry.name === pending.name);
  const update = scenario.value === 'update' && match >= 0;
  showModal(update ? 'Update this login?' : 'Save this login?', `<p class="origin">${site}</p>
    <p>${esc(pending.name)}</p>
    ${update ? `<p>In ${esc(entries[match].vault)}. The previous password stays in history.</p>` :
      `<label class="field">Save to<select id="destination">${options()}</select></label>`}
    <div class="actions">${button(update ? 'update-' + match : 'save',update ? 'Update login' : 'Save login',true)}
      ${update ? button('save-another','Save as new') : ''}${button('cancel','Cancel')}</div>`);
}

function storageForm(title, action, name) {
  showModal(title, `<form id="vault-editor" data-kind="${action}">
    ${field('Vault name','vault-name',name)}
    <label class="field">Storage<select id="storage"><option>On this device</option><option>iCloud Drive</option></select></label>
    ${action === 'create' ? field('Demo vault password','vault-password','','password') : ''}
    <div class="actions"><button class="primary">${title}</button>${button('cancel','Cancel')}</div></form>`);
}

scenario.addEventListener('change', () => {
  unlocked = false;
  pending = null;
  notify('');
  render();
  app.querySelector('h1').setAttribute('tabindex', '-1');
  app.querySelector('h1').focus();
});

app.addEventListener('change', event => {
  if (event.target.id !== 'active-vault') return;
  currentVault = event.target.value;
  selected = entries.findIndex(entry => entry.vault === currentVault);
  render();
  document.querySelector('#active-vault').focus();
});

document.addEventListener('input', event => {
  if (event.target.id === 'search') {
    search = event.target.value;
    document.querySelector('#results').innerHTML = choices('select',search);
  }
});

const value = id => document.getElementById(id).value;
function goToVault(message) {
  scenario.value = 'vault';
  search = '';
  dialog.close();
  render();
  notify(message);
  app.querySelector('h1').setAttribute('tabindex','-1');
  app.querySelector('h1').focus();
}

document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'website') {
    if (['signup','update'].includes(scenario.value)) {
      pending = {type:'login',title:'Studio North', site, name:value('web-name'), password:value('web-password')};
      reviewSave();
    } else {
      notify('Signed in to the demo website.');
    }
  }
  if (form.id === 'unlock-form') {
    const name = value('web-name');
    const password = value('web-password');
    unlocked = true;
    dialog.close();
    render();
    document.getElementById('web-name').value = name;
    document.getElementById('web-password').value = password;
    app.querySelector('[data-action^="fill-"]')?.focus();
    notify('Vault unlocked. Choose a login.');
  }
  if (form.id === 'checkout') notify('Payment details entered in the demo. No payment was made.');
  if (form.id === 'item-editor') {
    const type = form.dataset.kind;
    const entry = {
      type, title:value('edit-title'), vault:value('edit-vault'), notes:value('edit-notes'),
      tags:value('edit-tags'), expires:value('edit-expires'),
      attachments:value('edit-attachments').split('\n').map(name => name.trim()).filter(Boolean),
      custom:Array.from(form.querySelectorAll('.custom-field'), row => {
        const [name, secret, hidden] = row.querySelectorAll('input');
        return {name:name.value, value:secret.value, protected:hidden.checked};
      })
    };
    for (const [key] of types[type].fields) entry[key] = value('edit-'+key);
    if (draftIndex === -1) {
      selected = entries.push(entry) - 1;
    } else {
      const existing = entries[draftIndex];
      history.set(existing,{...existing});
      Object.assign(existing,entry);
      selected = draftIndex;
    }
    currentVault = entry.vault;
    goToVault(types[type].label + ' saved to ' + entry.vault + '.');
  }
  if (form.id === 'open-form') storageForm('Open vault','open','Strongbox sample');
  if (form.id === 'vault-editor') {
    const kind = form.dataset.kind;
    currentVault = value('vault-name').trim() || 'New vault';
    storageByVault.set(currentVault,value('storage'));
    if (!vaults.includes(currentVault)) vaults.push(currentVault);
    selected = -1;
    if (kind !== 'create') {
      selected = entries.length;
      entries.push({type:'login', title:'Mail', site:'mail.example', name:'sample@example.net',
        password:generate(),vault:currentVault});
      const imported = kind === 'import' ? sampleItems.slice(0,2) : sampleItems;
      entries.push(...imported.map(item => ({...item,vault:currentVault})));
    }
    goToVault(kind === 'import' ? 'Imported 3 sample items.' :
      kind === 'open' ? 'Sample KeePass vault opened.' : 'Vault created. Add your first item.');
  }
});

dialog.addEventListener('close', () => { pending = null; });

document.addEventListener('click', event => {
  const target = event.target.closest('button[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const [kind, index] = action.split('-');
  if (kind === 'fill') {
    document.getElementById('web-name').value = entries[index].name;
    document.getElementById('web-password').value = entries[index].password;
    app.querySelector('#website button').focus();
    notify('Login filled. You can now sign in.');
  }
  if (kind === 'select') {
    selected = Number(index);
    render();
    app.querySelector(`[data-action="select-${index}"]`)?.focus();
  }
  if (action === 'unlock') showModal('Unlock Psss', `<form id="unlock-form">
    <p>You’re filling a login at <strong>${site}</strong>. Enter any fictional password to continue.</p>
    ${field('Demo vault password','unlock-password','','password')}
    <div class="actions"><button class="primary">Unlock</button>${button('cancel','Cancel')}</div></form>`);
  if (action === 'generate-web') {
    document.getElementById('web-password').value = generate();
    app.querySelector('#website button').focus();
    notify('Generated password filled.');
  }
  if (action === 'generate-editor') {
    document.getElementById('edit-password').value = generate();
    notify('Generated a demo password.');
  }
  if (action === 'save-another') {
    showModal('Save as a new login?', `<p>${site} · ${esc(pending.name)}</p>
      <label class="field">Save to<select id="destination">${options()}</select></label>
      <div class="actions">${button('save','Save new login',true)}${button('cancel','Cancel')}</div>`);
  }
  if (action === 'save' && pending) {
    pending.vault = value('destination');
    selected = entries.push(pending) - 1;
    currentVault = pending.vault;
    dialog.close();
    notify('Login saved to ' + entries[selected].vault + '.');
  }
  if (kind === 'update' && pending) {
    const entry = entries[index];
    history.set(entry,{...entry});
    entry.password = pending.password;
    selected = Number(index);
    currentVault = entry.vault;
    dialog.close();
    notify('Login updated in ' + entry.vault + '.');
  }
  if (kind === 'pay') {
    for (const key of ['holder','number','expiry']) document.getElementById('pay-'+key).value = entries[index][key];
    document.getElementById('pay-code').value = '';
    document.getElementById('pay-code').focus();
    notify('Filled cardholder, card number and expiry.');
  }
  if (action === 'new') showModal('New item', Object.entries(types).map(([type,{label}]) =>
    `<button class="choice" data-action="createitem-${type}">${label}</button>`).join('') +
    button('cancel','Cancel'));
  if (kind === 'createitem') editItem(-1,index);
  if (action === 'edit') editItem(selected);
  if (action === 'add-field') {
    document.querySelector('#custom-fields').insertAdjacentHTML('beforeend',customField());
    document.querySelector('#custom-fields .custom-field:last-child input').focus();
  }
  if (action === 'remove-field') {
    target.closest('.custom-field').remove();
    dialog.querySelector('[data-action="add-field"]').focus();
  }
  if (action === 'reveal') {
    const reveal = target.textContent === 'Reveal protected fields';
    for (const secret of app.querySelectorAll('[data-secret]')) {
      const key = secret.dataset.secret;
      const entry = entries[selected];
      secret.textContent = reveal ? (key.startsWith('custom-') ?
        entry.custom[Number(key.slice(7))].value : entry[key]) : secret.dataset.mask;
    }
    target.textContent = reveal ? 'Hide protected fields' : 'Reveal protected fields';
  }
  if (action === 'open') showModal('Open sample.kdbx', `<form id="open-form">
    <p>Try the Strongbox flow with a fictional vault.</p>
    ${field('Demo vault password','sample-password','','password')}
    <div class="actions"><button class="primary">Unlock sample vault</button>${button('cancel','Cancel')}</div></form>`);
  if (action === 'import') showModal('Review sample 1PUX import',
    `<ul><li>1 login, 1 credit card and 1 secure note ready to import</li><li>1 exact duplicate to skip</li><li>1 passkey requires separate migration</li></ul>
    <div class="actions">${button('import-next','Choose destination',true)}${button('cancel','Cancel')}</div>`);
  if (action === 'import-next') storageForm('Import items','import','Imported items');
  if (action === 'create') storageForm('Create vault','create','New vault');
  if (action === 'setup') showModal('Set up AutoFill', `<p>In Settings, open AutoFill &amp; Passwords and enable Psss as a provider.</p>
    <div class="actions">${button('try-fill','Try demo AutoFill',true)}${button('cancel','Close')}</div>`);
  if (action === 'try-fill') {
    dialog.close();
    scenario.value = 'fill';
    scenario.dispatchEvent(new Event('change'));
  }
  if (action === 'cancel') dialog.close();
});

render();
