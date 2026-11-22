// Runs inside the page through scripting.executeScript, in the extension's isolated world,
// in the top frame only. It must stay self-contained: the browser serializes it as source.
// It receives the secret as an argument and never returns it.
function psssFillPage(account, secret) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly;
  };
  const setValue = (el, value) => {
    // Frameworks track the value through the prototype setter. Assigning el.value alone is ignored.
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible);
  const focused = passwords.find((el) => el === document.activeElement) ?? passwords[0];
  if (!focused && !account) return { filled: [] };

  const filled = [];
  // The username field is the nearest preceding visible text-like input in the same form,
  // or any visible username-looking input on a first step with no password field yet.
  const textLike = 'input:not([type]), input[type=text], input[type=email], input[type=tel]';
  const scope = focused?.form ?? document;
  const candidates = [...scope.querySelectorAll(textLike)].filter(visible);
  let user = null;
  if (focused) {
    const before = candidates.filter((el) => el.compareDocumentPosition(focused) & Node.DOCUMENT_POSITION_FOLLOWING);
    user = before[before.length - 1] ?? null;
  } else {
    user = candidates.find((el) => /user|email|login|account/i.test(el.autocomplete + el.name + el.id)) ?? null;
  }
  if (user && account) { setValue(user, account); filled.push('username'); }
  if (focused && secret) { setValue(focused, secret); filled.push('password'); }
  return { filled };
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
  const newPassword = passwords.some((el) => /new-password/.test(el.autocomplete)) || passwords.length >= 2;
  const first = passwords[0];
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
  const anchor = all.find((el) => /new-password/.test(el.autocomplete)) ?? all[0];
  const fields = anchor ? all.filter((el) => el.form === anchor.form) : [];
  for (const el of fields) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, secret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { filled: fields.length };
}
