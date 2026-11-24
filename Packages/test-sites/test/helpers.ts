import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { request } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';
import { b64url } from '../src/webauthn.ts';

export type Response = { status: number; headers: Record<string, string | string[] | undefined>; body: string; json: any };

export async function listen(): Promise<{ server: Server; port: number; stop: () => Promise<void> }> {
  const server = createApp();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port, stop: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

/** A browser stand-in: sends a Host header of its choice and keeps the cookies of each host. */
export function browser(port: number) {
  const jars = new Map<string, Map<string, string>>();
  const send = (host: string, method: string, path: string, body?: string, type?: string): Promise<Response> => new Promise((resolve, reject) => {
    const jar = jars.get(host) ?? new Map<string, string>();
    jars.set(host, jar);
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `${host}:${port}`, ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': type ?? 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        for (const line of [res.headers['set-cookie'] ?? []].flat()) {
          const [pair] = line.split(';');
          const [k, v] = pair.split('=');
          if (/Max-Age=0/i.test(line) || !v) jar.delete(k); else jar.set(k, v);
        }
        let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = undefined; }
        resolve({ status: res.statusCode!, headers: res.headers, body: text, json: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
  return {
    get: (host: string, path: string) => send(host, 'GET', path),
    form: (host: string, path: string, fields: Record<string, string>) => send(host, 'POST', path, new URLSearchParams(fields).toString()),
    api: (host: string, path: string, value: unknown = {}) => send(host, 'POST', path, JSON.stringify(value), 'application/json'),
  };
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest();

/** A software authenticator: P-256 key, authenticator data with the flags and counter the server reads. */
export function authenticator(rpId: string, origin: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const credentialId = randomBytes(16);
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const counter = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  return {
    credentialId: b64url(credentialId),
    register(challenge: string, over: { rpId?: string; origin?: string } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: over.origin ?? origin }));
      const idLength = Buffer.alloc(2); idLength.writeUInt16BE(credentialId.length);
      const cose = Buffer.alloc(0);
      const authData = Buffer.concat([sha256(Buffer.from(over.rpId ?? rpId)), Buffer.from([0x45]), counter(0), Buffer.alloc(16), idLength, credentialId, cose]);
      return { id: b64url(credentialId), clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), publicKey: b64url(spki) };
    },
    assert(challenge: string, over: { rpId?: string; origin?: string; count?: number; flags?: number; type?: string; tamper?: boolean } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: over.type ?? 'webauthn.get', challenge, origin: over.origin ?? origin }));
      const authData = Buffer.concat([sha256(Buffer.from(over.rpId ?? rpId)), Buffer.from([over.flags ?? 0x05]), counter(over.count ?? 0)]);
      const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
      if (over.tamper) signature[signature.length - 1] ^= 1;
      return { id: b64url(credentialId), clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature), userHandle: null };
    },
    publicKey: spki,
  };
}
