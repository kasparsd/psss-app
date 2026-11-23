# Adding a verification code

Status: built. Mac, iOS and AutoFill extension builds and the codec tests pass, and QR decoding was checked on generated images. The sheet has not been run by hand on a device. The camera needs a second screen, so it was checked only for compile and availability handling.

How a person gets a website's TOTP secret into a login. Companion to [items](items.md) (the field) and [experience](experience.md) (screen 8, add item).

## First principle

Most people enrolling two-step verification are on the same phone that holds the vault. They cannot point a camera at their own screen.
The primary flow is therefore **copy, switch, paste**, not scan. The camera is the fallback for a second screen.

## Flows

| Situation | Flow |
|---|---|
| iPhone or iPad, site on the same device (primary) | On the site tap “Can’t scan?”, copy the setup key, return, tap **Paste**. Or take a screenshot, tap its preview, choose Copy and Delete, then **Paste**. Fallback: **Choose photo** (screenshots first, no photo-library permission) |
| iPhone or iPad, QR on another screen | **Scan with camera** (VisionKit, on device, camera asked only on tap) |
| iPad in Split View | Drag the QR image from Safari onto the sheet, or the flows above |
| Mac | **Paste** (⌘V; a ⇧⌃⌘4 screenshot goes to the clipboard), **Choose image…**, or drop an image. No screen capture: it would need Screen Recording permission |

Everything is decoded on the device. Nothing is uploaded and the image is never stored.

## Rules

- One sheet, one primary button. The system **Paste** control is primary (it reads text or an image with no “Allow Paste” prompt). iOS adds “Scan with camera” and “Choose photo”; Mac adds “Choose image…”. A typed setup key stays in the editor row.
- **Save code saves to the vault at once**, even from a new login still being edited. The person leaves the app to type the code into the site, and a draft would be lost if the vault locks. The secret is never shown.
- The confirm step shows issuer, account and a **live code** (the site will not enable two-step verification until the person types a valid one). Digits and period appear only when they are not 6 and 30 s.
- The whole `otpauth://` link is kept (digits, period, algorithm), not just the secret. Anything that cannot make a correct code is refused with nothing saved.
- The delete-the-screenshot reminder shows only when the source was a picked image, as one line on the saved state.
- Replacing an existing code asks first.

## Copy

- Row: “Verification code (optional)”, button “Add code”, then “Replace code” and “Remove code”.
- Sheet title “Add verification code”. Text: “Copy the setup key or QR code from the site. Psss reads it on this device. Nothing is uploaded.”
- Same-device hint: “On this phone? On the site, tap “Can’t scan?”, copy the key, then tap Paste. Or take a screenshot, tap it, choose Copy and Delete, then tap Paste.”
- Confirm: “Type this code into the site to finish turning on two-step verification.” Buttons “Save code”, “Cancel”.
- Errors: nothing to paste, no QR found, QR is a web link, invalid key, unsupported type, Google Authenticator batch (not built), camera denied. Each names the fix. Wording lives in `VerificationCodeSheet`.

## Copying a code: the Codes view

Approved 2026-11-23. Codes, one of the three places (a tab on iPhone and iPad, the toolbar control on Mac), lists every login with a code, live, so a code is copied without opening the login. Details and copy are in [experience](experience.md#places-all-codes-cards-approved-2026-11-23).

## Deferred, in order

1. The `otpauth://` URL scheme, so a site’s tap-to-open link opens the app. Needs unlock, then pick a login. Never auto-save from a URL.
2. The global Add field accepting a pasted link and asking which login.
3. A Share extension for images and text (new target, second writer to the vault file).
4. Google Authenticator `otpauth-migration://` batches.
5. AutoFill extension saving a seed after sign-up. No known iOS API; verify before promising.

## Known gaps

- Typing a different bare setup key over a login that has non-default digits or period keeps the old parameters. Paste the full link to change them.
- Cancelling the editor after “Save code” keeps a new login that was stored early.
