"""End-to-end test in real Firefox (or a fork: --browser /Applications/Zen.app/Contents/MacOS/zen).

    python3 Extensions/Browser/tests/e2e/firefox.py [--browser PATH] [--keep]

Starts Firefox with Marionette in a throwaway profile, installs the test variant as a temporary
add-on, and drives the real popup, native host and injection. --keep opens a persistent dev profile
with the production dev build instead, for trying it by hand.

Firefox grants MV3 host permissions only when the person does, so the test grants the localhost
origins from chrome code. The production build asks for none.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
BUILD = ROOT / "build" / "browser"
BUILD_PY = ROOT / "Extensions/Browser/build.py"
SITE = "http://localhost:8080"
ARGS = sys.argv[1:]
BROWSER = ARGS[ARGS.index("--browser") + 1] if "--browser" in ARGS else "/Applications/Firefox.app/Contents/MacOS/firefox"
KEEP = "--keep" in ARGS
GECKO_ID = json.loads((ROOT / "Extensions/Browser/targets/firefox.json").read_text())["browser_specific_settings"]["gecko"]["id"]
FOREIGN_ID = "foreign@example.invalid"
MARIONETTE_PORT = 28228 if "--keep" in sys.argv else 28229  # a hand-driven session and a test run can coexist


def build(*args):
    return subprocess.run([sys.executable, str(BUILD_PY), *args], check=True, capture_output=True, text=True).stdout


def wait_for(fn, what, timeout=15.0):
    end, last = time.time() + timeout, None
    while time.time() < end:
        try:
            value = fn()
            if value:
                return value
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(0.1)
    raise AssertionError(f"timed out waiting for {what}" + (f": {last}" if last else ""))


def port_open(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


class Marionette:
    """The Marionette wire protocol: `length:json` frames over TCP; commands are [0, id, name, params]."""

    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=30)
        self.buf = b""
        self.id = 0
        self._read()  # handshake
        self.call("WebDriver:NewSession", {"capabilities": {}})

    def _read(self):
        while b":" not in self.buf:
            self.buf += self.sock.recv(65536)
        n, _, rest = self.buf.partition(b":")
        n = int(n)
        while len(rest) < n:
            rest += self.sock.recv(65536)
        self.buf = rest[n:]
        return json.loads(rest[:n])

    def call(self, name, params=None):
        self.id += 1
        body = json.dumps([0, self.id, name, params or {}]).encode()
        self.sock.sendall(str(len(body)).encode() + b":" + body)
        while True:
            msg = self._read()
            if msg[0] == 1 and msg[1] == self.id:
                if msg[2]:
                    raise RuntimeError(f"{name}: {msg[2].get('error')}: {msg[2].get('message')}")
                return msg[3]

    def script(self, source, *args, chrome=False, async_=False):
        self.call("Marionette:SetContext", {"value": "chrome" if chrome else "content"})
        try:
            r = self.call("WebDriver:ExecuteAsyncScript" if async_ else "WebDriver:ExecuteScript",
                          {"script": source, "args": list(args)})
        finally:
            if chrome:
                self.call("Marionette:SetContext", {"value": "content"})
        return r.get("value") if isinstance(r, dict) else r


def launch(profile: Path, uuids: dict, headless: bool, host_env: dict | None = None):
    profile.mkdir(parents=True, exist_ok=True)
    prefs = {
        "marionette.port": MARIONETTE_PORT,
        "extensions.webextensions.uuids": json.dumps(uuids),  # fixed moz-extension:// hosts
        "browser.shell.checkDefaultBrowser": False, "app.update.enabled": False,
        "datareporting.policy.dataSubmissionEnabled": False, "browser.startup.homepage_welcome_url": "about:blank",
        "network.dns.localDomains": "insecure.test,localhost.evil.test",  # resolve to loopback for origin tests
    }
    (profile / "user.js").write_text("".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n" for k, v in prefs.items()))
    cmd = [BROWSER, "--marionette", "--no-remote", "--profile", str(profile)] + (["-headless"] if headless else []) + ["about:blank"]
    child = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             env={**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1", **(host_env or {})})  # chrome-context scripts need this
    wait_for(lambda: port_open(MARIONETTE_PORT), "Marionette", 60)
    time.sleep(1)
    return child, wait_for(lambda: Marionette(MARIONETTE_PORT), "Marionette session", 30)


GRANT = """
const [id, origins, done] = arguments;
(async () => {
  const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
  const policy = WebExtensionPolicy.getByID(id);
  await ExtensionPermissions.add(id, { permissions: [], origins }, policy.extension);
  done(true);
})().catch((e) => done("error: " + e));
"""


def install(m, path, addon_id, origins=None):
    assert m.call("Addon:Install", {"path": str(path), "temporary": True})["value"] == addon_id
    if origins:
        r = m.script(GRANT, addon_id, origins, chrome=True, async_=True)
        assert r is True, r


def start_site():
    if port_open(8080):
        return None
    p = subprocess.Popen([shutil.which("node") or "node", "--disable-warning=ExperimentalWarning", str(ROOT / "Packages/test-sites/src/server.ts"), "--port", "8080"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for(lambda: port_open(8080), "test site (needs Node 24 on the path)")
    return p


if KEEP:
    build("package", "--dev", "-t", "firefox")
    site = start_site()
    ext_uuid = str(uuid.uuid4())
    child, m = launch(BUILD / "profiles/firefox", {GECKO_ID: ext_uuid}, headless=False)
    install(m, BUILD / "firefox", GECKO_ID)
    m.call("WebDriver:Navigate", {"url": f"{SITE}/login.html"})
    print(f"Firefox opened with the temporary add-on {GECKO_ID}. Open the sample login, then use the toolbar button (grant the site if asked).")
    print("Quit Firefox to finish.")
    child.wait()
    sys.exit(0)

UUID = str(uuid.uuid4())
FOREIGN_UUID = str(uuid.uuid4())


class FirefoxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build("package", "--test", "-t", "firefox")
        foreign = BUILD / "firefox-test-foreign"
        shutil.rmtree(foreign, ignore_errors=True)
        shutil.copytree(BUILD / "firefox-test", foreign)
        manifest = json.loads((foreign / "manifest.json").read_text())
        manifest["browser_specific_settings"]["gecko"]["id"] = FOREIGN_ID
        (foreign / "manifest.json").write_text(json.dumps(manifest))
        cls.site = start_site()
        cls.profile = Path(tempfile.mkdtemp(prefix="psss-ff-"))
        cls.store = Path(tempfile.mkdtemp(prefix="psss-store-"))  # the host inherits this env, so saves stay out of the real directory
        cls.child, cls.m = launch(cls.profile, {GECKO_ID: UUID, FOREIGN_ID: FOREIGN_UUID}, headless=True,
                                  host_env={"PSSS_PROTOTYPE_DIR": str(cls.store)})
        origins = ["http://localhost/*", "http://127.0.0.1/*", "http://*.test/*"]
        install(cls.m, BUILD / "firefox-test", GECKO_ID, origins)
        install(cls.m, foreign, FOREIGN_ID, origins)

    @classmethod
    def tearDownClass(cls):
        cls.child.terminate()
        cls.child.wait(timeout=20)
        if cls.site:
            cls.site.terminate()
        shutil.rmtree(cls.profile, ignore_errors=True)
        shutil.rmtree(cls.store, ignore_errors=True)

    # helpers
    def tab(self, url):
        handle = self.m.call("WebDriver:NewWindow", {"type": "tab", "focus": True})["handle"]
        self.m.call("WebDriver:SwitchToWindow", {"handle": handle})
        self.m.call("WebDriver:Navigate", {"url": url})
        return handle

    def use(self, handle):
        self.m.call("WebDriver:SwitchToWindow", {"handle": handle, "focus": True})

    def close(self, handle):
        self.use(handle)
        self.m.call("WebDriver:CloseWindow")
        remaining = self.m.call("WebDriver:GetWindowHandles")
        if remaining:
            self.use(remaining[-1])

    def popup_for(self, page_url, ext=UUID):
        page = self.tab(page_url)
        scheme_host = page_url.split("/")[0] + "//" + page_url.split("/")[2].split(":")[0]  # match patterns have no port
        popup = self.tab(f"moz-extension://{ext}/popup.html#target={scheme_host}/*")
        return page, popup

    def js(self, handle, source):
        self.use(handle)
        return self.m.script(source)

    def settled(self, popup):
        return wait_for(lambda: self.js(popup, "return document.querySelectorAll('#logins li').length > 0 || document.getElementById('status').textContent || !document.getElementById('sitenote').hidden"), "popup to settle")

    def with_popup(self, url, body):
        page, popup = self.popup_for(url)
        try:
            body(page, popup)
        finally:
            for h in (popup, page):
                try:
                    self.close(h)
                except Exception:  # noqa: BLE001  (a popup may have closed itself)
                    pass

    # tests
    def test_1_extension_loads_and_host_answers_a_ping(self):
        popup = self.tab(f"moz-extension://{UUID}/popup.html")
        try:
            reply = wait_for(lambda: self.js(popup, "return null") is None, "popup page") and self.m.script(
                "const done = arguments[arguments.length - 1]; Host.ping().then(done)", async_=True)
            self.assertTrue(reply["ok"], reply)
            self.assertEqual(reply["protocol"], 4)
        finally:
            self.close(popup)

    def test_2_lists_and_fills_on_click(self):
        def body(page, popup):
            self.settled(popup)
            self.assertIsNone(self.js(popup, "return document.getElementById('site')"), "the popup does not repeat the page's site")
            self.assertEqual(self.text(popup, "forsite"), "For This Site")
            self.assertEqual(self.js(popup, "return document.activeElement.id"), "q", "the search field has the focus when the popup opens")
            self.assertIn("alex@example.net", self.js(popup, "return document.querySelector('#logins li').innerText"))
            self.assertNotIn("Demo-only", self.js(popup, "return document.documentElement.outerHTML"))
            self.assertEqual(self.js(page, "return document.getElementById('p').value"), "")
            self.js(popup, "document.querySelector('#logins button').click()")
            wait_for(lambda: self.js(page, "return document.getElementById('p').value") != "", "password filled")
            self.assertEqual(self.js(page, "return document.getElementById('u').value"), "alex@example.net")
            self.assertEqual(self.js(page, "return document.getElementById('p').value.length"), 18)
        self.with_popup(f"{SITE}/login.html", body)

    def assert_no_empty_boxes(self, popup, where):
        # Author CSS once beat [hidden], so empty notices and unlabeled pills drew: look at what is rendered.
        bad = self.js(popup, """return [...document.querySelectorAll('.notice, .pills, .pill, .card, #results, #sitegroup, #search, #create')]
            .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
            .filter((e) => e.textContent.trim() === '' && !e.querySelector('input'))
            .map((e) => e.id || e.className)""")
        self.assertEqual(bad, [], f"{where}: no visible empty box")
        self.assertTrue(self.js(popup, "return [...document.querySelectorAll('.pill')].filter((e) => e.getBoundingClientRect().height > 0).every((e) => e.textContent.trim() !== '')"), f"{where}: shown pills have text")
        self.assertFalse(self.js(popup, "return document.querySelector('header').innerText.includes('Psss')"), f"{where}: header shows the logo only")
        self.assertEqual(self.js(popup, "return document.querySelector('header .logo').getAttribute('aria-label')"), "Psss")

    def test_2b_search_pills_and_vault_switcher(self):
        def body(page, popup):
            self.settled(popup)
            self.assert_no_empty_boxes(popup, "a match")
            self.assertFalse(self.js(popup, "return document.getElementById('sitenote').getBoundingClientRect().height > 0"), "no no-logins notice when a login matches")
            self.assertEqual(self.js(popup, "return document.getElementById('pills').getBoundingClientRect().height"), 0, "no pills before a search")
            self.set_query(popup, "alex@studio")
            wait_for(lambda: self.js(popup, "return document.querySelectorAll('#results li button').length > 0"), "results")
            self.assertEqual(self.js(popup, "return [...document.querySelectorAll('#pills button')].map((b) => b.getAttribute('aria-label') + (b.disabled ? ' off' : '')).join('|')"),
                             "Name, 0 off|Website, 0 off|Username, 1")
            self.assert_no_empty_boxes(popup, "search results")
            self.assertEqual(self.js(popup, "return [...document.querySelectorAll('#pills button')].map((b) => b.textContent.trim()).join('|')"), "Name 0|Website 0|Username 1")
            self.assertEqual(self.js(popup, "return document.querySelector('#results .hit').textContent"), "alex@studio")
            self.set_query(popup, "")
        self.with_popup(f"{SITE}/login.html", body)

    # vaults: the prototype host keeps them in vaults.json next to its prototype file
    def set_vaults(self, obj=None):
        path = self.store / "vaults.json"
        if obj is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(json.dumps(obj))

    def text(self, popup, element):
        return self.js(popup, f"return document.getElementById({json.dumps(element)}).textContent")

    def shown(self, popup, element):
        return self.js(popup, f"return !document.getElementById({json.dumps(element)}).hidden")

    def badge(self, popup):
        return self.m.script("const done = arguments[arguments.length - 1]; browser.action.getBadgeText({}).then(done)", async_=True)

    def choose_vault(self, popup, name):
        self.js(popup, f"const s = document.getElementById('vaultselect'); s.value = [...s.options].find((o) => o.textContent === {json.dumps(name)}).value; s.dispatchEvent(new Event('change'));")
        wait_for(lambda: self.js(popup, f"return document.getElementById('vaultselect').selectedOptions[0].textContent === {json.dumps(name)} && !document.getElementById('vaultselect').disabled"), f"{name} current")

    def test_2c_vault_button_menu_states_and_unlock(self):
        def body(page, popup):
            self.settled(popup)
            self.assertTrue(self.shown(popup, "vaultbar"))
            self.assertEqual(self.js(popup, "return document.getElementById('vaultselect').getAttribute('aria-label')"), "Vault")
            self.assertEqual(self.js(popup, "return document.getElementById('vaultbar').firstElementChild.tagName"), "svg")
            self.assertFalse(self.shown(popup, "unlock"))
            options = self.js(popup, "return [...document.querySelectorAll('#vaultselect option')].map((o) => o.textContent + (o.selected ? '*' : '')).join('|')")
            self.assertEqual(options, "Passwords*|Work|Archive|Family|Travel|Taxes|Old")
            try:
                self.choose_vault(popup, "Work")
                self.assertEqual(self.text(popup, "status"), "Work is locked. Choose Unlock to use Touch ID.")
                self.assertTrue(self.shown(popup, "unlock"))
                self.assertFalse(self.shown(popup, "search"))
                self.js(popup, "document.getElementById('unlock').click()")
                wait_for(lambda: self.shown(popup, "sitegroup"), "Work lists")
                self.assertEqual(self.text(popup, "sitenotebody"), "Work has none for this site. Search all logins above, or choose another vault.")
                # Touch ID cancelled
                self.choose_vault(popup, "Archive")
                self.js(popup, "document.getElementById('unlock').click()")
                wait_for(lambda: self.text(popup, "status") == "Touch ID was cancelled. Choose Unlock to try again.", "cancelled notice")
                self.assertEqual(self.js(popup, "return document.getElementById('notice').dataset.kind"), "warning")
                self.assertTrue(self.shown(popup, "unlock"))
                # needs the vault password: no app to bring forward in the prototype
                self.choose_vault(popup, "Family")
                self.assertEqual(self.text(popup, "status"), "Touch ID is off for Family. Unlock with the vault password.")
                self.js(popup, "document.getElementById('unlock').click()")
                wait_for(lambda: self.text(popup, "status") == "Open Psss to unlock Family.", "needs-app notice")
                self.assertFalse(self.shown(popup, "unlock"))
                # not available: no Unlock
                self.choose_vault(popup, "Old")
                self.assertEqual(self.text(popup, "status"), "Old was not found. Psss lists nothing from it here. Open Psss to locate it, or choose another vault.")
                self.assertFalse(self.shown(popup, "unlock"))
                self.assertTrue(self.shown(popup, "vaultbar"))
            finally:
                self.set_vaults()
        self.with_popup(f"{SITE}/login.html", body)

    def test_2d_background_unlock_leaves_a_check_for_the_next_click(self):
        def body(page, popup):
            self.settled(popup)
            try:
                self.m.script("const done = arguments[arguments.length - 1]; Host.switchVault('work').then(done)", async_=True)
                self.m.script("const done = arguments[arguments.length - 1]; browser.runtime.sendMessage({ psss: 'unlock-vault', vault: 'work' }).then(done)", async_=True)
                self.assertEqual(self.badge(popup), "\u2713")
                self.use(popup)
                self.m.call("WebDriver:Refresh")
                wait_for(lambda: self.shown(popup, "sitegroup"), "Work lists with no second prompt")
                self.assertEqual(self.badge(popup), "")
            finally:
                self.set_vaults()
        self.with_popup(f"{SITE}/login.html", body)

    def test_2e_one_vault_notice_carries_unlock_and_hostile_names_are_text(self):
        def body(page, popup):
            self.settled(popup)
            self.set_vaults({"active": "passwords", "open": [], "vaults": [{"id": "passwords", "name": "Only"}]})
            try:
                self.use(popup)
                self.m.call("WebDriver:Refresh")
                wait_for(lambda: self.text(popup, "status") != "", "notice")
                self.assertEqual(self.text(popup, "status"), "Only is locked. Choose Unlock to use Touch ID.")
                self.assertFalse(self.shown(popup, "vaultbar")); self.assertFalse(self.shown(popup, "unlock")); self.assertTrue(self.shown(popup, "noticeunlock"))
                self.js(popup, "document.getElementById('noticeunlock').click()")
                wait_for(lambda: self.shown(popup, "sitegroup"), "lists")
                self.assertEqual(self.js(popup, "return document.getElementById('vaultbar').hidden"), True)
                names = ["Work\u202egpj.exe", '<img src=x onerror="window.__pwned=1">', "y" * 4000]
                self.set_vaults({"vaults": [{"id": f"h{i}", "name": n, "location": n} for i, n in enumerate(names)]})
                self.use(popup)
                self.m.call("WebDriver:Refresh")
                wait_for(lambda: self.js(popup, "return document.getElementById('vaultselect').options.length") > 0, "pick list")
                rows = list(self.js(popup, "return [...document.querySelectorAll('#vaultselect option')].map((o) => o.textContent)"))
                self.assertEqual(rows[0], "Workgpj.exe")
                self.assertEqual(rows[1], '<img src=x onerror="window.__pwned=1">')
                self.assertTrue(len(rows[2]) <= 40 and rows[2].endswith("\u2026"))
                self.assertEqual(self.js(popup, "return document.querySelectorAll('#vaultbar img').length + (window.__pwned || 0)"), 0)
            finally:
                self.set_vaults()
        self.with_popup(f"{SITE}/login.html", body)

    def test_2f_save_refuses_a_vault_that_is_not_open_and_signup_names_the_vault(self):
        def body(page, popup):
            wait_for(lambda: self.shown(popup, "create"), "create section")
            self.assertEqual(self.text(popup, "generate"), "Generate, Fill and Save")
            self.js(popup, "const a = document.getElementById('account'); a.value = 'alex@example.net'; a.dispatchEvent(new Event('input'));")
            self.assertEqual(self.text(popup, "createtitle"), "Update a login")
            self.assertEqual(self.text(popup, "accountlabel"), "Passwords already has alex@example.net for this site.")
            refused = self.m.script("const done = arguments[arguments.length - 1]; Host.save('http://localhost:8080', 'work', 'refused@example.net', 'Never-saved-1').then((r) => done(r.error), () => done('x'))", async_=True)
            self.assertEqual(refused, "locked")  # Work is not open: a save is never written into it
        self.with_popup(f"{SITE}/signup.html", body)

    def test_2g_return_fills_the_only_match(self):
        def body(page, popup):
            self.settled(popup)
            self.set_vaults({"active": "work", "open": ["work"]})
            try:
                self.m.script("const done = arguments[arguments.length - 1]; Host.save('http://localhost:8080', 'work', 'solo@example.net', 'Solo-secret-1').then(done)", async_=True)
                self.use(popup)
                self.m.call("WebDriver:Refresh")
                wait_for(lambda: self.js(popup, "return document.querySelectorAll('#logins li.row').length === 1"), "one login")
                self.js(popup, "const i = document.getElementById('q'); i.value = 'solo@'; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));")
                wait_for(lambda: self.js(page, "return document.getElementById('p').value") != "", "filled by Return")
                self.assertEqual(self.js(page, "return document.getElementById('u').value"), "solo@example.net")
            finally:
                self.set_vaults()
                (self.store / "saved-logins-work.json").unlink(missing_ok=True)
        self.with_popup(f"{SITE}/login.html", body)

    def test_3_framework_style_listeners_see_input_events(self):
        def body(page, popup):
            self.js(page, "window.__events = []; for (const id of ['u','p']) document.getElementById(id).addEventListener('input', () => window.__events.push(id));")
            self.settled(popup)
            self.js(popup, "document.querySelector('#logins button').click()")
            wait_for(lambda: self.js(page, "return window.__events.length") >= 2, "input events")
            self.assertEqual(list(self.js(page, "return Array.from(window.__events)")), ["u", "p"])
        self.with_popup(f"{SITE}/login.html", body)

    def test_4_other_loopback_name_is_a_different_site(self):
        def body(page, popup):
            self.settled(popup)
            self.assertEqual(self.text(popup, "sitenotebody"), "Passwords has none for this site. Search all logins above, or choose another vault.")
            self.assertTrue(self.js(popup, "return document.getElementById('sitenote').getBoundingClientRect().height > 0"), "the no-logins notice shows")
            self.assert_no_empty_boxes(popup, "no match")
            self.assertEqual(self.text(popup, "forsite"), "For This Site")
        self.with_popup("http://127.0.0.1:8080/login.html", body)

    def set_query(self, popup, q):
        self.js(popup, f"const i = document.getElementById('q'); i.value = {json.dumps(q)}; i.dispatchEvent(new Event('input'));")

    def test_4b_search_fills_a_login_for_another_site_with_one_click(self):
        def body(page, popup):
            self.settled(popup)
            self.assertEqual(self.js(popup, "return document.activeElement.id"), "q")
            self.set_query(popup, "localhost")
            wait_for(lambda: self.js(popup, "return document.querySelectorAll('#results li button').length > 0"), "results")
            self.assertIn("Saved for localhost", self.js(popup, "return document.querySelector('#results li').innerText"))
            self.assertEqual(self.js(popup, "return document.querySelector('#results li button').textContent"), "Fill")
            self.assertEqual(self.js(page, "return document.getElementById('p').value"), "")
            self.js(popup, "document.querySelector('#results li button').click()")
            wait_for(lambda: self.js(page, "return document.getElementById('p').value") != "", "manual fill")
            self.assertEqual(self.js(page, "return document.getElementById('u').value"), "alex@example.net")
        self.with_popup("http://127.0.0.1:8080/login.html", body)

    def test_4c_search_miss_and_blank(self):
        def body(page, popup):
            self.settled(popup)
            self.set_query(popup, "zzz-no-such-login")
            wait_for(lambda: self.js(popup, "return document.querySelector('#results li')?.innerText") == "Nothing found.", "nothing found")
            self.set_query(popup, "  ")
            wait_for(lambda: self.js(popup, "return document.querySelectorAll('#results li').length") == 0, "cleared")
        self.with_popup(f"{SITE}/login.html", body)

    def test_4d_settings_page_turns_the_browser_save_prompt_off_and_on(self):
        page = self.tab(f"moz-extension://{UUID}/settings.html")
        try:
            setting = lambda: self.m.script(  # noqa: E731
                "const done = arguments[arguments.length - 1];"
                "browser.privacy.services.passwordSavingEnabled.get({}).then((d) => done(d.value + ' ' + d.levelOfControl))", async_=True)
            # Marionette profiles start with the password manager off, so restore whatever it started as.
            initial = setting()
            self.assertTrue(initial.endswith(" controllable_by_this_extension"), initial)
            wait_for(lambda: self.js(page, "return document.getElementById('toggle').textContent") == "Turn off browser password prompts", "off button")
            self.js(page, "document.getElementById('toggle').click()")
            wait_for(lambda: setting() == "false controlled_by_this_extension", "prompt off")
            wait_for(lambda: self.js(page, "return document.getElementById('toggle').textContent") == "Turn browser password prompts back on", "on button")
            self.js(page, "document.getElementById('toggle').click()")
            wait_for(lambda: setting() == initial, "prompt restored")
        finally:
            self.close(page)

    def test_4e_signup_generates_fills_both_fields_and_saves(self):
        def body(page, popup):
            self.js(page, "document.getElementById('u').value = 'signup.person@example.net'")
            self.use(popup)
            self.m.call("WebDriver:Refresh")  # a popup reads the page when it opens
            wait_for(lambda: not self.js(popup, "return document.getElementById('create').hidden"), "create section")
            self.assertEqual(self.js(popup, "return document.getElementById('account').value"), "signup.person@example.net")
            self.assertEqual(self.js(page, "return document.getElementById('p').value"), "")
            self.js(popup, "document.getElementById('generate').click()")
            wait_for(lambda: "Saved the login" in self.js(popup, "return document.getElementById('created').textContent"), "saved")
            p = self.js(page, "return document.getElementById('p').value")
            self.assertEqual(p, self.js(page, "return document.getElementById('c').value"))
            self.assertEqual(len(p), 20)
            saved = [i for i in json.loads((self.store / "saved-logins.json").read_text()) if i["account"] == "signup.person@example.net"]
            self.assertEqual([(i["secret"], i["website"]) for i in saved], [(p, "localhost")])
            self.assertNotIn(p, self.js(popup, "return document.documentElement.outerHTML"))
            self.js(popup, "document.getElementById('generate').click()")
            wait_for(lambda: "Updated the login" in self.js(popup, "return document.getElementById('created').textContent"), "updated")
        self.with_popup(f"{SITE}/signup.html", body)

    def test_4f_signup_needs_a_username_and_sign_in_has_no_create_section(self):
        def body(page, popup):
            wait_for(lambda: not self.js(popup, "return document.getElementById('create').hidden"), "create section")
            self.js(popup, "document.getElementById('generate').click()")
            self.assertIn("Enter the username", self.js(popup, "return document.getElementById('created').textContent"))
            self.assertEqual(self.js(page, "return document.getElementById('p').value"), "")
        self.with_popup(f"{SITE}/signup.html", body)

        def body2(page, popup):
            self.settled(popup)
            time.sleep(0.5)
            self.assertTrue(self.js(popup, "return document.getElementById('create').hidden"))
        self.with_popup(f"{SITE}/login.html", body2)

    def test_5_refuses_insecure_and_lookalike_hosts(self):
        for url in ("http://insecure.test:8080/login.html", "http://localhost.evil.test:8080/login.html"):
            def body(page, popup, url=url):
                self.settled(popup)
                self.assertIn("secure (https)", self.js(popup, "return document.getElementById('status').textContent"), url)
            self.with_popup(url, body)

    def test_6_navigation_between_list_and_fill_aborts(self):
        def body(page, popup):
            self.settled(popup)
            self.use(page)
            self.m.call("WebDriver:Navigate", {"url": "http://127.0.0.1:8080/login.html"})
            self.js(popup, "document.querySelector('#logins button').click()")
            wait_for(lambda: "page changed" in self.js(popup, "return document.getElementById('status').textContent"), "abort message")
            self.assertEqual(self.js(page, "return document.getElementById('p').value"), "")
        self.with_popup(f"{SITE}/login.html", body)

    def test_7_other_add_on_id_cannot_use_the_host(self):
        popup = self.tab(f"moz-extension://{FOREIGN_UUID}/popup.html")
        try:
            error = self.m.script(
                "const done = arguments[arguments.length - 1];"
                "api.runtime.sendNativeMessage(PROTOCOL.host, {v: 4, id: 'x', type: 'ping'}).then(() => done(null), (e) => done(e.message))", async_=True)
            self.assertTrue(error, "Firefox must refuse an add-on that is not in allowed_extensions")
            self.assertFalse(self.m.script("const done = arguments[arguments.length - 1]; Host.ping().then((r) => done(r.ok))", async_=True))
        finally:
            self.close(popup)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0], "-v"], verbosity=2)
