#!/usr/bin/env python3
"""Build, check and package the Psss browser extension and its native host.

Standard library only, so it runs anywhere Python 3 and Xcode's command line tools exist.
Output goes to build/browser (ignored by git). See docs/browser-extension.md.

  build.py check                      validate every target against store requirements
  build.py package [-t TARGET]        stage, validate and zip: chromium, firefox, safari, all
  build.py safari-project             run Apple's packager on the staged Safari extension
  build.py host [--sign IDENTITY]     compile the universal native host
  build.py dev-key                    create a stable dev extension ID for Chromium browsers
  build.py install-host [--uninstall] register the host for installed browsers (development)
  build.py doctor                     report which browsers are registered and whether it will work
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SRC = HERE / "src"
TARGETS = HERE / "targets"
OUT = ROOT / "build" / "browser"
HOST_NAME = "app.psss.passwords"
HOST_DESCRIPTION = "Psss password manager"
TARGET_NAMES = ["chromium", "firefox", "safari"]
EXPECTED_PERMISSIONS = {"activeTab", "scripting", "nativeMessaging"}
ZIP_DATE = (2026, 1, 1, 0, 0, 0)  # fixed, so archives are reproducible

# Where each browser looks for native messaging manifests: `<support dir>/NativeMessagingHosts`.
# "documented" means the vendor says so. "convention" means the browser is a Chromium or Firefox
# derivative that is expected to keep the upstream layout; confirm it per browser before it is
# advertised (`build.py doctor` and the end-to-end tests do that where the browser is installed).
SUPPORT = Path.home() / "Library" / "Application Support"
CHROMIUM_BROWSERS = {
    # name: (support directory, status, app bundle names)
    "Google Chrome": ("Google/Chrome", "documented", ["Google Chrome.app"]),
    "Google Chrome for Testing": ("Google/Chrome for Testing", "documented", []),
    "Chromium": ("Chromium", "documented", ["Chromium.app"]),
    "Microsoft Edge": ("Microsoft Edge", "convention", ["Microsoft Edge.app"]),
    "Brave": ("BraveSoftware/Brave-Browser", "convention", ["Brave Browser.app"]),
    "Vivaldi": ("Vivaldi", "convention", ["Vivaldi.app"]),
    "Arc": ("Arc/User Data", "convention", ["Arc.app"]),
    "Opera": ("com.operasoftware.Opera", "convention", ["Opera.app"]),
}
FIREFOX_BROWSERS = {
    # Firefox and the forks seen so far read the shared Mozilla directory. Zen was verified by
    # removing its own directory and running the end-to-end test (see docs/browser-extension.md).
    "Firefox": ("Mozilla", "documented", ["Firefox.app"]),
    "Zen": ("Mozilla", "verified", ["Zen.app"]),
    "LibreWolf": ("Mozilla", "convention", ["LibreWolf.app"]),
    "Waterfox": ("Mozilla", "convention", ["Waterfox.app"]),
}
APP_DIRS = [Path("/Applications"), Path.home() / "Applications"]


def fail(message: str) -> None:
    sys.exit(f"error: {message}")


# MARK: Manifest ---------------------------------------------------------------------------


def deep_merge(base: dict, overlay: dict) -> dict:
    merged = copy.deepcopy(base)
    for key, value in overlay.items():
        if value is None:  # null in an overlay removes the key, for APIs a browser does not have
            merged.pop(key, None)
        elif isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def manifest_for(target: str, dev: bool = False) -> dict:
    manifest = json.loads((SRC / "manifest.json").read_text())
    manifest = deep_merge(manifest, json.loads((TARGETS / f"{target}.json").read_text()))
    key = OUT / "dev-key.pem"
    if target == "chromium" and dev and key.exists():
        manifest["key"] = base64_public_key(key)
    return manifest


def base64_public_key(pem: Path) -> str:
    import base64
    der = subprocess.run(["openssl", "rsa", "-in", str(pem), "-pubout", "-outform", "DER"],
                         check=True, capture_output=True).stdout
    return base64.b64encode(der).decode()


def chromium_extension_id(pem: Path) -> str:
    """Chromium derives the ID from the public key: first 16 bytes of SHA-256, hex mapped to a-p."""
    import base64
    der = base64.b64decode(base64_public_key(pem))
    return "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(der).hexdigest()[:32])


# MARK: Staging and checks -----------------------------------------------------------------


TEST_HOSTS = ["http://localhost/*", "http://127.0.0.1/*", "http://*.test/*"]


def stage(target: str, dev: bool = False, test: bool = False) -> Path:
    """Copy the source and write the target manifest. A test variant is for automated runs only:
    it adds host permissions for localhost (a popup opened as a tab has no activeTab grant) and a
    hook that points the popup at a tab. It is never archived."""
    dest = OUT / (f"{target}-test" if test else target)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(SRC, dest, ignore=shutil.ignore_patterns("manifest.json", ".DS_Store"))
    manifest = manifest_for(target, dev or test)
    if test:
        manifest["host_permissions"] = TEST_HOSTS
        manifest["permissions"] = [*manifest["permissions"], "privacy"]  # granted up front: automation cannot accept the prompt
        shutil.copy2(HERE / "tests" / "popup-target-hook.js", dest / "test-hook.js")
        popup = (dest / "popup.html").read_text()
        (dest / "popup.html").write_text(popup.replace('<script src="popup.js">', '<script src="test-hook.js"></script>\n  <script src="popup.js">'))
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return dest


def referenced_files(manifest: dict) -> list[str]:
    files = list(manifest.get("icons", {}).values())
    action = manifest.get("action", {})
    files += list(action.get("default_icon", {}).values())
    if "default_popup" in action:
        files.append(action["default_popup"])
    return files


def check(target: str, directory: Path, test: bool = False) -> list[str]:
    """Requirements gathered in docs/browser-extension.md. Returns a list of problems."""
    problems: list[str] = []
    manifest = json.loads((directory / "manifest.json").read_text())

    def need(condition: bool, text: str) -> None:
        if not condition:
            problems.append(f"{target}: {text}")

    need(manifest.get("manifest_version") == 3, "manifest_version must be 3 (Chrome, Edge and AMO require MV3 for new work)")
    need(re.fullmatch(r"\d+(\.\d+){0,3}", manifest.get("version", "")) is not None, "version must be 1 to 4 dot-separated integers")
    need(len(manifest.get("name", "")) <= 75, "name is longer than 75 characters (Chrome Web Store)")
    need(1 <= len(manifest.get("description", "")) <= 132, "description must be 1 to 132 characters (Chrome Web Store)")
    need(test or set(manifest.get("permissions", [])) == EXPECTED_PERMISSIONS,
         f"permissions changed from {sorted(EXPECTED_PERMISSIONS)}: each one needs a store justification, update docs")
    need(not test or set(manifest.get("permissions", [])) == EXPECTED_PERMISSIONS | {"privacy"}, "test builds may only add privacy (granted up front)")
    need(manifest.get("optional_permissions", []) == ([] if target == "safari" else ["privacy"]),
         "optional_permissions must be exactly [privacy] (the save-prompt switch, requested on a click), and absent in Safari")
    for forbidden in ("host_permissions", "content_scripts", "optional_host_permissions", "externally_connectable",
                      "web_accessible_resources", "update_url"):
        if test and forbidden == "host_permissions":
            need(manifest[forbidden] == TEST_HOSTS, "test builds may only add the local test hosts")
            continue
        need(forbidden not in manifest, f"{forbidden} is not allowed in the prototype (least privilege, no self-update)")
    for size in ("16", "32", "48", "128"):
        need(size in manifest.get("icons", {}), f"icons.{size} is missing")
    for name in referenced_files(manifest):
        need((directory / name).is_file(), f"{name} is referenced by the manifest but missing")

    # Chrome Web Store MV3 rule: all logic is in the package. No remote code, no eval.
    for path in directory.rglob("*"):
        if path.suffix in {".js", ".html"}:
            text = path.read_text()
            need(not re.search(r"\beval\s*\(|new\s+Function\s*\(", text), f"{path.name} uses eval or Function")
            need(not re.search(r"<script[^>]+src=[\"']?(https?:)?//", text), f"{path.name} loads a remote script")
            need(not re.search(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", text), f"{path.name} has an inline script (MV3 CSP)")
            need(not re.search(r"\bimport\s*\(\s*[\"']https?:", text), f"{path.name} imports remote code")

    if target == "chromium":
        need("browser_specific_settings" not in manifest, "browser_specific_settings is Firefox only")
        need("minimum_chrome_version" in manifest, "minimum_chrome_version is required to rely on MV3 APIs")
    if target == "firefox":
        gecko = manifest.get("browser_specific_settings", {}).get("gecko", {})
        need(bool(gecko.get("id")), "gecko.id is required for native messaging and stable updates")
        permissions = gecko.get("data_collection_permissions", {})
        need("required" in permissions, "data_collection_permissions is required for new AMO submissions (since 2025-11-03)")
        need(float(gecko.get("strict_min_version", "0").split(".")[0] or 0) >= 140,
             "strict_min_version must be 140 or later for data_collection_permissions")
    return problems


# MARK: Packaging --------------------------------------------------------------------------


def zip_directory(directory: Path, archive: Path) -> None:
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(p for p in directory.rglob("*") if p.is_file()):
            info = zipfile.ZipInfo(path.relative_to(directory).as_posix(), ZIP_DATE)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, path.read_bytes())


ARCHIVES = {
    # One archive serves Chrome Web Store (Chrome, Brave, Arc, Vivaldi, Opera) and Edge Add-ons.
    "chromium": "psss-chromium-{version}.zip",
    # AMO accepts a zip with either extension. .xpi is the conventional name.
    "firefox": "psss-firefox-{version}.xpi",
}


def package(targets: list[str], dev: bool, test: bool = False) -> None:
    problems: list[str] = []
    for target in targets:
        directory = stage(target, dev, test)
        problems += check(target, directory, test)
        if test:
            print(f"{target}: test variant at {directory.relative_to(ROOT)} (never archived)")
            continue
        version = json.loads((directory / "manifest.json").read_text())["version"]
        if dev and target == "chromium":
            print(f"{target}: staged with the dev key at {directory.relative_to(ROOT)} (no archive: dev builds never go to a store)")
        elif target in ARCHIVES and not problems:
            archive = OUT / ARCHIVES[target].format(version=version)
            zip_directory(directory, archive)
            print(f"{target}: {archive.relative_to(ROOT)} ({archive.stat().st_size} bytes)")
        elif target == "safari":
            print(f"{target}: staged at {directory.relative_to(ROOT)}; run `build.py safari-project` for the Xcode project")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        sys.exit(1)


def safari_project() -> None:
    directory = stage("safari")
    problems = check("safari", directory)
    if problems:
        fail("\n".join(problems))
    project = OUT / "safari-xcode"
    command = ["xcrun", "safari-web-extension-packager", str(directory), "--project-location", str(project),
               "--app-name", "Psss Safari", "--bundle-identifier", "local.kdbox.prototype.safari",
               "--swift", "--copy-resources", "--no-open", "--no-prompt", "--force"]
    print("+", " ".join(command))
    result = subprocess.run(command, text=True, capture_output=True)
    print(result.stdout + result.stderr)
    if result.returncode:
        sys.exit(result.returncode)
    # Fail on unsupported-key warnings so a new manifest key cannot silently break Safari.
    if "not supported by your" in result.stdout + result.stderr:
        fail("Safari reports unsupported manifest keys (see above)")


# MARK: Native host ------------------------------------------------------------------------

HOST_SOURCES = [HERE / "host" / "main.swift"] + [
    ROOT / "App" / "Core" / name for name in ("VaultItem.swift", "SampleVault.swift", "SharedVault.swift", "SiteMatch.swift", "PublicSuffixList.swift", "Passkey.swift", "TOTP.swift", "PasswordGenerator.swift", "BrowserPrototypeStore.swift", "BrowserProtocol.swift")
]
HOST_BINARY = OUT / "host" / "psss-native-host"


def build_host(identity: str | None) -> None:
    HOST_BINARY.parent.mkdir(parents=True, exist_ok=True)
    slices = []
    for arch in ("arm64", "x86_64"):
        path = HOST_BINARY.with_name(f"host-{arch}")
        subprocess.run(["swiftc", "-O", "-target", f"{arch}-apple-macos14.0", "-o", str(path),
                        *map(str, HOST_SOURCES)], check=True)
        slices.append(str(path))
    subprocess.run(["lipo", "-create", "-output", str(HOST_BINARY), *slices], check=True)
    for s in slices:
        os.remove(s)
    # Ad hoc by default. A release host needs Developer ID, the hardened runtime and notarization.
    sign = ["codesign", "--force", "--sign", identity or "-"] + (["--options", "runtime", "--timestamp"] if identity else [])
    subprocess.run([*sign, str(HOST_BINARY)], check=True)
    print(f"host: {HOST_BINARY.relative_to(ROOT)}")


def host_manifest(kind: str, callers: list[str]) -> dict:
    base = {"name": HOST_NAME, "description": HOST_DESCRIPTION, "path": str(HOST_BINARY), "type": "stdio"}
    if kind == "chromium":
        base["allowed_origins"] = [f"chrome-extension://{c}/" for c in callers]  # no wildcards allowed
    else:
        base["allowed_extensions"] = callers
    return base


def firefox_id() -> str:
    return json.loads((TARGETS / "firefox.json").read_text())["browser_specific_settings"]["gecko"]["id"]


def chromium_ids(extra: list[str] | None) -> list[str]:
    ids = list(extra or [])
    key = OUT / "dev-key.pem"
    if key.exists():
        ids.append(chromium_extension_id(key))
    ids += [i for i in json.loads((HERE / "extension-ids.json").read_text())["chromium"].values() if i]
    return list(dict.fromkeys(ids))


def installed(app_names: list[str], support: Path) -> bool:
    return support.is_dir() or any((d / n).exists() for d in APP_DIRS for n in app_names)


def install_host(chrome_ids: list[str] | None, uninstall: bool, extra_dirs: list[str] | None) -> None:
    """Writes one manifest per browser that has a profile directory. Any other Chromium or Firefox
    derivative works with --dir (its user-data directory) plus --kind."""
    ids = chromium_ids(chrome_ids)
    if not uninstall:
        if not HOST_BINARY.exists():
            fail("build the host first: build.py host")
        if not ids:
            fail("pass --chrome-id, or run build.py dev-key so a dev ID exists")
        callers = [f"chrome-extension://{i}/" for i in ids] + [firefox_id()]
        (HOST_BINARY.parent / "allowed-callers.txt").write_text("\n".join(callers) + "\n")
    targets = [(n, SUPPORT / d, "chromium", s) for n, (d, s, _) in CHROMIUM_BROWSERS.items()]
    targets.append(("Firefox and forks", SUPPORT / "Mozilla", "firefox", "documented"))
    for entry in extra_dirs or []:
        kind, _, directory = entry.partition("=")
        if kind not in ("chromium", "firefox") or not directory:
            fail("--dir takes KIND=DIRECTORY, for example chromium=\"$HOME/Library/Application Support/Foo\"")
        targets.append((Path(directory).name, Path(directory).expanduser(), kind, "given"))
    for name, directory, kind, status in targets:
        if not directory.is_dir():
            continue
        manifest_path = directory / "NativeMessagingHosts" / f"{HOST_NAME}.json"
        if uninstall:
            if manifest_path.exists():
                manifest_path.unlink()
                print(f"{name}: removed")
            continue
        manifest_path.parent.mkdir(exist_ok=True)
        manifest_path.write_text(json.dumps(host_manifest(kind, ids if kind == "chromium" else [firefox_id()]), indent=2) + "\n")
        print(f"{name}: {manifest_path} ({status} location)")


def doctor() -> int:
    """Reports, per browser, whether it is present and registered, and whether the host answers."""
    problems = 0
    callers = HOST_BINARY.parent / "allowed-callers.txt"
    print(f"host:      {'built' if HOST_BINARY.exists() else 'NOT BUILT (build.py host)'}"
          f"{', callers file present' if callers.exists() else ', callers file missing'}")
    wanted_chromium = set(chromium_ids(None))
    for family, table in (("chromium", CHROMIUM_BROWSERS), ("firefox", FIREFOX_BROWSERS)):
        for name, (directory, status, apps) in table.items():
            support = SUPPORT / directory
            if family == "firefox":
                if not any((d / n).exists() for d in APP_DIRS for n in apps):
                    continue
            elif not installed(apps, support):
                continue
            manifest_path = support / "NativeMessagingHosts" / f"{HOST_NAME}.json"
            state = "not registered"
            if manifest_path.exists():
                m = json.loads(manifest_path.read_text())
                have = {o.removeprefix("chrome-extension://").rstrip("/") for o in m.get("allowed_origins", [])} | set(m.get("allowed_extensions", []))
                want = wanted_chromium if family == "chromium" else {firefox_id()}
                if not Path(m["path"]).exists():
                    state, problems = "registered, but host path is missing", problems + 1
                elif not want <= have:
                    state, problems = "registered, but extension ID is not allowed", problems + 1
                else:
                    state = "registered"
            elif support.is_dir():
                problems += 1
            print(f"{name:26} {state:42} ({status} location)")
    return 1 if problems else 0


def dev_key() -> None:
    key = OUT / "dev-key.pem"
    OUT.mkdir(parents=True, exist_ok=True)
    if not key.exists():
        subprocess.run(["openssl", "genrsa", "-out", str(key), "2048"], check=True, capture_output=True)
    print(f"dev extension ID: {chromium_extension_id(key)}")
    print("Package with `build.py package -t chromium --dev` and load build/browser/chromium unpacked.")


# MARK: Placeholder icons ------------------------------------------------------------------


def png(size: int) -> bytes:
    """A neutral rounded square with a keyhole, drawn with 4x supersampling. Replace with real art."""
    def inside(x: float, y: float) -> tuple[bool, bool]:
        r = 0.22
        cx, cy = min(max(x, r), 1 - r), min(max(y, r), 1 - r)
        box = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
        ring = (x - 0.5) ** 2 + (y - 0.40) ** 2 <= 0.12 ** 2
        stem = 0.46 <= x <= 0.54 and 0.40 <= y <= 0.72
        return box, ring or stem

    rows = bytearray()
    for py in range(size):
        rows.append(0)
        for px in range(size):
            cover = hole = 0
            for sy in range(4):
                for sx in range(4):
                    box, key = inside((px + (sx + .5) / 4) / size, (py + (sy + .5) / 4) / size)
                    cover += box
                    hole += box and key
            a = cover / 16
            t = hole / cover if cover else 0
            g = round(0x2c * (1 - t) + 0xff * t)
            rows += bytes([g, g, round(0x2e * (1 - t) + 0xff * t), round(255 * a)])

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


def icons() -> None:
    for size in (16, 32, 48, 128):
        (SRC / f"icon-{size}.png").write_bytes(png(size))
    print("icons: src/icon-{16,32,48,128}.png")


# MARK: CLI --------------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("check", "package"):
        p = sub.add_parser(name)
        p.add_argument("-t", "--target", choices=[*TARGET_NAMES, "all"], default="all")
        p.add_argument("--dev", action="store_true", help="add the dev key to the Chromium manifest (never for store uploads)")
        p.add_argument("--test", action="store_true", help="build the automated-test variant (localhost host permissions and a hook; never archived)")
    sub.add_parser("safari-project")
    h = sub.add_parser("host")
    h.add_argument("--sign", metavar="IDENTITY")
    sub.add_parser("dev-key")
    i = sub.add_parser("install-host")
    i.add_argument("--chrome-id", action="append", help="extra Chromium extension ID to allow (repeatable)")
    i.add_argument("--dir", action="append", metavar="KIND=DIRECTORY", help="register in another Chromium or Firefox derivative's user directory")
    i.add_argument("--uninstall", action="store_true")
    sub.add_parser("doctor")
    sub.add_parser("icons")
    args = parser.parse_args()

    if args.command in ("check", "package"):
        targets = TARGET_NAMES if args.target == "all" else [args.target]
        if args.command == "check":
            problems = [p for t in targets for p in check(t, stage(t, args.dev, args.test), args.test)]
            print("\n".join(problems) if problems else f"ok: {', '.join(targets)}")
            sys.exit(1 if problems else 0)
        package(targets, args.dev, args.test)
    elif args.command == "safari-project":
        safari_project()
    elif args.command == "host":
        build_host(args.sign)
    elif args.command == "dev-key":
        dev_key()
    elif args.command == "install-host":
        install_host(args.chrome_id, args.uninstall, args.dir)
    elif args.command == "doctor":
        sys.exit(doctor())
    elif args.command == "icons":
        icons()


if __name__ == "__main__":
    main()
