// Which pages may receive a credential. Conservative on purpose: one top-level origin, no
// frames, HTTPS only, with plain HTTP allowed for localhost so developers can test.
// The page's own claims are never consulted. The caller passes the URL the browser reports.
var OriginPolicy = (function () {
  const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

  function parse(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    const secure = u.protocol === 'https:';
    const local = u.protocol === 'http:' && LOCAL.has(u.hostname);
    if (!secure && !local) return null;
    if (u.username || u.password) return null; // https://paypal.com@evil.example/
    return { origin: u.origin, host: u.hostname, secure };
  }

  /** Returns the origin to use for a tab URL, or null when filling must be refused. */
  function fillableOrigin(tabUrl) {
    const p = parse(tabUrl);
    return p ? p.origin : null;
  }

  /** True when a navigation happened between listing candidates and filling. */
  function sameOrigin(a, b) {
    const pa = parse(a), pb = parse(b);
    return !!pa && !!pb && pa.origin === pb.origin;
  }

  return { fillableOrigin, sameOrigin };
})();
if (typeof module !== 'undefined') module.exports = { OriginPolicy };
