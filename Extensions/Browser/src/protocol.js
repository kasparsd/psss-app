// Messages between the extension and the native host. Version them: the host and the
// extension ship through different channels and will not always update together.
// The extension sends only an origin. It never sends a page URL path, query or form contents.
var PROTOCOL = Object.freeze({
  version: 3,
  host: 'app.psss.passwords',
  // Version 3 (2026-11-24): vaults carry a `state`; unlock-vault is new; save names its vault. Version 2 added field-aware search,
  // vaults and switch-vault.
  // Requests: ping, candidates { origin } -> { candidates: [{ ref, title, account, website, passkey }] },
  // credential { ref, origin, manual? },
  // search { origin, query, fields? } -> { results: [{ ref, title, account, website, matches, passkey, found, hit, hitRange }],
  //   counts: { name, website, username }, total }. `fields` is any of "name", "website", "username" (none: all three).
  // vaults -> { vaults: [{ id, name, location, active, state, reason? }] }, the current vault first. `state` is one of
  //   open | locked (Touch ID ready) | needs-password (with `reason`: off | changed | locked-out) | not-downloaded | not-found | unreadable.
  // switch-vault { vault } makes it the app's current vault (one per device; the open one locks) and does not unlock it -> { vaults }.
  // unlock-vault { vault } unlocks the current vault: Touch ID when ready (the prompt may close the popup), otherwise asks Psss to come
  //   forward on that vault's lock screen -> { vaults, app?: 'opened' }. Errors: cancelled, failed, needs-app, not-available (each with
  //   the new `vaults`), forbidden (not the current vault), not-found.
  // card-candidates { origin }, card { ref, origin } (sample cards in the prototype host).
  // generate, save { origin, vault, account, secret } -> { result: 'created' | 'updated', vault }. Saves into the current open vault only
  //   (forbidden for another one, locked or not-available when it is not open); an update changes only the password.
  // credential and card replies include a fields object keyed by canonical fill role.
  // `manual` marks a login the person chose for a site it was not saved for, after a warning.
  // Responses: { v, id, ok: true, ... } or { v, id, ok: false, error }.
  errors: Object.freeze({
    locked: 'locked',
    notFound: 'not-found',
    forbidden: 'forbidden',
    unsupported: 'unsupported',
    cancelled: 'cancelled',
    failed: 'failed',
    needsApp: 'needs-app',
    notAvailable: 'not-available'
  })
});
if (typeof module !== 'undefined') module.exports = { PROTOCOL };
