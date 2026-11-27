import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { site, record, resetHost, resetAll, knownHosts } from './state.ts';
import { fillCases } from './fill-cases.ts';
import type { Account } from './state.ts';
import * as pages from './pages.ts';
import * as totpLib from './totp.ts';
import { b64url, verifyAssertion, verifyRegistration } from './webauthn.ts';

/**
 * Disposable websites for trying AutoFill. One port, and every host name is a separate site with its own accounts, so
 * accounts.example.localhost and mail.example.localhost can be signed in to at once. Passwords and secrets are plain on
 * purpose. Run with `npm start` in Packages/test-sites, see README.md.
 */

const DEFAULT_HOSTS = ['localhost', 'accounts.example.localhost', 'mail.example.localhost', 'shop.example.localhost'];

type Reply = { status?: number; type?: string; body?: string; headers?: Record<string, string | string[]> };
const html = (body: string, status = 200): Reply => ({ status, type: 'text/html; charset=utf-8', body });
const json = (value: unknown, status = 200): Reply => ({ status, type: 'application/json', body: JSON.stringify(value) });
const redirect = (to: string, headers: Record<string, string | string[]> = {}): Reply => ({ status: 303, headers: { location: to, ...headers } });

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  return req.headers.cookie?.split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
}

export function seed(): void {
  const user = 'alex@example.net';
  const password = 'correct horse battery staple';
  const add = (host: string, secret?: string) => {
    site(host).accounts.set(user, { username: user, password, passkeys: [], userHandle: b64url(randomBytes(16)),
      totp: secret ? totpLib.parseOptions({ secret }) : undefined });
  };
  add('localhost', 'JBSWY3DPEHPK3PXP');
  add('accounts.example.localhost', 'GEZDGNBVGY3TQOJQ');
  add('mail.example.localhost');
}

export function createApp(): Server {
  return createServer(async (req, res) => {
    try {
      reply(res, await route(req));
    } catch (error) {
      reply(res, json({ error: String((error as Error).message ?? error) }, 400));
    }
  });
}

function reply(res: ServerResponse, r: Reply): void {
  const body = r.body ?? '';
  res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'text/plain', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', ...r.headers });
  res.end(body);
}

async function route(req: IncomingMessage): Promise<Reply> {
  const hostHeader = req.headers.host ?? 'localhost';
  const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
  const port = hostHeader.match(/:(\d+)$/)?.[1] ?? '80';
  const url = new URL(req.url ?? '/', `http://${hostHeader}`);
  // The browser-extension end-to-end suites open these two older addresses.
  const path = ({ '/login.html': '/login', '/signup.html': '/signup' } as Record<string, string>)[url.pathname] ?? url.pathname;
  const method = req.method ?? 'GET';
  const state = site(host);

  const form = method === 'POST' && !path.startsWith('/api/') ? new URLSearchParams(await readBody(req)) : new URLSearchParams();
  const body = method === 'POST' && path.startsWith('/api/') ? await readBody(req) : '';
  const data: Record<string, any> = body ? JSON.parse(body) : {};

  const sid = cookie(req, 'sid');
  const session = sid ? state.sessions.get(sid) : undefined;
  const signedIn: Account | undefined = session?.stage === 'full' ? state.accounts.get(session.username) : undefined;
  const ctx = (): pages.Ctx => ({ host, port, site: state, account: signedIn, known: knownHosts() });
  const start = (username: string, stage: 'otp' | 'full'): string => {
    const id = sid && session ? sid : randomBytes(16).toString('hex');
    state.sessions.set(id, { username, stage });
    return `sid=${id}; Path=/; HttpOnly; SameSite=Lax`;
  };
  const log = (line: string) => record(host, line);

  if (path === '/favicon.ico') return { status: 204 };

  // ---- Pages
  if (method === 'GET' && path === '/') return html(pages.home(ctx(), [...new Set([...DEFAULT_HOSTS, ...knownHosts()])]));
  if (method === 'GET' && path === '/signup') return html(pages.signup(ctx(), url.searchParams));
  if (method === 'POST' && path === '/signup') {
    const username = (form.get('username') ?? '').trim();
    const password = form.get('password') ?? '';
    if (!username || password.length < 8) return html(pages.signup(ctx(), url.searchParams, 'Enter an email and a password of at least 8 characters.'), 400);
    if (form.has('confirm') && form.get('confirm') !== password) return html(pages.signup(ctx(), url.searchParams, 'The passwords do not match.'), 400);
    if (state.accounts.has(username)) return html(pages.signup(ctx(), url.searchParams, 'That email already has an account here.'), 409);
    state.accounts.set(username, { username, password, passkeys: [], userHandle: b64url(randomBytes(16)) });
    log(`sign-up ${username}, password length ${password.length}`);
    return redirect('/account', { 'set-cookie': start(username, 'full') });
  }
  if (method === 'GET' && path === '/login') return html(pages.login(ctx()));
  if (method === 'POST' && path === '/login') {
    const username = (form.get('username') ?? '').trim();
    const found = state.accounts.get(username);
    if (!found || !found.password || found.password !== form.get('password')) {
      log(`sign-in refused for ${username || '(empty)'}`);
      return html(pages.login(ctx(), 'Wrong email or password.'), 401);
    }
    log(`password accepted for ${username}${found.totp ? ', code required' : ''}`);
    return found.totp
      ? redirect('/otp', { 'set-cookie': start(username, 'otp') })
      : redirect('/account', { 'set-cookie': start(username, 'full') });
  }
  if (path === '/otp') {
    const pending = session?.stage === 'otp' ? state.accounts.get(session.username) : undefined;
    if (!pending?.totp) return redirect('/login');
    if (method === 'GET') return html(pages.otp(ctx(), pending, url.searchParams));
    if (method === 'POST') {
      const typed = form.get('code') ?? '';
      if (totpLib.verify(pending.totp, typed)) {
        log(`code accepted for ${pending.username}`);
        return redirect('/account', { 'set-cookie': start(pending.username, 'full') });
      }
      log(`code refused for ${pending.username}: typed ${JSON.stringify(typed)}, expected ${totpLib.code(pending.totp)}`);
      return html(pages.otp(ctx(), pending, url.searchParams, 'That code is not right.'), 401);
    }
  }
  if (path === '/account' || path.startsWith('/account/')) {
    if (!signedIn) return redirect('/login');
    const message = url.searchParams.get('message') ?? '';
    if (method === 'GET' && path === '/account') {
      // The secret waiting to be confirmed stays the same until it is turned on, so a failed attempt can be retried with it.
      const pending = (session!.pendingSecret ??= totpLib.randomSecret());
      return html(pages.account(ctx(), signedIn, { secret: pending, query: url.searchParams }, message));
    }
    if (method === 'POST' && path === '/account/password') {
      if (form.get('current') !== signedIn.password) { log(`password change refused for ${signedIn.username}: current password is wrong`); }
      if (form.get('current') !== signedIn.password) return redirect('/account?message=' + encodeURIComponent('The current password is not right.'));
      const next = form.get('password') ?? '';
      if (next.length < 8 || next !== form.get('confirm')) log(`password change refused for ${signedIn.username}: new passwords differ or are too short`);
      if (next.length < 8 || next !== form.get('confirm')) return redirect('/account?message=' + encodeURIComponent('The new passwords differ or are too short.'));
      signedIn.password = next;
      log(`password changed for ${signedIn.username}, new length ${next.length}`);
      return redirect('/account?message=' + encodeURIComponent('Password changed.'));
    }
    if (method === 'POST' && path === '/account/otp') {
      const options = totpLib.parseOptions({ secret: form.get('secret') ?? '', digits: form.get('digits'), period: form.get('period'), algorithm: form.get('algorithm') });
      if (!totpLib.verify(options, form.get('code') ?? '')) return redirect('/account?message=' + encodeURIComponent('That code is not right, so the authenticator was not turned on.'));
      signedIn.totp = options;
      session!.pendingSecret = undefined;
      log(`authenticator on for ${signedIn.username}: ${pages.totpSummary(options)}`);
      return redirect('/account?message=' + encodeURIComponent('Authenticator turned on.'));
    }
    if (method === 'POST' && path === '/account/otp/remove') { signedIn.totp = undefined; return redirect('/account'); }
    if (method === 'POST' && path === '/account/delete') {
      state.accounts.delete(signedIn.username);
      log(`account deleted ${signedIn.username}`);
      return redirect('/', { 'set-cookie': 'sid=; Path=/; Max-Age=0' });
    }
  }
  if (method === 'POST' && path === '/logout') { if (sid) state.sessions.delete(sid); return redirect('/login', { 'set-cookie': 'sid=; Path=/; Max-Age=0' }); }
  if (method === 'GET' && path === '/passkeys') return html(pages.passkeys(ctx(), url.searchParams));
  if (method === 'GET' && path === '/checkout') return html(pages.checkout(ctx(), url.searchParams));
  if (method === 'GET' && path === '/delivery') return html(pages.delivery(ctx(), url.searchParams));
  if (method === 'GET' && path === '/checkout-frame') return html(pages.checkoutFrame(ctx()));
  if (method === 'GET' && path === '/payment-frame') return html(pages.paymentFrame(ctx(), url.searchParams));
  if (method === 'GET' && path === '/checkout-hostile') return html(pages.checkoutHostile(ctx()));
  if (method === 'GET' && path === '/fill-case') {
    // Bare pages: the case's own markup and styles decide what shows.
    const found = fillCases.find((item) => item.name === url.searchParams.get('name'));
    if (found) return html(`<!doctype html><meta charset="utf-8">${found.html}`);
  }
  if (method === 'POST' && path === '/reset') { resetHost(host); return redirect('/'); }
  if (method === 'POST' && path === '/reset-all') { resetAll(); return redirect('/'); }

  // ---- Scripts
  if (method === 'GET' && path === '/api/state') {
    return json({ host, accounts: [...state.accounts.values()].map((a) => ({
      username: a.username, password: a.password, totp: a.totp ?? null, code: a.totp ? totpLib.code(a.totp) : null,
      passkeys: a.passkeys.map((p) => ({ id: p.id, rpId: p.rpId, signCount: p.signCount })) })), log: state.log });
  }
  if (method === 'POST' && path === '/api/reset') { resetHost(host); return json({ ok: true }); }
  if (method === 'POST' && path === '/api/accounts') {
    if (!data.username) throw new Error('username is required');
    const totp = data.totp || data.secret || data.digits || data.period || data.algorithm
      ? totpLib.parseOptions({ secret: typeof data.totp === 'string' ? data.totp : data.secret, digits: data.digits, period: data.period, algorithm: data.algorithm })
      : undefined;
    state.accounts.set(data.username, { username: data.username, password: data.password ?? '', totp, passkeys: [], userHandle: b64url(randomBytes(16)) });
    log(`account created by script: ${data.username}`);
    return json({ ok: true, totp: totp ?? null, otpauth: totp ? totpLib.otpauthURI(totp, host, data.username) : null }, 201);
  }
  if (method === 'GET' && path === '/api/code') {
    const found = state.accounts.get(url.searchParams.get('username') ?? '');
    if (!found?.totp) throw new Error('no authenticator for that user on this host');
    return json({ code: totpLib.code(found.totp), secondsLeft: totpLib.secondsLeft(found.totp) });
  }

  // ---- Passkeys
  if (method === 'POST' && path === '/api/webauthn/register/options') {
    const username = String(data.username ?? '').trim();
    if (!username) throw new Error('username is required');
    const rpId = chooseRpId(host, data.rpId);
    let target = state.accounts.get(username);
    if (target?.password && target.username !== signedIn?.username) throw new Error('that account has a password: sign in first, then create a passkey');
    if (!target) {
      target = { username, password: '', passkeys: [], userHandle: b64url(randomBytes(16)) };
      state.accounts.set(username, target);
      log(`passkey-only account created for ${username}`);
    }
    const challenge = b64url(randomBytes(32));
    state.challenges.set(challenge, { kind: 'create', rpId, username, expires: Date.now() + 120_000 });
    return json({ challenge, rp: { id: rpId, name: host }, user: { id: target.userHandle, name: username, displayName: username },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } });
  }
  if (method === 'POST' && path === '/api/webauthn/register/verify') {
    const issued = takeChallenge(state, data.challenge, 'create');
    try {
      const result = verifyRegistration({ ...data, origin: `http://${hostHeader}`, rpId: issued.rpId });
      const target = state.accounts.get(issued.username!)!;
      target.passkeys.push({ id: result.id, publicKey: result.publicKey, signCount: result.signCount, rpId: issued.rpId, created: Date.now() });
      log(`passkey registered for ${target.username} on ${issued.rpId}, credential ${result.id.slice(0, 12)}...`);
      return json({ ok: true });
    } catch (error) {
      log(`passkey registration refused: ${(error as Error).message}`);
      return json({ error: (error as Error).message }, 400);
    }
  }
  if (method === 'POST' && path === '/api/webauthn/login/options') {
    const rpId = chooseRpId(host, data.rpId);
    const challenge = b64url(randomBytes(32));
    state.challenges.set(challenge, { kind: 'get', rpId, expires: Date.now() + 120_000 });
    // A second step names the credentials it accepts: the account's own, or one that no provider here holds (a security key).
    let allow: string[] | undefined;
    if (data.allow === 'elsewhere') allow = [b64url(randomBytes(16))];
    if (data.allow === 'account') {
      allow = (state.accounts.get(String(data.username ?? '').trim())?.passkeys ?? []).filter((p) => p.rpId === rpId).map((p) => p.id);
      if (!allow.length) throw new Error('that account has no passkey for this relying party: create one first');
    }
    return json({ challenge, rpId, allowCredentials: allow?.map((id) => ({ type: 'public-key', id })) });
  }
  if (method === 'POST' && path === '/api/webauthn/login/verify') {
    const issued = takeChallenge(state, data.challenge, 'get');
    const owner = [...state.accounts.values()].find((a) => a.passkeys.some((p) => p.id === data.id));
    const passkey = owner?.passkeys.find((p) => p.id === data.id);
    if (!owner || !passkey) { log(`passkey sign-in refused: unknown credential ${String(data.id).slice(0, 12)}...`); return json({ error: 'this site does not know that passkey' }, 401); }
    if (passkey.rpId !== issued.rpId) return json({ error: `the passkey belongs to ${passkey.rpId}, not ${issued.rpId}` }, 401);
    try {
      const result = verifyAssertion({ ...data, origin: `http://${hostHeader}`, rpId: issued.rpId, publicKey: passkey.publicKey, storedSignCount: passkey.signCount });
      passkey.signCount = result.signCount;
      log(`passkey sign-in accepted for ${owner.username} on ${issued.rpId}`);
      return { ...json({ ok: true, username: owner.username }), headers: { 'set-cookie': start(owner.username, 'full') } };
    } catch (error) {
      log(`passkey sign-in refused: ${(error as Error).message}`);
      return json({ error: (error as Error).message }, 401);
    }
  }

  return html(pages.layout(ctx(), 'Not found', '<p>No such page.</p>'), 404);
}

function chooseRpId(host: string, requested: unknown): string {
  const rpId = String(requested ?? '').trim().toLowerCase();
  if (!rpId || rpId === host) return host;
  if (!host.endsWith(`.${rpId}`)) throw new Error(`${rpId} is not this host or one of its parents`);
  return rpId;
}

function takeChallenge(state: ReturnType<typeof site>, challenge: unknown, kind: 'create' | 'get') {
  const issued = state.challenges.get(String(challenge));
  state.challenges.delete(String(challenge));
  if (!issued || issued.kind !== kind || issued.expires < Date.now()) throw new Error('that challenge was not issued, was used already or has expired');
  return issued;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const port = Number(option('--port', '8090'));
  const bind = option('--host', '127.0.0.1');
  if (args.includes('--seed')) seed();
  createApp().listen(port, bind, () => {
    console.log(`Test sites on http://localhost:${port}  (bound to ${bind})`);
    for (const h of DEFAULT_HOSTS) console.log(`  http://${h}:${port}/`);
    if (args.includes('--seed')) console.log('Seeded alex@example.net / "correct horse battery staple" (localhost and accounts.example.localhost have a code).');
  });
}
