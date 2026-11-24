// Background: the one request that can outlive the popup. Unlocking with Touch ID puts a system prompt in front of the browser,
// the popup loses focus and the browser closes it, so the popup's own code never sees the answer. This script asks the host,
// and leaves the result where the next click finds it: a check on the toolbar button when the vault is open (the next click
// lists its logins with no second prompt) and an exclamation mark when Touch ID was cancelled or did not work.
// The badge holds only a symbol. Nothing about the vault, the page or a login is stored, logged or put on the button.
if (typeof importScripts === 'function') importScripts('protocol.js', 'host.js');

(function () {
  async function badge(text, color) {
    try {
      await api.action.setBadgeText({ text });
      if (color) await api.action.setBadgeBackgroundColor({ color });
    } catch {
      // A browser without badges still works: the popup just opens on the current state.
    }
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== api.runtime.id || message?.psss !== 'unlock-vault') return false;
    if (typeof message.vault !== 'string' || !message.vault || message.vault.length > 64) { sendResponse({ ok: false, error: PROTOCOL.errors.notFound }); return false; }
    (async () => {
      const reply = await Host.unlockVault(message.vault);
      const open = reply.ok && reply.vaults?.find((v) => v.active)?.state === 'open';
      if (open) await badge('✓', '#34c759');
      else if (reply.error === PROTOCOL.errors.cancelled || reply.error === PROTOCOL.errors.failed) await badge('!', '#ff9500');
      sendResponse(reply);
    })();
    return true;  // the answer comes later
  });
})();
