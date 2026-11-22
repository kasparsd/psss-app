// Messages between the extension and the native host. Version them: the host and the
// extension ship through different channels and will not always update together.
// The extension sends only an origin. It never sends a page URL path, query or form contents.
var PROTOCOL = Object.freeze({
  version: 1,
  host: 'app.psss.passwords',
  // Requests: ping, candidates { origin }, search { origin, query }, credential { ref, origin, manual? },
  // generate, save { origin, account, secret } -> { result: 'created' | 'updated' }.
  // `manual` marks a login the person chose for a site it was not saved for, after a warning.
  // Responses: { v, id, ok: true, ... } or { v, id, ok: false, error }.
  errors: Object.freeze({
    locked: 'locked',
    notFound: 'not-found',
    forbidden: 'forbidden',
    unsupported: 'unsupported'
  })
});
if (typeof module !== 'undefined') module.exports = { PROTOCOL };
