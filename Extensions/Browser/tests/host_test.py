"""Protocol test for the native host: framing, caller check, origin rules and matching.

Run after `build.py host`:  python3 -m unittest discover -s Extensions/Browser/tests
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
BINARY = ROOT / "build" / "browser" / "host" / "psss-native-host"
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


@unittest.skipUnless(BINARY.exists(), "build the host first: Extensions/Browser/build.py host")
class HostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp())
        cls.host = cls.dir / "psss-native-host"
        shutil.copy2(BINARY, cls.host)
        (cls.dir / "allowed-callers.txt").write_text(CALLER + "\npasswords@psss.app\n")
        cls.store = cls.dir / "store"  # saved logins never touch the real prototype directory
        cls.store.mkdir()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir)

    def run_host(self, messages, args=(CALLER,), raw=None):
        data = raw if raw is not None else b"".join(frame(m) for m in messages)
        p = subprocess.run([str(self.host), *args], input=data, capture_output=True, timeout=20,
                           env={**os.environ, "PSSS_PROTOTYPE_DIR": str(self.store)})
        return p, replies(p.stdout)

    def req(self, type, **fields):
        return {"v": 3, "id": "1", "type": type, **fields}

    def test_ping(self):
        _, (r,) = self.run_host([self.req("ping")])
        self.assertTrue(r["ok"]); self.assertEqual(r["id"], "1"); self.assertEqual(r["protocol"], 3)

    def test_refuses_unknown_caller(self):
        p, out = self.run_host([self.req("ping")], args=("chrome-extension://evil/",))
        self.assertEqual(p.returncode, 2); self.assertEqual(out, [])

    def test_accepts_firefox_caller_arguments(self):
        _, (r,) = self.run_host([self.req("ping")], args=("/path/to/manifest.json", "passwords@psss.app"))
        self.assertTrue(r["ok"])

    def test_version_mismatch(self):
        _, (r,) = self.run_host([{"v": 2, "id": "9", "type": "ping"}])
        self.assertEqual((r["ok"], r["error"]), (False, "unsupported"))

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

        def ask(*messages):
            p = subprocess.run([str(self.host), CALLER], input=b"".join(frame(m) for m in messages), capture_output=True, timeout=20,
                               env={**os.environ, "PSSS_PROTOTYPE_DIR": str(store)})
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

    def test_switch_makes_current_without_unlocking(self):
        ask, _ = self.vault_host()
        (r,) = ask(self.req("switch-vault", vault="work"))
        self.assertTrue(r["ok"])
        self.assertEqual(self.states(r)[:2], [("Work", True, "locked", None), ("Passwords", False, "locked", None)])
        (c,) = ask(self.req("candidates", origin="https://gitforge.example"))
        self.assertEqual((c["ok"], c["error"]), (False, "locked"), "nothing is listed until the unlock")
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
        (c,) = ask(self.req("candidates", origin="https://gitforge.example"))
        self.assertTrue(c["ok"], "unlocked: the current vault serves again")
        ask(self.req("switch-vault", vault="ready2"))
        (r,) = ask(self.req("unlock-vault", vault="ok"))
        self.assertEqual((r["ok"], r["error"]), (False, "forbidden"), "unlock applies to the current vault only")
        self.assertEqual(r["vaults"][0]["name"], "Ready too")
        expected = {"cancel": "cancelled", "fail": "failed", "pw": "needs-app", "gone": "not-available", "dl": "not-available", "bad": "not-available"}
        for vault, error in expected.items():
            ask(self.req("switch-vault", vault=vault))
            (r,) = ask(self.req("unlock-vault", vault=vault))
            self.assertEqual((r["ok"], r["error"]), (False, error), vault)
            self.assertTrue(r["vaults"][0]["active"] and r["vaults"][0]["state"] != "open", f"{vault}: still locked, and the reply carries the list")
            self.assertNotIn("secret", json.dumps(r))
        ask(self.req("switch-vault", vault="fwd"))
        (r,) = ask(self.req("unlock-vault", vault="fwd"))
        self.assertEqual((r["ok"], r.get("app")), (True, "opened"))
        self.assertEqual(self.states(r)[0][2], "needs-password", "psss came forward; the vault is still locked")
        (r,) = ask(self.req("unlock-vault", vault="nope"))
        self.assertEqual(r["error"], "not-found")
        for bad in ("", "x" * 65, 7, None):
            (r,) = ask(self.req("unlock-vault", vault=bad))
            self.assertEqual((r["ok"], r["error"]), (False, "not-found"), repr(bad))
        (r,) = ask({"v": 3, "id": "1", "type": "unlock-vault"})
        self.assertEqual(r["error"], "not-found")

    def test_not_available_vault_serves_nothing(self):
        ask, _ = self.vault_host()
        ask(self.req("switch-vault", vault="travel"))
        for message in (self.req("candidates", origin="https://gitforge.example"), self.req("search", origin="https://gitforge.example", query="git"),
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
        (before,) = ask(self.req("candidates", origin="https://gitforge.example"))
        self.assertEqual([(c["title"], c["account"]) for c in before["candidates"]], [("Gitforge (work)", "sam@harbor.example")])
        (r,) = ask(self.req("save", origin="https://gitforge.example", vault="work", account="sam@harbor.example", secret="Changed-secret-1"))
        self.assertEqual((r["ok"], r["result"]), (True, "updated"))
        (after,) = ask(self.req("candidates", origin="https://gitforge.example"))
        self.assertEqual([(c["title"], c["account"], c["website"]) for c in after["candidates"]], [("Gitforge (work)", "sam@harbor.example", "gitforge.example")],
                         "same title, username and website, still one login")
        (cred,) = ask(self.req("credential", ref=after["candidates"][0]["ref"], origin="https://gitforge.example"))
        self.assertEqual(cred["secret"], "Changed-secret-1")
        (r,) = ask(self.req("save", origin="https://gitforge.example", vault="work", account="someone.else@harbor.example", secret="Other-secret-1"))
        self.assertEqual(r["result"], "created")
        self.assertTrue((store / "saved-logins-work.json").exists() and not (store / "saved-logins.json").exists(), "saved into the work vault only")

    def test_save_refuses_a_vault_that_is_not_the_current_open_one(self):
        ask, store = self.vault_host()
        base = {"origin": "https://gitforge.example", "account": "a@b.c", "secret": "Never-saved-1"}
        for vault, error in (("work", "forbidden"), ("nope", "not-found"), ("x" * 65, "not-found"), ("", "not-found"), (3, "not-found")):
            (r,) = ask(self.req("save", vault=vault, **base))
            self.assertEqual((r["ok"], r["error"]), (False, error), repr(vault))
        (r,) = ask(self.req("save", **base))
        self.assertEqual((r["ok"], r["error"]), (False, "not-found"), "a save that names no vault")
        ask(self.req("switch-vault", vault="work"))
        (r,) = ask(self.req("save", vault="work", **base))
        self.assertEqual((r["ok"], r["error"]), (False, "locked"), "the current vault is locked: not written")
        (r,) = ask(self.req("save", vault="passwords", **base))
        self.assertEqual((r["ok"], r["error"]), (False, "locked"), "a popup that is out of date cannot write into the vault the person left")
        self.assertEqual([p.name for p in store.glob("saved-logins*")], [], "a refused save writes nothing")

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
