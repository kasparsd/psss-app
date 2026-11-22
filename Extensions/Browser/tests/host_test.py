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
        return {"v": 1, "id": "1", "type": type, **fields}

    def test_ping(self):
        _, (r,) = self.run_host([self.req("ping")])
        self.assertTrue(r["ok"]); self.assertEqual(r["id"], "1"); self.assertEqual(r["protocol"], 1)

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
        self.assertEqual(set(r["candidates"][0]), {"ref", "title", "account"})  # no secret in the list

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
        self.assertEqual(set(hit), {"ref", "title", "account", "website", "matches"})  # never a secret
        self.assertFalse(hit["matches"], "a login for localhost does not belong to 127.0.0.1")
        _, (r,) = self.run_host([self.req("search", origin="http://localhost:8080", query="localhost")])
        self.assertTrue(r["results"][0]["matches"])

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
        _, (r,) = self.run_host([self.req("save", origin=origin, account="new.person@example.net", secret="First-secret-1")])
        self.assertEqual((r["ok"], r["result"]), (True, "created"))
        _, (r,) = self.run_host([self.req("save", origin=origin, account="new.person@example.net", secret="Second-secret-2")])
        self.assertEqual((r["ok"], r["result"]), (True, "updated"))
        saved = json.loads((self.store / "saved-logins.json").read_text())
        mine = [i for i in saved if i["account"] == "new.person@example.net"]
        self.assertEqual(len(mine), 1, "an update must not duplicate the login")
        self.assertEqual((mine[0]["website"], mine[0]["secret"]), ("localhost", "Second-secret-2"))
        _, (r,) = self.run_host([self.req("search", origin=origin, query="new.person")])
        self.assertTrue(r["results"][0]["matches"])

    def test_save_validates_input_and_origin(self):
        for fields in ({"account": "", "secret": "x"}, {"account": "a@b.c", "secret": ""}, {"account": "a" * 321, "secret": "x"},
                       {"account": "a@b.c"}, {"secret": "x"}):
            _, (r,) = self.run_host([self.req("save", origin="http://localhost", **fields)])
            self.assertEqual((r["ok"], r["error"]), (False, "unsupported"), fields)
        for origin in ("http://insecure.example", "https://user@evil.example", "garbage"):
            _, (r,) = self.run_host([self.req("save", origin=origin, account="a@b.c", secret="x")])
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
        _, (r,) = self.run_host([self.req("save", origin=origin, account="a@b.c", secret="x")])
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
