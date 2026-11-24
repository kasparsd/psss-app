# Adding a verification code

Status: built; the first screen was redrawn 2026-11-24 (see “The first screen”) and has not been run by hand on a device. Mac, iOS and AutoFill extension builds and the codec tests pass, and QR decoding was checked on generated images. The sheet has not been run by hand on a device. The camera needs a second screen, so it was checked only for compile and availability handling.

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

On iPhone, iPad and Mac, editing or adding a login shows a system **Paste** button on its own row below **Setup key**, labelled “From QR code in screenshot” with the button at its trailing end, when the clipboard has an image. Psss checks only the clipboard type until the person presses Paste. A valid QR code opens the existing preview with a live code. An unrelated or unreadable image opens the same sheet with an explanation and the usual ways to try again. Cancel leaves the login as it was. **Save code** or **Replace code** applies the code to the login.

## The first screen

Approved 2026-11-24, mock “Verification code setup” (`Design/Mocks/app`, #/code-setup), which also lists the workflows and the options not chosen. One card of rows: **Screenshot or key** with the system **Paste** control at its end (it keeps its own label, takes text or an image and needs no “Allow Paste” prompt), then **Scan with camera** and **Choose photo** (iOS), or **Choose image…** (Mac). One help block under the card, which a problem replaces: “Take a screenshot of the QR code, then paste it or pick it from your photos. Or copy the setup key from the site and paste that.” (Mac: with ⇧⌃⌘4, ⌘V and drop). No “Nothing is uploaded.” line on this screen; the confirm step says the code is saved in the vault on this device. The confirm step has no second Cancel for a new code; a replacement keeps “Keep current code”.

## Rules

- One sheet, one card of equal rows. The system **Paste** control sits in the first row (it reads text or an image with no “Allow Paste” prompt). iOS adds “Scan with camera” and “Choose photo”; Mac adds “Choose image…”. A typed setup key stays in the editor row; the editor's Paste button is the same control, offered only for an image.
- **Save code saves to the vault at once**, even from a new login still being edited. The person leaves the app to type the code into the site, and a draft would be lost if the vault locks. The secret is never shown.
- The confirm step shows issuer, account and a **live code** (the site will not enable two-step verification until the person types a valid one). Digits and period appear only when they are not 6 and 30 s.
- The whole `otpauth://` link is kept (digits, period, algorithm), not just the secret. Anything that cannot make a correct code is refused with nothing saved.
- The delete-the-screenshot reminder shows only when the source was a picked image, as one line on the saved state.
- Replacing an existing code asks first.

## Copy

- Row: “Setup key (optional)” under the “Verification code” heading, button “Add code”, then “Replace code” and “Remove code”.
- Sheet title “Add verification code”. 
- Help under the card: see “The first screen”.
- Confirm: “Type this code into the site to finish turning on two-step verification.” Buttons “Save code”, “Cancel”.
- Errors: nothing to paste, no QR found, QR is a web link, invalid key, unsupported type, Google Authenticator batch (not built), camera denied. Each names the fix. Wording lives in `VerificationCodeSheet`.

## Copying a code: the Codes view

Approved 2026-11-23. Codes, one of the three places (a tab on iPhone and iPad, the toolbar control on Mac), lists every login with a code, live, so a code is copied without opening the login. Details and copy are in [experience](experience.md#places-all-codes-cards-approved-2026-11-23).

There is no countdown on the list (removed at the owner's request, 2026-11-23: a distraction). The code button changes by itself every second; the login's page keeps the countdown ring.

A login whose setup key cannot make a code (a bad secret, an `otpauth://` link that does not parse) stays in the list like any other but its row has no code button and no message, warning or icon (owner, 2026-11-23): the list stays quiet. Tapping the row opens the login, and only there does the code row explain it, in plain words: “Psss can't make a code from this setup key. Replace it with a new key from the website.” with a labeled “Replace Code…” button that turns the page into the editor at the code step. Same on iPhone, iPad and Mac.

## Opening a site’s setup link

Built 2026-11-24, mock `#/code-setup` section 7; not yet run by hand on a device. `App-Info.plist` registers the `otpauth` URL scheme, which is what lists Psss under Settings, Passwords, Verification Codes, **Set Up Codes In** (the AutoFill list, “AutoFill from”, is a separate setting and already lists Psss).

- The link only queues (`IncomingCodeRequests`, owned by the app). A locked vault, or no window yet, keeps it waiting; locking drops it and the secret it holds.
- The unlocked vault shows `IncomingCodeSheet` once no other sheet is open: the code found, **New login for {issuer}**, then **Likely** logins (name or site holds the issuer, `IncomingCodeMatch`) and the others, with search. Choosing a login saves nothing; the same confirm step as Add verification code does (live code, **Save code** or **Replace code**).
- **New login** opens the editor on an unsaved login holding the code. Cancelling it leaves the vault as it was.
- A link that is not a code Psss can make (`hotp`, a bad key, a web link) says why in the paste flow’s words and saves nothing. The Mac opens links in the existing window.
- iOS has no way to read which app is chosen for Set Up Codes In, and no link to that picker, so Setup shows a standing line under “Verification codes” (iPhone and iPad) instead of a status or a nag. The Mac has no such picker.

## Deferred, in order

1. The global Add field accepting a pasted link and asking which login.
2. A Share extension for images and text (new target, second writer to the vault file).
3. Google Authenticator `otpauth-migration://` batches.
4. AutoFill extension saving a seed after sign-up. No known iOS API; verify before promising.

## Known gaps

- Typing a different bare setup key over a login that has non-default digits or period keeps the old parameters. Paste the full link to change them.
- Cancelling the editor (the new-item sheet, or an item's page in edit mode) after “Save code” keeps the code that was stored early.
