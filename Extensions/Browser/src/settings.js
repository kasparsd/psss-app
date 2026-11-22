// Settings page. One switch: the browser's own "offer to save passwords" prompt.
// The `privacy` permission is optional and is requested only when the person clicks the button,
// from this tab, because the permission dialog would close the toolbar popup mid-request.
// The browser reverts the setting by itself if Psss is disabled or removed.
(async function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const stateEl = document.getElementById('state');
  const toggle = document.getElementById('toggle');
  const PERM = { permissions: ['privacy'] };

  async function current() {
    if (!(await api.permissions.contains(PERM))) return { granted: false };
    const d = await api.privacy.services.passwordSavingEnabled.get({});
    return { granted: true, value: d.value, control: d.levelOfControl };
  }

  async function render() {
    const s = await current();
    toggle.disabled = false;
    toggle.dataset.action = 'off';
    toggle.textContent = 'Turn off browser password prompts';
    stateEl.textContent = '';
    if (!s.granted || s.control === 'controllable_by_this_extension') return;
    if (s.control === 'controlled_by_this_extension') {
      toggle.dataset.action = 'on';
      toggle.textContent = 'Turn browser password prompts back on';
      stateEl.textContent = 'Browser password prompts are off while Psss is installed.';
      return;
    }
    toggle.disabled = true;
    stateEl.textContent = 'Another extension or a policy controls this setting.';
  }

  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    try {
      if (toggle.dataset.action === 'off') {
        if (!(await api.permissions.contains(PERM)) && !(await api.permissions.request(PERM))) return;
        await api.privacy.services.passwordSavingEnabled.set({ value: false });
      } else {
        await api.privacy.services.passwordSavingEnabled.clear({});
        await api.permissions.remove(PERM).catch(() => {}); // required in test builds, so this may fail there
      }
    } catch (e) {
      stateEl.textContent = 'Could not change the setting.';
      return;
    } finally {
      if (!stateEl.textContent) await render(); else toggle.disabled = false;
    }
  });

  await render();
})();
