# @psss/test-sites

Disposable local websites for trying AutoFill in Safari (simulator and Mac) and for scripted checks. Node 24, no dependencies, nothing leaves the computer. Plain passwords and secrets are shown on purpose.

```sh
cd Packages/test-sites
npm start            # or from the root: npm run start:sites (seeded); node src/server.ts --seed --port 8090 --host 127.0.0.1
```

`--seed` creates `alex@example.net` with the password `correct horse battery staple` on `localhost` and `accounts.example.localhost` (both with a verification code) and on `mail.example.localhost` (no code). The home page lists every account, its password, its code secret, and the code the server expects now.

## Sites

Every host name is a separate site with its own accounts, sessions and cookies. Any `*.localhost` name works: Safari and the simulator resolve it to this Mac, and `localhost` counts as a secure context, so passkeys work over plain http. The home page links `localhost`, `accounts.example.localhost`, `mail.example.localhost` and `shop.example.localhost` (a pair of siblings under `example.localhost` for the other-site cases).

| Page | What it tests |
| --- | --- |
| `/signup` | `new-password`, confirm field, `?rules=required: upper; minlength: 12;` sets `passwordrules`; the save sheet |
| `/login` | `username` and `current-password`, plus a conditional passkey request on load (`username webauthn`), the way Google asks |
| `/otp` | verification code after the password: `one-time-code` field; `?attr=none` removes the hint, as most sites do; `?hint=0` hides the expected code |
| `/account` | change password (current, new, confirm), turn on an authenticator with a chosen algorithm, digits and period, sign out, delete |
| `/passkeys` | create a passkey, sign in with one, optional relying party ID (`?rpId=example.localhost` for a parent) |

The server verifies what it receives, so a pass means the provider is right: the code must match the format (SHA1, SHA256 or SHA512, 6 to 8 digits, 30 or 60 seconds, one step of drift), and a passkey's challenge, origin, relying party hash, user presence and ES256 signature are checked. Each challenge works once. The home page ends with what the server saw.

A passkey can be added to an account that has a password only when you are signed in to it. A passkey-only account is created when the email is new.

## Scripts and agents

All JSON, scoped by the `Host` header (`curl -H 'Host: accounts.example.localhost:8090' ...`, or use the host name directly):

- `GET /api/state`: accounts, passwords, secrets, the current code, passkeys, the log.
- `POST /api/accounts` `{username, password, totp?: "BASE32" | secret?, digits?, period?, algorithm?}`: creates an account; with any code option it returns the `otpauth` URI.
- `GET /api/code?username=`: the code the server expects now, and the seconds left.
- `POST /api/reset`, or the buttons on the home page.

## Limits

- State is in memory. A restart forgets everything.
- No QR code yet: copy the secret or the `otpauth` URI.
- A real iPhone cannot resolve `*.localhost` and passkeys need HTTPS on a real domain, so passkeys are tried in the simulator and on the Mac. Password and code fields can be tried on a phone with `--host 0.0.0.0` and the Mac's address.
- The browser-extension end-to-end suites (`Extensions/Browser/tests`) start this server on port 8080 and open `/login.html` and `/signup.html`, kept as aliases of `/login` and `/signup`.

Tests: `scripts/test-sites.sh` (RFC 6238 vectors, WebAuthn verification with a software authenticator, form and script flows).
