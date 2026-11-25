// How the popup groups logins, kept pure so it is tested (the AutoFill sheet groups the same way, in App/Core/ResultGroups.swift).
//  - "For This Site": the login's website matches the page's site (the host says so, `matches`).
//  - "Other Matches": found by name, username or a search, but saved for another site or with no website. Each such row keeps a
//    second line, "Saved for <site>" or "No website": with the group's heading it is the check against a lookalike site.
// Every value from a vault goes through Display.line first, and is used with textContent only.
var Groups = (function () {
  const display = typeof Display !== 'undefined' ? Display : require('./display.js').Display;

  // Splits rows into the two groups, keeping the order the host gave them. An empty group is an empty array: the caller leaves it out.
  function split(rows) {
    return { site: rows.filter((r) => r.matches === true), other: rows.filter((r) => r.matches !== true) };
  }

  // The site words of an Other Matches row: the saved site made safe and cut to 80 characters, or nothing when it has none.
  function savedSite(row) {
    return display.line(row.website, 80);
  }

  // "Saved for gitforge.example" or "No website".
  function savedFor(row) {
    const site = savedSite(row);
    return site ? `Saved for ${site}` : 'No website';
  }

  return { split, savedSite, savedFor };
})();
if (typeof module !== 'undefined') module.exports = { Groups };
