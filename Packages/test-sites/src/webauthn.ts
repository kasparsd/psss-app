import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

/** What the server checks on a passkey, in the order the specification lists it. Only ES256 (alg -7) with attestation "none". */

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromB64url(text: string): Buffer {
  return Buffer.from(text, 'base64url');
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest();

type AuthData = { rpIdHash: Buffer; flags: number; signCount: number; credentialId?: Buffer };

export function parseAuthenticatorData(data: Buffer): AuthData {
  if (data.length < 37) throw new Error('authenticator data is shorter than 37 bytes');
  const flags = data[32];
  const parsed: AuthData = { rpIdHash: data.subarray(0, 32), flags, signCount: data.readUInt32BE(33) };
  if (flags & 0x40) {
    if (data.length < 55) throw new Error('attested credential data is cut short');
    const length = data.readUInt16BE(53);
    parsed.credentialId = data.subarray(55, 55 + length);
  }
  return parsed;
}

function checkClientData(clientDataJSON: Buffer, type: string, challenge: string, origin: string): void {
  const clientData = JSON.parse(clientDataJSON.toString('utf8'));
  if (clientData.type !== type) throw new Error(`clientData type is ${clientData.type}, expected ${type}`);
  if (clientData.challenge !== challenge) throw new Error('challenge does not match the one issued');
  if (clientData.origin !== origin) throw new Error(`origin is ${clientData.origin}, expected ${origin}`);
}

function checkAuthData(authData: AuthData, rpId: string): void {
  if (!authData.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw new Error(`rpIdHash is not the hash of ${rpId}`);
  if (!(authData.flags & 0x01)) throw new Error('user presence flag is not set');
}

export type Registration = { id: string; publicKey: Buffer; signCount: number };

export function verifyRegistration(input: {
  id: string; clientDataJSON: string; authenticatorData: string; publicKey: string; challenge: string; origin: string; rpId: string;
}): Registration {
  checkClientData(fromB64url(input.clientDataJSON), 'webauthn.create', input.challenge, input.origin);
  const authData = parseAuthenticatorData(fromB64url(input.authenticatorData));
  checkAuthData(authData, input.rpId);
  if (authData.credentialId && b64url(authData.credentialId) !== input.id) throw new Error('credential ID in the authenticator data differs from the one sent');
  const publicKey = fromB64url(input.publicKey);
  const key = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('public key is not P-256');
  return { id: input.id, publicKey, signCount: authData.signCount };
}

export function verifyAssertion(input: {
  clientDataJSON: string; authenticatorData: string; signature: string; challenge: string; origin: string; rpId: string;
  publicKey: Buffer; storedSignCount: number;
}): { signCount: number } {
  const clientDataJSON = fromB64url(input.clientDataJSON);
  checkClientData(clientDataJSON, 'webauthn.get', input.challenge, input.origin);
  const authenticatorData = fromB64url(input.authenticatorData);
  const authData = parseAuthenticatorData(authenticatorData);
  checkAuthData(authData, input.rpId);
  const key = createPublicKey({ key: input.publicKey, format: 'der', type: 'spki' });
  const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  if (!verifySignature('sha256', signed, key, fromB64url(input.signature))) throw new Error('signature is not valid');
  // A counter that stays at zero means the authenticator keeps none (synced passkeys). Otherwise it must go up.
  if ((authData.signCount !== 0 || input.storedSignCount !== 0) && authData.signCount <= input.storedSignCount) {
    throw new Error(`sign count ${authData.signCount} did not increase from ${input.storedSignCount}`);
  }
  return { signCount: authData.signCount };
}
