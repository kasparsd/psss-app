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
    p = subprocess.Popen([sys.executable, str(ROOT / "prototype/sample-site/server.py")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for(lambda: port_open(8080), "sample site")
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
        return wait_for(lambda: self.js(popup, "return document.querySelectorAll('#logins li').length > 0 || document.getElementById('status').textContent"), "popup to settle")

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
            self.assertEqual(reply["protocol"], 1)
        finally:
            self.close(popup)

    def test_2_lists_and_fills_on_click(self):
        def body(page, popup):
            self.settled(popup)
            self.assertEqual(self.js(popup, "return document.getElementById('site').textContent"), "localhost:8080")
            self.assertIn("alex@example.net", self.js(popup, "return document.querySelector('#logins li').innerText"))
            self.assertNotIn("Demo-only", self.js(popup, "return document.documentElement.outerHTML"))
            self.assertEqual(self.js(page, "return document.getElementById('p').value"), "")
            self.js(popup, "document.querySelector('#logins button').click()")
            wait_for(lambda: self.js(page, "return document.getElementById('p').value") != "", "password filled")
            self.assertEqual(self.js(page, "return document.getElementById('u').value"), "alex@example.net")
            self.assertEqual(self.js(page, "return document.getElementById('p').value.length"), 18)
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
            self.assertIn("No saved logins", self.js(popup, "return document.getElementById('status').textContent"))
        self.with_popup("http://127.0.0.1:8080/login.html", body)

    def set_query(self, popup, q):
        self.js(popup, f"const i = document.getElementById('q'); i.value = {json.dumps(q)}; i.dispatchEvent(new Event('input'));")

    def test_4b_search_finds_a_login_for_another_site_and_asks_first(self):
        def body(page, popup):
            self.settled(popup)
            self.assertIn("Search all logins", self.js(popup, "return document.getElementById('status').textContent"))
            self.set_query(popup, "localhost")
            wait_for(lambda: self.js(popup, "return document.querySelectorAll('#results li button').length > 0"), "results")
            self.assertIn("Saved for localhost", self.js(popup, "return document.querySelector('#results li').innerText"))
            self.js(popup, "document.querySelector('#results li button').click()")
            self.assertIn("not 127.0.0.1", self.js(popup, "return document.querySelector('#results li .warning').innerText"))
            self.assertEqual(self.js(page, "return document.getElementById('p').value"), "")
            self.js(popup, "document.querySelector('#results li .cancel').click()")
            self.assertEqual(self.js(page, "return document.getElementById('p').value"), "")
            self.js(popup, "document.querySelector('#results li button').click()")
            self.js(popup, "document.querySelector('#results li .confirm-fill').click()")
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
                "api.runtime.sendNativeMessage(PROTOCOL.host, {v: 1, id: 'x', type: 'ping'}).then(() => done(null), (e) => done(e.message))", async_=True)
            self.assertTrue(error, "Firefox must refuse an add-on that is not in allowed_extensions")
            self.assertFalse(self.m.script("const done = arguments[arguments.length - 1]; Host.ping().then((r) => done(r.ok))", async_=True))
        finally:
            self.close(popup)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0], "-v"], verbosity=2)
