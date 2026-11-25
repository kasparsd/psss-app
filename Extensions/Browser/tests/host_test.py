"""Protocol test for the native host: framing, caller check, origin rules and matching.

The host is a relay client. These tests run the test host (`build.py host --testing`) against the stand-in relay
(`build.py standin`: the app's real relay server over the prototype's vaults), so the whole path is the shipping one except the
two signature checks. Build both first, or run scripts/test-relay.sh, which does:
  python3 Extensions/Browser/build.py host --testing && python3 Extensions/Browser/build.py standin
  python3 -m unittest discover -s Extensions/Browser/tests -p "host_test.py"
Uses the sample vault, whose login for "localhost" is the Sample Site login.
"""
import json
import os
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BINARY = ROOT / "build" / "browser" / "host-test" / "psss-native-host"
STANDIN = ROOT / "build" / "browser" / "relay-standin" / "psss-relay-standin"
CALLER = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"


def frame(payload: dict) -> bytes:
    body = json.dumps(payload).encode()
    return struct.pack("=I", len(body)) + body


def replies(data: bytes) -> list[dict]:
    out, i = [], 0
    while i < len(data):
        (n,) = struct.unpack_from("=I", data, i)
        out.append(json.loads(data[i + 4:i + 4 + n]))
        i += 4 + n
    return out


def start_standin(store, extra_env=None, *args):
    """Starts a stand-in relay on its own short socket path. Returns (process, socket path, folder to delete)."""
    root = tempfile.mkdtemp(prefix="psss-rl-", dir="/tmp")
    p = subprocess.Popen([str(STANDIN), "--directory", f"{root}/Relay", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                         env={**os.environ, "PSSS_PROTOTYPE_DIR": str(store), **(extra_env or {})})
    line = p.stdout.readline()
    assert line.startswith("ready "), f"the stand-in relay did not start: {line!r} {p.stderr.read() if p.poll() is not None else ''}"
    return p, f"{root}/Relay/browser.sock", root


def stop_standin(p, root):
    p.kill(); p.wait(); p.stdout.close(); p.stderr.close()
    shutil.rmtree(root, ignore_errors=True)


@unittest.skipUnless(BINARY.exists() and STANDIN.exists(), "build both first: build.py host --testing && build.py standin")
class HostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp())
        cls.host = cls.dir / "psss-native-host"
        shutil.copy2(BINARY, cls.host)
        (cls.dir / "allowed-callers.txt").write_text(CALLER + "\npasswords@psss.app\n")
        cls.store = cls.dir / "store"  # saved logins never touch the real prototype directory
        cls.store.mkdir()
        cls.relay, cls.socket, cls.relay_root = start_standin(cls.store)

    @classmethod
    def tearDownClass(cls):
        stop_standin(cls.relay, cls.relay_root)
        shutil.rmtree(cls.dir)

    def run_host(self, messages, args=(CALLER,), raw=None, socket=None):
        data = raw if raw is not None else b"".join(frame(m) for m in messages)
        p = subprocess.run([str(self.host), *args], input=data, capture_output=True, timeout=20,
                           env={**os.environ, "PSSS_RELAY_SOCKET": socket or self.socket})
        return p, replies(p.stdout)

    NAMED = ("candidates", "search", "credential", "card-candidates", "card")

    def req(self, type, **fields):
        """Requests that read logins name their vault (protocol 4); the first vault is the default of these tests."""
        named = {"vault": "passwords"} if type in self.NAMED else {}
        return {"v": 5, "id": "1", "type": type, **named, **fields}

    def test_ping(self):
        _, (r,) = self.run_host([self.req("ping")])
        self.assertTrue(r["ok"]); self.assertEqual(r["id"], "1"); self.assertEqual(r["protocol"], 5)
        self.assertIs(r["app"], True, "a ping answered through the relay says the app answered")

    def test_refuses_unknown_caller(self):
        p, out = self.run_host([self.req("ping")], args=("chrome-extension://evil/",))
        self.assertEqual(p.returncode, 2); self.assertEqual(out, [])

    def test_accepts_firefox_caller_arguments(self):
        _, (r,) = self.run_host([self.req("ping")], args=("/path/to/manifest.json", "passwords@psss.app"))
        self.assertTrue(r["ok"])

    def test_version_mismatch(self):
        for v in (3, 4, 6, "5", None):
            _, (r,) = self.run_host([{"v": v, "id": "9", "type": "ping"}])
            self.assertEqual((r["ok"], r["error"], r["id"]), (False, "unsupported", "9"), repr(v))

    def test_no_app_is_not_running(self):
        """Nothing listens (no socket, or a leftover socket file nobody serves): the reply says so, with the request's id."""
        gone = tempfile.mkdtemp(prefix="psss-rl-", dir="/tmp")
        self.addCleanup(shutil.rmtree, gone, ignore_errors=True)
        _, (r,) = self.run_host([self.req("ping")], socket=f"{gone}/Relay/browser.sock")
        self.assertEqual((r["v"], r["id"], r["ok"], r["error"]), (5, "1", False, "not-running"))
        import socket as sock_module
        leftover = f"{gone}/stale.sock"
        s = sock_module.socket(sock_module.AF_UNIX); s.bind(leftover); s.close()  # a file with no listener: connection refused
        _, (r,) = self.run_host([self.req("vaults")], socket=leftover)
        self.assertEqual(r["error"], "not-running")
        _, (r,) = self.run_host([self.req("ping")], socket="/tmp/" + "x" * 120)
        self.assertEqual(r["error"], "not-running", "a path too long for a socket cannot be listened on")

    def test_requests_the_relay_cannot_take_are_unsupported_with_their_id(self):
        _, (r,) = self.run_host([{"v": 5, "id": "big", "type": "ping", "pad": "x" * 70000}])
        self.assertEqual((r["ok"], r["error"], r["id"]), (False, "unsupported", "big"))
        _, replied = self.run_host([], raw=struct.pack("=I", 2) + b"[]")
        self.assertEqual((replied[0]["error"], replied[0]["id"]), ("unsupported", ""))
        deep = ('{"a":' * 50 + "1" + "}" * 50).encode()
        _, replied = self.run_host([], raw=struct.pack("=I", len(deep)) + deep)
        self.assertEqual(replied[0]["error"], "unsupported")
        bad = b'{"v":5,"id":"\xff","type":"ping"}'
        _, replied = self.run_host([], raw=struct.pack("=I", len(bad)) + bad)
        self.assertEqual(replied[0]["error"], "unsupported")

    def test_the_host_names_the_caller_it_was_started_by(self):
        """The app is told which allowed argument matched, and can refuse it (here: a stand-in that checks the compiled list)."""
        store = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, store, ignore_errors=True)
        p, sock, root = start_standin(store, None, "--callers", "compiled")
        self.addCleanup(stop_standin, p, root)
        _, (r,) = self.run_host([self.req("ping")], args=(CALLER,), socket=sock)
        self.assertEqual((r["ok"], r["error"]), (False, "forbidden"), "the app's own list does not know this extension")
        _, (r,) = self.run_host([self.req("ping")], args=("/manifest.json", "passwords@psss.app"), socket=sock)
        self.assertTrue(r["ok"], "the Firefox add-on id is on the app's list")

    def test_candidates_for_localhost(self):
        _, (r,) = self.run_host([self.req("candidates", origin="http://localhost:8080")])
        self.assertTrue(r["ok"]); self.assertTrue(r["candidates"])
        self.assertEqual(set(r["candidates"][0]), {"ref", "title", "account", "website", "passkey"})  # no secret in the list

    def test_no_candidates_for_other_host(self):
        _, (r,) = self.run_host([self.req("candidates", origin="https://unknown.example")])
        self.assertEqual(r["candidates"], [])

    def test_lookalike_hosts_do_not_match(self):
        for origin in ("https://localhost.evil.example", "https://evil-localhost"):
            _, (r,) = self.run_host([self.req("candidates", origin=origin)])
            self.assertEqual(r["candidates"], [], origin)

    def test_refuses_insecure_and_credentialed_origins(self):
        for origin in ("http://studio.example", "https://localhost@evil.example", "file:///x", "garbage"):
            _, (r,) = self.run_host([self.req("candidates", origin=origin)])
            self.assertEqual((r["ok"], r["error"]), (False, "forbidden"), origin)

    def test_credential_requires_matching_origin(self):
        _, (c,) = self.run_host([self.req("candidates", origin="http://localhost:8080")])
        ref = c["candidates"][0]["ref"]
        _, (ok,) = self.run_host([self.req("credential", ref=ref, origin="http://localhost:8080")])
        self.assertTrue(ok["ok"]); self.assertTrue(ok["secret"])
        _, (bad,) = self.run_host([self.req("credential", ref=ref, origin="https://evil.example")])
        self.assertEqual((bad["ok"], bad["error"]), (False, "forbidden"))
        self.assertNotIn("secret", bad)

    def test_search_returns_metadata_and_flags_matches(self):
        _, (r,) = self.run_host([self.req("search", origin="http://127.0.0.1:8080", query="LOCALHOST")])
        self.assertTrue(r["ok"]); self.assertTrue(r["results"])
        hit = r["results"][0]
        self.assertEqual(set(hit), {"ref", "title", "account", "website", "matches", "passkey", "found", "hit", "hitRange"})  # never a secret
        self.assertFalse(hit["matches"], "a login for localhost does not belong to 127.0.0.1")
        _, (r,) = self.run_host([self.req("search", origin="http://localhost:8080", query="localhost")])
        self.assertTrue(r["results"][0]["matches"])

    def test_search_says_which_field_matched_and_counts_each_field(self):
        _, (r,) = self.run_host([self.req("search", origin="https://example.org", query="studio north")])
        self.assertEqual(r["counts"], {"name": 1, "website": 0, "username": 0})
        (hit,) = r["results"]
        self.assertEqual((hit["found"], hit["hit"], hit["hitRange"]), ("name", "Studio North (work)", [0, 12]))
        _, (r,) = self.run_host([self.req("search", origin="https://example.org", query="alex@studio")])
        self.assertEqual(r["counts"]["username"], 1)
        (hit,) = r["results"]
        self.assertEqual((hit["found"], hit["hit"], hit["hitRange"]), ("username", "alex@studio.example", [0, 11]))
        _, (r,) = self.run_host([self.req("search", origin="https://example.org", query="alex@studio", fields=["website"])])
        self.assertEqual(r["results"], []); self.assertEqual(r["counts"]["username"], 1)  # counts ignore the chosen fields
        _, (r,) = self.run_host([self.req("search", origin="https://example.org", query="alex@studio", fields=["username", "bogus"])])
        self.assertEqual(r["total"], 1)

    def vault_host(self, vaults=None):
        """A host with its own prototype directory (a switch must not leak into the other tests), optionally with its own vault list."""
        store = Path(tempfile.mkdtemp())
        if vaults is not None:
            (store / "vaults.json").write_text(json.dumps({"vaults": vaults}))
        self.addCleanup(shutil.rmtree, store)
        relay, sock, root = start_standin(store)  # a vault state belongs to the relay process, so each of these tests has its own
        self.addCleanup(stop_standin, relay, root)

        def ask(*messages):
            p = subprocess.run([str(self.host), CALLER], input=b"".join(frame(m) for m in messages), capture_output=True, timeout=20,
                               env={**os.environ, "PSSS_RELAY_SOCKET": sock})
            return replies(p.stdout)
        return ask, store

    @staticmethod
    def states(r):
        return [(v["name"], v["active"], v["state"], v.get("reason")) for v in r["vaults"]]

    def test_vaults_list_every_state(self):
        ask, _ = self.vault_host()
        (r,) = ask(self.req("vaults"))
        self.assertEqual(self.states(r), [
            ("Passwords", True, "open", None), ("Work", False, "locked", None), ("Archive", False, "locked", None),
            ("Family", False, "needs-password", "off"), ("Travel", False, "not-downloaded", None),
            ("Taxes", False, "unreadable", None), ("Old", False, "not-found", None)])
        self.assertEqual(r["vaults"][1]["location"], "Work.kdbx")
        self.assertEqual(set(r["vaults"][0]), {"id", "name", "location", "active", "state"})
        self.assertEqual(set(r["vaults"][3]), {"id", "name", "location", "active", "state", "reason"})
        self.assertNotIn("Demo-only", json.dumps(r), "a vault list never carries a secret")

    def test_needs_password_reasons(self):
        ask, _ = self.vault_host([
            {"id": "a", "name": "A"}, {"id": "b", "name": "B", "quickUnlockOff": "changed"},
            {"id": "c", "name": "C", "quickUnlockOff": "locked-out"}, {"id": "d", "name": "D", "quickUnlockOff": "bogus"}])
        (r,) = ask(self.req("vaults"))
        self.assertEqual([(v["id"], v["state"], v.get("reason")) for v in r["vaults"]],
                         [("a", "open", None), ("b", "needs-password", "changed"), ("c", "needs-password", "locked-out"), ("d", "locked", None)])

    def test_switch_shows_a_vault_without_locking_or_unlocking_any(self):
        ask, _ = self.vault_host()
        (r,) = ask(self.req("switch-vault", vault="work"))
        self.assertTrue(r["ok"])
        self.assertEqual(self.states(r)[:2], [("Passwords", False, "open", None), ("Work", True, "locked", None)], "nothing locked, and the list keeps its order: the shown vault is not moved first")
        (c,) = ask(self.req("candidates", origin="https://gitforge.example", vault="work"))
        self.assertEqual((c["ok"], c["error"]), (False, "locked"), "nothing is listed until the unlock")
        (c,) = ask(self.req("search", origin="http://localhost", query="localhost"))
        self.assertTrue(c["ok"] and c["results"], "Passwords is still open and still fills while Work is the shown vault")
        (r,) = ask(self.req("switch-vault", vault="work"))
        self.assertTrue(r["ok"], "choosing the current vault changes nothing")
        (r,) = ask(self.req("switch-vault", vault="nope"))
        self.assertEqual(r["error"], "not-found")
        for bad in ("", "x" * 65, 7, None):
            (r,) = ask(self.req("switch-vault", vault=bad))
            self.assertEqual((r["ok"], r["error"]), (False, "not-found"), repr(bad))

    def test_unlock_vault_outcomes(self):
        ask, _ = self.vault_host([
            {"id": "ok", "name": "Ready"}, {"id": "cancel", "name": "Cancels", "touchID": "cancelled"}, {"id": "fail", "name": "Fails", "touchID": "failed"},
            {"id": "pw", "name": "Password", "quickUnlockOff": "off"}, {"id": "fwd", "name": "Forward", "quickUnlockOff": "changed", "appComesForward": True},
            {"id": "gone", "name": "Gone", "file": "not-found"}, {"id": "dl", "name": "Cloud", "file": "not-downloaded"}, {"id": "bad", "name": "Bad", "file": "unreadable"},
            {"id": "ready2", "name": "Ready too"}])
        ask(self.req("switch-vault", vault="ok"))
        (r,) = ask(self.req("unlock-vault", vault="ok"))
        self.assertTrue(r["ok"]); self.assertEqual(self.states(r)[0], ("Ready", True, "open", None))
        (c,) = ask(self.req("candidates", origin="https://gitforge.example", vault="ok"))
        self.assertTrue(c["ok"], "unlocked: the vault serves again")
        ask(self.req("switch-vault", vault="ready2"))
        (r,) = ask(self.req("unlock-vault", vault="ok"))
        self.assertEqual((r["ok"], r["error"]), (False, "forbidden"), "unlock applies to the current vault only")
        self.assertEqual([v["name"] for v in r["vaults"] if v["active"]], ["Ready too"])
        self.assertEqual(r["vaults"][0]["name"], "Ready", "the current vault is not moved first")
        expected = {"cancel": "cancelled", "fail": "failed", "pw": "needs-app", "gone": "not-available", "dl": "not-available", "bad": "not-available"}
        for vault, error in expected.items():
            ask(self.req("switch-vault", vault=vault))
            (r,) = ask(self.req("unlock-vault", vault=vault))
            self.assertEqual((r["ok"], r["error"]), (False, error), vault)
            current = next(v for v in r["vaults"] if v["active"])
            self.assertTrue(current["state"] != "open", f"{vault}: still locked, and the reply carries the list")
            self.assertNotIn("secret", json.dumps(r))
        ask(self.req("switch-vault", vault="fwd"))
        (r,) = ask(self.req("unlock-vault", vault="fwd"))
        self.assertEqual((r["ok"], r.get("app")), (True, "opened"))
        self.assertEqual(next(s for s in self.states(r) if s[1])[2], "needs-password", "psss came forward; the vault is still locked")
        (r,) = ask(self.req("unlock-vault", vault="nope"))
        self.assertEqual(r["error"], "not-found")
        for bad in ("", "x" * 65, 7, None):
            (r,) = ask(self.req("unlock-vault", vault=bad))
            self.assertEqual((r["ok"], r["error"]), (False, "not-found"), repr(bad))
        (r,) = ask({"v": 5, "id": "1", "type": "unlock-vault"})
        self.assertEqual(r["error"], "not-found")

    def test_not_available_vault_serves_nothing(self):
        ask, _ = self.vault_host()
        ask(self.req("switch-vault", vault="travel"))
        for message in (self.req("candidates", origin="https://gitforge.example", vault="travel"), self.req("search", origin="https://gitforge.example", query="git", vault="travel"),
                        self.req("save", origin="https://gitforge.example", vault="travel", account="a@b.c", secret="x")):
            (r,) = ask(message)
            self.assertEqual((r["ok"], r["error"]), (False, "not-available"), message["type"])

    def test_hostile_vault_names_pass_through_as_one_safe_line(self):
        hostile = ["Work\u202Egpj.exe", "Two\nLines\r\n", "<img src=x onerror=alert(1)>", "x" * 5000, "\u200b\u2066\u2069", "Tab\tName"]
        ask, _ = self.vault_host([{"id": f"v{i}", "name": n, "location": n} for i, n in enumerate(hostile)])
        (r,) = ask(self.req("vaults"))
        self.assertTrue(r["ok"])
        for v in r["vaults"]:
            for field in ("name", "location"):
                self.assertNotRegex(v[field], r"[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\u061c]", f"{field}: {v[field]!r}")
                self.assertLessEqual(len(v[field]), 80)
        names = [v["name"] for v in r["vaults"]]
        self.assertEqual(names[0], "Workgpj.exe")
        self.assertEqual(names[1], "Two Lines")
        self.assertEqual(names[2], "<img src=x onerror=alert(1)>", "markup is data: the popup shows it with textContent")
        self.assertEqual(len(names[3]), 80); self.assertTrue(names[3].endswith("…"))
        self.assertEqual(names[4], "Vault", "a name with nothing visible left is replaced")

    def test_vault_ids_over_64_characters_are_ignored_in_the_list(self):
        ask, _ = self.vault_host([{"id": "x" * 65, "name": "Too long"}, {"id": "ok", "name": "Fine"}])
        (r,) = ask(self.req("vaults"))
        self.assertEqual([v["name"] for v in r["vaults"]], ["Fine"])

    def test_search_edge_cases(self):
        for query in ("", "   ", "x" * 101):
            _, (r,) = self.run_host([self.req("search", origin="http://localhost", query=query)])
            self.assertEqual((r["ok"], r["results"]), (True, []), repr(query))
        _, (r,) = self.run_host([self.req("search", origin="http://insecure.example", query="localhost")])
        self.assertEqual((r["ok"], r["error"]), (False, "forbidden"))
        _, (r,) = self.run_host([self.req("search", origin="https://example.com", query="a")])
        self.assertLessEqual(len(r["results"]), 20)

    def test_manual_release_for_another_site_needs_the_flag_and_a_fillable_origin(self):
        _, (s,) = self.run_host([self.req("search", origin="http://127.0.0.1:8080", query="localhost")])
        ref = s["results"][0]["ref"]
        _, (no,) = self.run_host([self.req("credential", ref=ref, origin="http://127.0.0.1:8080")])
        self.assertEqual((no["ok"], no["error"]), (False, "forbidden"))
        _, (yes,) = self.run_host([self.req("credential", ref=ref, origin="http://127.0.0.1:8080", manual=True)])
        self.assertTrue(yes["ok"]); self.assertTrue(yes["secret"])
        _, (insecure,) = self.run_host([self.req("credential", ref=ref, origin="http://insecure.example", manual=True)])
        self.assertEqual((insecure["ok"], insecure["error"]), (False, "forbidden"), "manual never lifts the https rule")

    def test_generate_makes_a_strong_password_each_time(self):
        _, (a, b) = self.run_host([self.req("generate"), {**self.req("generate"), "id": "2"}])
        for r in (a, b):
            self.assertTrue(r["ok"]); self.assertEqual(len(r["password"]), 20)
            self.assertRegex(r["password"], r"[A-Z]"); self.assertRegex(r["password"], r"[a-z]"); self.assertRegex(r["password"], r"\d")
        self.assertNotEqual(a["password"], b["password"])

    def test_save_creates_then_updates_and_is_found_by_search(self):
        origin = "http://localhost:8080"
        _, (r,) = self.run_host([self.req("save", origin=origin, vault="passwords", account="new.person@example.net", secret="First-secret-1")])
        self.assertEqual((r["ok"], r["result"], r["vault"]), (True, "created", "passwords"))
        _, (r,) = self.run_host([self.req("save", origin=origin, vault="passwords", account="new.person@example.net", secret="Second-secret-2")])
        self.assertEqual((r["ok"], r["result"]), (True, "updated"))
        saved = json.loads((self.store / "saved-logins.json").read_text())
        mine = [i for i in saved if i["account"] == "new.person@example.net"]
        self.assertEqual(len(mine), 1, "an update must not duplicate the login")
        self.assertEqual((mine[0]["website"], mine[0]["secret"]), ("localhost", "Second-secret-2"))
        _, (r,) = self.run_host([self.req("search", origin=origin, query="new.person")])
        self.assertTrue(r["results"][0]["matches"])

    def test_update_changes_only_the_password_of_the_existing_login(self):
        ask, store = self.vault_host()
        ask(self.req("switch-vault", vault="work")); ask(self.req("unlock-vault", vault="work"))
        (before,) = ask(self.req("candidates", origin="https://gitforge.example", vault="work"))
        self.assertEqual([(c["title"], c["account"]) for c in before["candidates"]], [("Gitforge (work)", "sam@harbor.example")])
        (r,) = ask(self.req("save", origin="https://gitforge.example", vault="work", account="sam@harbor.example", secret="Changed-secret-1"))
        self.assertEqual((r["ok"], r["result"]), (True, "updated"))
        (after,) = ask(self.req("candidates", origin="https://gitforge.example", vault="work"))
        self.assertEqual([(c["title"], c["account"], c["website"]) for c in after["candidates"]], [("Gitforge (work)", "sam@harbor.example", "gitforge.example")],
                         "same title, username and website, still one login")
        (cred,) = ask(self.req("credential", ref=after["candidates"][0]["ref"], origin="https://gitforge.example", vault="work"))
        self.assertEqual(cred["secret"], "Changed-secret-1")
        (r,) = ask(self.req("save", origin="https://gitforge.example", vault="work", account="someone.else@harbor.example", secret="Other-secret-1"))
        self.assertEqual(r["result"], "created")
        self.assertTrue((store / "saved-logins-work.json").exists() and not (store / "saved-logins.json").exists(), "saved into the work vault only")

    def test_save_refuses_a_vault_that_is_not_open_or_not_known(self):
        ask, store = self.vault_host()
        base = {"origin": "https://gitforge.example", "account": "a@b.c", "secret": "Never-saved-1"}
        for vault, error in (("nope", "not-found"), ("x" * 65, "not-found"), ("", "not-found"), (3, "not-found"), ("work", "locked"), ("travel", "not-available")):
            (r,) = ask(self.req("save", vault=vault, **base))
            self.assertEqual((r["ok"], r["error"]), (False, error), repr(vault))
        (r,) = ask(self.req("save", **base))
        self.assertEqual((r["ok"], r["error"]), (False, "not-found"), "a save that names no vault")
        self.assertEqual([p.name for p in store.glob("saved-logins*")], [], "a refused save writes nothing")

    def test_second_open_vault_fills_and_saves_while_another_is_shown(self):
        ask, store = self.vault_host()
        ask(self.req("switch-vault", vault="work")); ask(self.req("unlock-vault", vault="work"))  # Work shown and open, Passwords open too
        (r,) = ask(self.req("vaults"))
        self.assertEqual(self.states(r)[:2], [("Passwords", False, "open", None), ("Work", True, "open", None)])
        (work,) = ask(self.req("candidates", origin="https://gitforge.example", vault="work"))
        self.assertEqual([c["title"] for c in work["candidates"]], ["Gitforge (work)"])
        (mine,) = ask(self.req("search", origin="http://localhost", query="localhost", vault="passwords"))
        self.assertTrue(mine["ok"] and mine["results"], "Passwords is not the shown vault and fills with no unlock")
        (r,) = ask(self.req("save", origin="https://gitforge.example", vault="passwords", account="pat@example.org", secret="Saved-in-passwords-1"))
        self.assertEqual((r["ok"], r["result"], r["vault"]), (True, "created", "passwords"), "a save goes to the chosen vault, not the shown one")
        self.assertTrue((store / "saved-logins.json").exists() and not (store / "saved-logins-work.json").exists())

    def test_vault_locked_between_search_and_fill_answers_a_plain_error(self):
        ask, store = self.vault_host()
        ask(self.req("switch-vault", vault="work")); ask(self.req("unlock-vault", vault="work"))
        (c,) = ask(self.req("candidates", origin="https://gitforge.example", vault="work"))
        ref = c["candidates"][0]["ref"]
        (state,) = [store / "vaults.json"]
        before = state.read_text()
        state.write_text(json.dumps({"active": "work", "open": ["passwords"]}))  # Work locks: the app locked it meanwhile
        (r,) = ask(self.req("credential", ref=ref, origin="https://gitforge.example", vault="work"))
        self.assertEqual((r["ok"], r["error"]), (False, "locked"))
        self.assertTrue(all(k not in r for k in ("secret", "account", "fields")), "no data at all")
        self.assertNotIn("Demo-only", json.dumps(r))
        (r,) = ask(self.req("credential", ref=ref, origin="https://gitforge.example", vault="passwords"))
        self.assertEqual((r["ok"], r["error"]), (False, "not-found"), "another vault never answers in its place")
        self.assertNotIn("Demo-only", state.read_text(), "the state file holds no secret")
        self.assertNotIn("Demo-only", before)

    def test_requests_that_name_no_vault_read_nothing(self):
        for fields in ({"vault": None}, {"vault": ""}, {"vault": "nope"}, {"vault": "x" * 65}, {"vault": 3}):
            for message in (self.req("candidates", origin="http://localhost", **fields), self.req("search", origin="http://localhost", query="localhost", **fields),
                            self.req("credential", ref="0000", origin="http://localhost", **fields)):
                _, (r,) = self.run_host([message])
                self.assertEqual((r["ok"], r["error"]), (False, "not-found"), (message["type"], fields))
        no_vault = {k: v for k, v in self.req("candidates", origin="http://localhost").items() if k != "vault"}
        _, (r,) = self.run_host([no_vault])
        self.assertEqual((r["ok"], r["error"]), (False, "not-found"), "a request with no vault field")

    def test_save_validates_input_and_origin(self):
        for fields in ({"account": "", "secret": "x"}, {"account": "a@b.c", "secret": ""}, {"account": "a" * 321, "secret": "x"},
                       {"account": "a@b.c"}, {"secret": "x"}):
            _, (r,) = self.run_host([self.req("save", origin="http://localhost", vault="passwords", **fields)])
            self.assertEqual((r["ok"], r["error"]), (False, "unsupported"), fields)
        for origin in ("http://insecure.example", "https://user@evil.example", "garbage"):
            _, (r,) = self.run_host([self.req("save", origin=origin, vault="passwords", account="a@b.c", secret="x")])
            self.assertEqual((r["ok"], r["error"]), (False, "forbidden"), origin)

    def test_origin_whose_host_normalizes_to_empty_is_never_fillable(self):
        # `a+b.example.com` passes the URL parser but is not a plain host, so SiteMatch normalizes it to empty.
        origin = "https://a+b.example.com"
        _, (c,) = self.run_host([self.req("candidates", origin=origin)])
        self.assertEqual((c["ok"], c["error"]), (False, "forbidden"))
        _, (s,) = self.run_host([self.req("search", origin=origin, query="localhost")])
        self.assertEqual((s["ok"], s["error"]), (False, "forbidden"))
        _, (found,) = self.run_host([self.req("search", origin="http://localhost:8080", query="localhost")])
        ref = found["results"][0]["ref"]
        for manual in (False, True):
            _, (r,) = self.run_host([self.req("credential", ref=ref, origin=origin, manual=manual)])
            self.assertEqual((r["ok"], r["error"]), (False, "forbidden"), f"manual={manual}")
            self.assertNotIn("secret", r)
        before = (self.store / "saved-logins.json").read_bytes() if (self.store / "saved-logins.json").exists() else None
        _, (r,) = self.run_host([self.req("save", origin=origin, vault="passwords", account="a@b.c", secret="x")])
        self.assertEqual((r["ok"], r["error"]), (False, "forbidden"))
        after = (self.store / "saved-logins.json").read_bytes() if (self.store / "saved-logins.json").exists() else None
        self.assertEqual(before, after, "a refused save writes nothing")

    def test_unknown_ref_and_type(self):
        _, (r,) = self.run_host([self.req("credential", ref="0000", origin="http://localhost")])
        self.assertEqual(r["error"], "not-found")
        _, (r,) = self.run_host([self.req("dump")])
        self.assertEqual(r["error"], "unsupported")

    def test_malformed_input_does_not_crash(self):
        p, _ = self.run_host([], raw=struct.pack("=I", 5) + b"{nope")
        self.assertEqual(p.returncode, 0)
        p, _ = self.run_host([], raw=struct.pack("=I", 0xFFFFFFFF))  # oversized length
        self.assertEqual(p.returncode, 0)
        p, _ = self.run_host([], raw=b"\x01")  # truncated header
        self.assertEqual(p.returncode, 0)


if __name__ == "__main__":
    unittest.main()
