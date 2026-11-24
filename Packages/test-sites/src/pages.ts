import { code, otpauthURI, secondsLeft } from './totp.ts';
import type { Totp } from './totp.ts';
import type { Account, Site } from './state.ts';

export type Ctx = { host: string; port: string; site: Site; account?: Account; known: string[] };

export function esc(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const css = `:root{color-scheme:light dark;font-family:-apple-system,system-ui,sans-serif}
body{max-width:30rem;margin:1.5rem auto;padding:0 1rem;line-height:1.4}
label{display:block;margin-top:1rem;font-weight:600}
input,select{width:100%;box-sizing:border-box;padding:.7rem;font-size:1.05rem;margin-top:.25rem}
button{margin-top:1.2rem;width:100%;padding:.8rem;font-size:1.1rem}
nav a{margin-right:.8rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{border-bottom:1px solid #8884;padding:.3rem;text-align:left;vertical-align:top}
code,pre{font-family:ui-monospace,monospace;word-break:break-all;white-space:pre-wrap}
.note{opacity:.7;font-size:.9rem}.error{color:#c00;font-weight:600}.ok{color:#080;font-weight:600}
.scroll{overflow-x:auto}
section{margin-top:2rem;padding-top:.5rem;border-top:1px solid #8884}`;

export function layout(ctx: Ctx, title: string, body: string): string {
  const nav = [['/', 'Home'], ['/signup', 'Sign up'], ['/login', 'Sign in'], ['/account', 'Account'], ['/passkeys', 'Passkeys']]
    .map(([href, label]) => `<a href="${href}">${label}</a>`).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(ctx.host)}</title><style>${css}</style>
<nav>${nav}</nav><p class="note">Test site <b>${esc(ctx.host)}</b>. Fictional, nothing leaves this computer.</p>
<h1>${esc(title)}</h1>${body}`;
}

export function totpSummary(totp: Totp): string {
  return `${totp.algorithm}, ${totp.digits} digits, ${totp.period} s`;
}

export function home(ctx: Ctx, hosts: string[]): string {
  const base = (h: string) => `http://${h}:${ctx.port}/`;
  const rows = [...ctx.site.accounts.values()].map((a) => `<tr><td>${esc(a.username)}</td><td><code>${esc(a.password) || '(none)'}</code></td>
<td>${a.totp ? `<code>${esc(a.totp.secret)}</code><br>${esc(totpSummary(a.totp))}<br>now <code>${code(a.totp)}</code> (${secondsLeft(a.totp)} s)` : '-'}</td>
<td>${a.passkeys.length}</td></tr>`).join('');
  return layout(ctx, 'Test sites', `
<p>Plays any site's sign-in so AutoFill can be tried. Each host name below is a separate site with its own accounts. Any <code>*.localhost</code> name works.</p>
<p>${hosts.map((h) => `<a href="${base(h)}">${esc(h)}</a>`).join('<br>')}</p>
<section><h2>Accounts on this host</h2>
<div class="scroll"><table><tr><th>User</th><th>Password</th><th>Authenticator</th><th>Passkeys</th></tr>${rows || '<tr><td colspan="4">None yet. Sign up, or start the server with --seed.</td></tr>'}</table></div>
<form method="post" action="/reset"><button>Forget this host</button></form>
<form method="post" action="/reset-all"><button>Forget every host</button></form></section>
<section><h2>What this server saw</h2><pre>${esc(ctx.site.log.join('\n') || 'Nothing yet.')}</pre></section>
<section><h2>Scripts</h2><p class="note"><code>GET /api/state</code>, <code>POST /api/accounts</code> {username, password, totp?, digits?, period?, algorithm?},
<code>GET /api/code?username=</code> (the code the server expects now), <code>POST /api/reset</code>.</p></section>`);
}

export function signup(ctx: Ctx, query: URLSearchParams, error = ''): string {
  const rules = query.get('rules');
  return layout(ctx, 'Create account', `${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/signup">
  <label for="n">Name</label><input id="n" name="name" autocomplete="name">
  <label for="u">Email</label><input id="u" name="username" type="email" autocomplete="username" autocapitalize="none" required>
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="new-password" minlength="8" required${rules ? ` passwordrules="${esc(rules)}"` : ''}>
  <label for="c">Confirm password</label><input id="c" name="confirm" type="password" autocomplete="new-password" minlength="8" required>
  <button type="submit">Create account</button>
</form>
<p class="note">Open <code>/signup?rules=required: upper; required: digit; minlength: 12;</code> to test password rules.</p>`);
}

export function login(ctx: Ctx, error = ''): string {
  return layout(ctx, 'Sign in', `${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/login">
  <label for="u">Email</label><input id="u" name="username" type="email" autocomplete="username webauthn" autocapitalize="none">
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password">
  <button type="submit">Sign in</button>
</form>
<p><a href="/signup">Create an account</a></p>
<pre id="out"></pre>
<script>${passkeyClient()}
conditional();</script>`);
}

export function otp(ctx: Ctx, account: Account, query: URLSearchParams, error = ''): string {
  const totp = account.totp!;
  const attr = query.get('attr') === 'none' ? '' : ' autocomplete="one-time-code"';
  const hint = query.get('hint') === '0' ? '' : `<details open><summary>Test hint</summary>The server expects <code>${code(totp)}</code> now (${secondsLeft(totp)} s left).
Format: ${esc(totpSummary(totp))}.</details>`;
  return layout(ctx, 'Enter time-based OTP', `${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/otp?${esc(query.toString())}">
  <label for="c">Code from your authenticator app</label>
  <input id="c" name="code" inputmode="numeric" maxlength="${totp.digits}"${attr}>
  <button type="submit">Verify</button>
</form>${hint}
<p class="note">Add <code>?attr=none</code> to leave out the <code>one-time-code</code> hint, as many sites do. <code>?hint=0</code> hides the expected code.</p>`);
}

export function account(ctx: Ctx, a: Account, setup: { secret: string; query: URLSearchParams }, message = ''): string {
  const totp = a.totp;
  const otpSection = totp
    ? `<p>On: ${esc(totpSummary(totp))}</p><p>Secret <code>${esc(totp.secret)}</code></p><p>URI <code>${esc(otpauthURI(totp, ctx.host, a.username))}</code></p>
<p>Code now <code>${code(totp)}</code> (${secondsLeft(totp)} s)</p><form method="post" action="/account/otp/remove"><button>Remove authenticator</button></form>`
    : `<p>Add this secret to Psss (paste it into a login's verification code), then type the code it shows.</p>
<form method="post" action="/account/otp">
  <input type="hidden" name="secret" value="${esc(setup.secret)}">
  <p>Secret <code>${esc(setup.secret)}</code></p>
  <label for="d">Digits</label><select id="d" name="digits"><option>6</option><option>7</option><option>8</option></select>
  <label for="pe">Period (seconds)</label><select id="pe" name="period"><option>30</option><option>60</option></select>
  <label for="al">Algorithm</label><select id="al" name="algorithm"><option>SHA1</option><option>SHA256</option><option>SHA512</option></select>
  <label for="cc">Code now</label><input id="cc" name="code" inputmode="numeric">
  <button>Turn on authenticator</button>
</form>`;
  return layout(ctx, 'Account', `${message ? `<p class="ok">${esc(message)}</p>` : ''}
<p>Signed in as <b>${esc(a.username)}</b>.</p>
${a.password ? `<section><h2>Change password</h2>
<form method="post" action="/account/password">
  <input name="username" type="hidden" value="${esc(a.username)}" autocomplete="username">
  <label for="o">Current password</label><input id="o" name="current" type="password" autocomplete="current-password">
  <label for="n1">New password</label><input id="n1" name="password" type="password" autocomplete="new-password" minlength="8">
  <label for="n2">Confirm new password</label><input id="n2" name="confirm" type="password" autocomplete="new-password" minlength="8">
  <button>Change password</button>
</form></section>` : '<section><h2>Password</h2><p class="note">This account has no password, only passkeys.</p></section>'}
<section id="otp"><h2>Authenticator app</h2>${otpSection}</section>
<section><h2>Passkeys</h2><p>${a.passkeys.length} saved for this account. <a href="/passkeys">Create or use one</a>.</p></section>
<section><form method="post" action="/logout"><button>Sign out</button></form>
<form method="post" action="/account/delete"><button>Delete this account</button></form></section>`);
}

export function passkeys(ctx: Ctx, query: URLSearchParams): string {
  const rpId = query.get('rpId') ?? '';
  return layout(ctx, 'Passkeys', `
<p>Create a passkey, then sign in with it. The server checks the challenge, origin, relying party hash and signature.</p>
<form onsubmit="return false">
  <label for="u">Email</label><input id="u" type="email" value="alex@example.net" autocomplete="username webauthn" autocapitalize="none">
  <label for="rp">Relying party ID (empty: this host; or a parent such as example.localhost)</label>
  <input id="rp" value="${esc(rpId)}" autocapitalize="none">
  <button id="create">Create passkey</button>
  <button id="signin">Sign in with a passkey</button>
</form>
<pre id="out">Ready.</pre>
<script>${passkeyClient()}
document.getElementById('create').onclick = () => run(() => create(document.getElementById('u').value, document.getElementById('rp').value));
document.getElementById('signin').onclick = () => run(() => signIn(document.getElementById('rp').value));
conditional();</script>`);
}

/** Browser side of the passkey flows. Everything the server needs goes back as base64url. */
function passkeyClient(): string {
  return `
const out = (t) => { const o = document.getElementById('out'); if (o) o.textContent = t; };
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const raw = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), (c) => c.charCodeAt(0));
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j;
}
async function run(f) { try { out(await f()); } catch (e) { out('Failed: ' + (e.name === 'Error' ? '' : e.name + ': ') + e.message); } }
async function create(username, rpId) {
  const o = await post('/api/webauthn/register/options', { username, rpId: rpId || undefined });
  const c = await navigator.credentials.create({ publicKey: { challenge: raw(o.challenge), rp: o.rp,
    user: { id: raw(o.user.id), name: o.user.name, displayName: o.user.displayName }, pubKeyCredParams: o.pubKeyCredParams,
    authenticatorSelection: o.authenticatorSelection, attestation: 'none', timeout: 120000 } });
  await post('/api/webauthn/register/verify', { challenge: o.challenge, id: b64(c.rawId), clientDataJSON: b64(c.response.clientDataJSON),
    authenticatorData: b64(c.response.getAuthenticatorData()), publicKey: b64(c.response.getPublicKey()) });
  return 'Passkey created and verified by the server ✓\\nid: ' + b64(c.rawId) + '\\nrp: ' + o.rp.id;
}
async function signInWith(rpId, mediation) {
  const o = await post('/api/webauthn/login/options', { rpId: rpId || undefined });
  const a = await navigator.credentials.get({ publicKey: { challenge: raw(o.challenge), rpId: o.rpId, userVerification: 'preferred', timeout: 120000 }, mediation });
  const r = await post('/api/webauthn/login/verify', { challenge: o.challenge, id: b64(a.rawId), clientDataJSON: b64(a.response.clientDataJSON),
    authenticatorData: b64(a.response.authenticatorData), signature: b64(a.response.signature), userHandle: a.response.userHandle ? b64(a.response.userHandle) : null });
  return r.username;
}
async function signIn(rpId) { const u = await signInWith(rpId, undefined); location.href = '/account'; return 'Signed in as ' + u + ' ✓ (signature verified by the server)'; }
async function conditional() {
  if (!window.PublicKeyCredential || !(await PublicKeyCredential.isConditionalMediationAvailable?.())) return out('Conditional passkey requests are not available here.');
  out('A conditional passkey request is pending. Choose Psss in the keyboard bar or AutoFill.');
  try { await signInWith('', 'conditional'); location.href = '/account'; } catch (e) { out(e.name === 'NotAllowedError' ? 'No passkey was chosen, so the request ended.' : 'Passkey request ended: ' + e.name + ' ' + e.message); }
}`;
}
