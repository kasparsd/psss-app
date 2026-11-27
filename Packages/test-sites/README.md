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
| `/passkeys` | create a passkey, sign in with one, optional relying party ID (`?rpId=example.localhost` for a parent); two second-step buttons that name the accepted passkeys, the account’s own or one saved elsewhere (`allowCredentials`) |

The server verifies what it receives, so a pass means the provider is right: the code must match the format (SHA1, SHA256 or SHA512, 6 to 8 digits, 30 or 60 seconds, one step of drift), and a passkey's challenge, origin, relying party hash, user presence and ES256 signature are checked. Each challenge works once. The home page ends with what the server saw.

Card and address pages (fictional, nothing is submitted). They start empty; a page-load marker and an “Order note” field show whether the page kept its state.

| Page | What it tests |
| --- | --- |
| `/checkout` | `cc-name`, `cc-number`, `cc-exp`, `cc-csc`; `?expiry=select` for month and year lists, `?address=billing` for a billing address above the card, `?number=short` for a number box too short to fill, `?second=hidden` for a second card form that is not shown yet, page scripts that change filled fields (see below), `?form=none` for fields without a form |
| `/delivery` | shipping address with region and country lists; `?name=split`, `?street=lines` or `?street=box`, `?billing=1` for a billing address first, `?tel=short` for a phone box too short to fill, `?street2=short` for a second street box too short to fill, `?second=1` (or `hidden`) for a second address form, the same page scripts as `/checkout`, `?form=none` |
| `/checkout-frame` | card fields in a `/payment-frame` from `pay.example.localhost` |
| `/checkout-hostile` | hidden, transparent, off-screen, tiny, clipped, inert, disabled and read-only card number traps beside one visible set |
| `/fill-case?name=` | one bare page per way of hiding, misplacing or reshaping a field (`src/fill-cases.ts`), run by `Extensions/Browser/tests/playwright/page-fill.spec.mjs` |

Page scripts on `/checkout` and `/delivery`, for checking what a filler reports. Each takes `trigger:what` and runs when the trigger field changes. `?clear=`, `?remove=`, `?hide=`, `?show=` and `?move=` (out of the form) take ids; `?replace=` and `?rerender=` swap in empty copies or copies that keep the value; `?strip=` swaps in bare inputs that hold the value and have no attribute; `?set=` writes a town into fields, as a postal code lookup does. `?format=id:how` rewrites a field on its own change: `dots` groups it in fours, `cut` keeps 12 characters, `stuck` keeps 12 and puts them back when emptied, `short` masks all but the ends, `plain` drops accents, `national` and `prefix` rewrite a phone number, `noprefix` drops `LV-`, `expand` spells out a street. `?split=id:drop` (or `:keep`, leaving the first four) spreads a number over four new boxes. Examples: `/checkout?clear=csc:exp`, `/checkout?second=hidden&show=csc:second&hide=csc:first`, `/delivery?second=1&hide=tel:first`.

The iPhone Safari popup is tested against these pages by `Extensions/Browser/tests/playwright/safari-popup.spec.mjs`. Safari only runs card and address fill on HTTPS pages, and this server speaks plain HTTP: for a simulator run put a TLS proxy with a throwaway certificate in front of it.

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
