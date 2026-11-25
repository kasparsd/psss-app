// What the popup shows about vaults, kept pure so it is tested: the pick list, which vault is chosen and the notice a vault that
// cannot list logins gets. Several vaults can be open at once; the popup fills from the one chosen here, not from "the current one".
// Every name goes through Display.line (one safe line, cut) and is used with textContent only.
var Vaults = (function () {
  const display = typeof Display !== 'undefined' ? Display : require('./display.js').Display;

  const name = (v, max = 32) => display.line(v?.name || 'Vault', max) || 'Vault';

  // The pick list: names only, in the order the app reports (its fixed order: a vault never moves, whichever is shown or open).
  // No padlock or other glyph in an option: a state is said by the notice, and a padlock would mean "locked".
  function options(vaults, chosenId) {
    return vaults.map((v) => ({ value: v.id, text: name(v, 40), selected: v.id === chosenId }));
  }

  // The vault the popup uses: the one the person chose while the popup is open when it is still listed, else the one the app shows,
  // else the first. Nothing is chosen when there are no vaults (an older host: nothing to pick, nothing to unlock).
  function pick(vaults, wanted) {
    return vaults.find((v) => v.id === wanted) ?? vaults.find((v) => v.active) ?? vaults[0];
  }

  // What the notice says for a vault that cannot list logins, and whether Unlock is offered. `hint` is how the last Unlock ended.
  function notice(v, hint, count = 1) {
    const n = name(v);
    const another = count >= 2 ? ', or choose another vault' : '';
    switch (hint) {
      case 'cancelled': return { text: 'Touch ID was cancelled. Choose Unlock to try again.', kind: 'warning', unlock: true };
      case 'failed': return { text: 'Touch ID did not work. Choose Unlock to try again.', kind: 'warning', unlock: true };
      case 'needs-app': return { text: `Open Psss to unlock ${n}.`, kind: 'info', unlock: false };
      case 'opened': return { text: `Unlock ${n} in Psss.`, kind: 'info', unlock: false };
      default:
    }
    switch (v.state) {
      case 'needs-password': {
        const why = v.reason === 'changed' ? `Touch ID changed since ${n} was set up.`
          : v.reason === 'locked-out' ? 'Touch ID is locked out right now.' : `Touch ID is off for ${n}.`;
        return { text: `${why} Unlock with the vault password.`, kind: 'info', unlock: true };
      }
      case 'not-downloaded': return { text: `${n} isn’t downloaded yet. Psss lists nothing from it here. Open Psss to download it${another}.`, kind: 'warning', unlock: false };
      case 'not-found': return { text: `${n} was not found. Psss lists nothing from it here. Open Psss to locate it${another}.`, kind: 'warning', unlock: false };
      case 'unreadable': return { text: `${n} can’t be read. Psss lists nothing from it here. Open Psss for details${another}.`, kind: 'warning', unlock: false };
      default: return { text: `${n} is locked. Choose Unlock to use Touch ID.`, kind: 'info', unlock: true };
    }
  }

  return { name, options, pick, notice };
})();
if (typeof module !== 'undefined') module.exports = { Vaults };
