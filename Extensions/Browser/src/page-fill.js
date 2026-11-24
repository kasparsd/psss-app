// Injected into the top frame. Everything it needs lives inside the function because
// scripting.executeScript serializes it. Values never come back to the extension.
function psssFillPage(fields, mode, expectedOrigin) {
  const result = { filled: [] };
  if (location.origin !== expectedOrigin) return result;

  const roleAliases = {
    username: ['username', 'user', 'login', 'loginname', 'email', 'account', 'accountname'],
    'current-password': ['password', 'currentpassword', 'loginpassword'],
    'one-time-code': ['otp', 'totp', 'verificationcode', 'onetimecode'],
    'cc-number': ['cardnumber', 'cardno', 'creditcardnumber', 'ccnumber', 'ccnum'],
    'cc-name': ['nameoncard', 'cardholder', 'cardholdername', 'ccname'],
    'cc-exp': ['expiry', 'expiration', 'expirationdate', 'expirydate', 'validthru', 'ccexp'],
    'cc-exp-month': ['expirymonth', 'expirationmonth', 'ccexpmonth', 'expmonth'],
    'cc-exp-year': ['expiryyear', 'expirationyear', 'ccexpyear', 'expyear'],
    'cc-csc': ['cvv', 'cvc', 'cvv2', 'cvc2', 'securitycode', 'cccsc']
  };
  const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const visible = (input) => {
    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return rect.width > 0 && rect.height > 0 && style.visibility === 'visible' &&
      style.display !== 'none' && !input.matches(':disabled') && !input.readOnly;
  };
  const describe = (input) => {
    const tokens = input.autocomplete.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.at(-1) === 'webauthn') tokens.pop();
    const field = tokens.at(-1);
    const context = tokens.slice(0, -1).join(' ');
    const validContext = /^(?:section-\S+(?: |$))?(?:(?:billing|shipping)(?: |$))?(?:home|work|mobile|fax|pager)?$/.test(context);
    const group = context.split(' ').filter((token) => token.startsWith('section-') || token === 'billing' || token === 'shipping').join(' ');
    if (field && field !== 'on' && field !== 'off') {
      return { input, role: validContext ? field : undefined, group, declared: validContext, ambiguous: !validContext };
    }
    if (field === 'off') return { input, group };
    const labels = [input.name, input.id, input.getAttribute('aria-label'), ...[...(input.labels ?? [])].map((label) => label.textContent)];
    const names = labels.map(normalize);
    const matched = Object.keys(roleAliases).filter((role) => roleAliases[role].some((alias) => names.includes(alias)));
    return { input, role: matched.length === 1 ? matched[0] : undefined, group, ambiguous: matched.length > 1 };
  };
  const all = [...document.querySelectorAll('input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=password], input[type=number], input[type=month], select')]
    .filter(visible).map(describe);
  const active = document.activeElement;
  const unique = (matches) => matches.length === 1 ? matches[0] : matches.find(({ input }) => input === active);
  const preferred = (matches) => {
    const declared = matches.filter((entry) => entry.declared);
    return unique(declared.length ? declared : matches);
  };
  const inScope = (list, anchor) => list.filter((entry) => entry.input.form === anchor.input.form && entry.group === anchor.group);
  const write = (entry, value, role) => {
    if (!entry || typeof value !== 'string' || !value) return;
    const { input } = entry;
    if (input.tagName === 'SELECT') {
      const numericComponent = role === 'cc-exp-month' || role === 'cc-exp-year';
      const option = [...input.options].find((option) => option.value && !option.disabled && (option.value === value ||
        (numericComponent && Number(option.value) === Number(value)) ||
        (role === 'cc-exp-year' && option.value.length === 2 && option.value === value.slice(-2))));
      if (!option) return;
      value = option.value;
    }
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    setter.call(input, value);
    if (input.value !== value) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    result.filled.push(role);
  };

  if (mode === 'card' || mode === 'probe-card') {
    const numberFields = all.filter(({ role, input }) =>
      role === 'cc-number' && ['text', 'tel', 'number'].includes(input.type) && input.form);
    const focused = all.find(({ input }) => input === active);
    const focusedCard = focused?.input.form
      ? preferred(numberFields.filter(({ input, group }) => input.form === focused?.input.form && group === focused?.group))
      : undefined;
    const anchor = focusedCard ?? preferred(numberFields);
    if (!anchor) return result;
    const scope = inScope(all, anchor);
    if (mode === 'probe-card') return { ...result, checkout: true };
    write(anchor, fields['cc-number'], 'cc-number');
    if (!result.filled.length) return result;
    for (const role of ['cc-name', 'cc-exp', 'cc-exp-month', 'cc-exp-year']) {
      const target = preferred(scope.filter((entry) => entry.role === role));
      const iso = fields['cc-exp'];
      let value = fields[role];
      if (iso && /^\d{4}-\d{2}$/.test(iso)) {
        if (role === 'cc-exp' && target?.input.type !== 'month') {
          const hint = target?.input.placeholder?.toLowerCase() ?? '';
          if (hint.includes('mm/yy')) value = iso.slice(5) + '/' + (hint.includes('yyyy') ? iso.slice(0, 4) : iso.slice(2, 4));
        }
        if (role === 'cc-exp-month') value = iso.slice(5);
        if (role === 'cc-exp-year') value = iso.slice(0, 4);
      }
      write(target, value, role);
    }
    return result;
  }

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
