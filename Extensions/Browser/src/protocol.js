// Messages between the extension and the native host. Version them: the host and the
// extension ship through different channels and will not always update together.
// The extension sends only an origin. It never sends a page URL path, query or form contents.
var PROTOCOL = Object.freeze({
  version: 5,
  host: 'app.psss.passwords',
  // Version 5 (2026-11-25): the host relays to the running Psss app. New errors: not-running (nothing is listening: Psss is not open),
  // not-verified (the app, or the host, could not be shown to be ours), timeout and busy (the relay's limits). `ping` carries
  // `app: true` when the app answered. Otherwise as 4.
  // Version 4 (2026-11-25): several vaults can be open at once. candidates, search, credential, card-candidates and card carry the `vault`
  // they read (any open vault; a locked one answers `locked`, an unknown one `not-found`, never another vault's data), and save writes
  // into any open vault. `active` in vaults is the vault the app shows: only the popup's default.
  // Version 3 (2026-11-24): vaults carry a `state`; unlock-vault is new; save names its vault. Version 2 added field-aware search,
  // vaults and switch-vault.
  // Requests: ping, candidates { origin, vault } -> { candidates: [{ ref, title, account, website, passkey }] },
  // credential { ref, origin, vault, manual? },
  // search { origin, query, fields?, vault } -> { results: [{ ref, title, account, website, matches, passkey, found, hit, hitRange }],
  //   counts: { name, website, username }, total }. `fields` is any of "name", "website", "username" (none: all three).
  // vaults -> { vaults: [{ id, name, location, active, state, reason? }] } in the fixed order (never reordered). `state` is one of
  //   open | locked (Touch ID ready) | needs-password (with `reason`: off | changed | locked-out) | not-downloaded | not-found | unreadable.
  // switch-vault { vault } makes it the vault the app shows. Nothing locks and nothing unlocks -> { vaults }.
  // unlock-vault { vault } unlocks the current vault: Touch ID when ready (the prompt may close the popup), otherwise asks Psss to come
  //   forward on that vault's lock screen -> { vaults, app?: 'opened' }. Errors: cancelled, failed, needs-app, not-available (each with
  //   the new `vaults`), forbidden (not the current vault), not-found.
  // card-candidates { origin, vault }, card { ref, origin, vault } (sample cards in the prototype host).
  // generate, save { origin, vault, account, secret } -> { result: 'created' | 'updated', vault }. Saves into the named open vault
  //   (locked or not-available when it is not open, not-found when unknown); an update changes only the password.
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
    notAvailable: 'not-available',
    notRunning: 'not-running',
    notVerified: 'not-verified',
    timeout: 'timeout',
    busy: 'busy'
  })
});
if (typeof module !== 'undefined') module.exports = { PROTOCOL };
