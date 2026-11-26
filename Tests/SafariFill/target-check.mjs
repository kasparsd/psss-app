// What the iPhone and iPad Safari extension is made of and asks for (docs/plans/ios-safari-fill.md, sections 5 and 7). Run by
// scripts/test-safari-fill.sh. Reads the project through `plutil`, changes nothing.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { popupProblems } from "./popup-guard.mjs";

const plist = (path) => JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" }));
const problems = [];
const need = (what, got, wanted) => {
  if (!isDeepStrictEqual(got, wanted)) problems.push(`${what}: expected ${JSON.stringify(wanted)}, found ${JSON.stringify(got)}`);
};

const objects = plist("Psss.xcodeproj/project.pbxproj").objects;
const all = Object.entries(objects);
const target = (name) => all.find(([, o]) => o.isa === "PBXNativeTarget" && o.name === name);
const [extensionID, extension] = target("SafariExtension-iOS");
const configuration = (owner, name) =>
  objects[owner.buildConfigurationList].buildConfigurations.map((id) => objects[id]).find((c) => c.name === name).buildSettings;

// Sources: the grant's folder, the handler and its web files, and from the browser extension the four icons and the three scripts
// the popup shares with it. No vault codec, store or app code.
need("source folders", extension.fileSystemSynchronizedGroups.map((id) => objects[id].path).sort(), ["App/SafariFill", "Extensions/SafariIOS"]);
need("files added one by one",
  all.filter(([, o]) => o.isa === "PBXFileSystemSynchronizedBuildFileExceptionSet" && o.target === extensionID)
    .flatMap(([, o]) => o.membershipExceptions).sort(),
  ["action-16.png", "action-32.png", "display.js", "icon-128.png", "icon-48.png", "origin.js", "page-fill.js"]);
for (const id of extension.buildPhases) need(`${objects[id].isa} entries`, objects[id].files, []);
need("target dependencies", extension.dependencies, []);
need("package products", extension.packageProductDependencies ?? [], []);
for (const name of ["Debug", "Release"]) {
  const settings = configuration(extension, name);
  need(`${name} bundle identifier`, settings.PRODUCT_BUNDLE_IDENTIFIER, "app.psss.Psss.Safari");
  need(`${name} extension-safe API`, settings.APPLICATION_EXTENSION_API_ONLY, "YES");
  need(`${name} linker flags`, settings.OTHER_LDFLAGS, undefined);
}

// The extension is not finished: a Release app must not carry it, and the iPhone and iPad switch
// (`SafariExtensionReminder.extensionWorks`, the `#else` branch) must be off. Switching on is slice 7
// (docs/plans/ios-safari-fill.md): it changes this check together with the switch and the exclusion. Neither alone, nor both,
// passes before that.
const [, app] = target("Psss-iOS");
const reminder = readFileSync("App/Core/SafariExtensionReminder.swift", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const declared = reminder.match(/static\s+(?:let|var)\s+extensionWorks\b.*$/gm) ?? [];
need("the extension switch is declared once for each platform", declared.length, 2);
need("the iPhone and iPad extension switch is off",
  reminder.match(/#if os\(macOS\)[^#]*?#else\s*(static[^\n]*?)[ \t]*\n\s*#endif/)?.[1], "static let extensionWorks = false");
const exclusions = ([id]) => Object.entries(configuration(id, "Release")).filter(([key]) => /^(?:EX|IN)CLUDED_SOURCE_FILE_NAMES/.test(key));
need("Psss-iOS Release excludes the unfinished extension, with no setting that undoes it",
  exclusions([app]), [["EXCLUDED_SOURCE_FILE_NAMES", "SafariExtension-iOS.appex"]]);

// DEBUG compiles the localhost allowance into the handler, so no setting that reaches the extension's Release build may define
// it: the target's, the project's, or the xcconfig files either is based on.
const included = (path) => {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return []; }
  return text.split("\n").flatMap((line) => {
    const include = line.match(/^\s*#include\??\s+"([^"]+)"/);
    if (include) return included(`Configuration/${include[1]}`);
    const setting = line.replace(/\/\/.*$/, "").match(/^\s*([A-Z_0-9]+(?:\[[^\]]*\])*)\s*=(.*)$/);
    return setting ? [[path, setting[1], setting[2]]] : [];
  });
};
const project = objects[plist("Psss.xcodeproj/project.pbxproj").rootObject];
const release = [project, extension].flatMap((owner) => {
  const { buildSettings, baseConfigurationReference: base } = objects[owner.buildConfigurationList].buildConfigurations
    .map((id) => objects[id]).find((c) => c.name === "Release");
  return [
    ...Object.entries(buildSettings).map(([key, value]) => ["project.pbxproj", key, [value].flat().join(" ")]),
    ...(base ? included(`Configuration/${objects[base].path.split("/").pop()}`) : []),
  ];
});
need("settings that define DEBUG in the extension's Release build", release
  .filter(([, key, value]) => /^(SWIFT_ACTIVE_COMPILATION_CONDITIONS|OTHER_SWIFT_FLAGS)(\[|$)/.test(key) &&
    !key.includes("[config=Debug]") && /(^|[\s"']|-D)DEBUG\b/.test(value))
  .map(([where, key]) => `${where}: ${key}`), []);

// The popup: its files, and nothing in them that could keep, send or print a value, draw text as HTML or open another link.
problems.push(...popupProblems());

const manifest = JSON.parse(readFileSync("Extensions/SafariIOS/web/manifest.json", "utf8"));
need("manifest keys", Object.keys(manifest).sort(),
  ["action", "description", "icons", "manifest_version", "name", "permissions", "short_name", "version"]);
need("permissions", manifest.permissions, ["activeTab", "scripting", "nativeMessaging"]);
need("description", manifest.description,
  "Fills out credit cards and addresses in forms, which system AutoFill does not do for Psss. Uses the website URL to check the page, and the form fields to match the values.");

// The wall (docs/autofill.md, "What the Safari extension can reach"): the extension lists the fill Keychain group and its own App
// Group, and neither the vault App Group (itself a Keychain access group) nor the vault key group.
const group = "$(AppIdentifierPrefix)app.psss.safari-fill";
const keyGroup = "$(AppIdentifierPrefix)app.psss.vault-key";
const vaultAppGroup = "group.app.psss";
const safariAppGroup = "group.app.psss.safari";
need("extension entitlements", plist("Configuration/SafariFill-iOS.entitlements"),
  { "com.apple.security.application-groups": [safariAppGroup], "keychain-access-groups": [group] });
const iosApp = plist("Configuration/App-iOS.entitlements");
// The app's own group comes first: an item saved without naming a group must not land where an extension can read it.
need("app Keychain groups", iosApp["keychain-access-groups"], ["$(AppIdentifierPrefix)app.psss.Psss", group, keyGroup]);
need("app App Groups", iosApp["com.apple.security.application-groups"], [vaultAppGroup, safariAppGroup]);
const provider = plist("Configuration/CredentialProvider-iOS.entitlements");
need("AutoFill provider Keychain groups", provider["keychain-access-groups"], ["$(AppIdentifierPrefix)app.psss.Psss.AutoFill", keyGroup]);
need("AutoFill provider App Groups", provider["com.apple.security.application-groups"], [vaultAppGroup]);
// No other target, on either platform, lists a group of the Safari fill or the iPhone and iPad vault key group.
const entitlements = readdirSync("Configuration").filter((name) => name.endsWith(".entitlements"));
const listing = (value) => entitlements.filter((name) =>
  Object.values(plist(`Configuration/${name}`)).flat().includes(value)).sort();
need("targets listing the fill group", listing(group), ["App-iOS.entitlements", "SafariFill-iOS.entitlements"]);
need("targets listing the vault key group", listing(keyGroup), ["App-iOS.entitlements", "CredentialProvider-iOS.entitlements"]);
need("targets listing the vault App Group", listing(vaultAppGroup), ["App-iOS.entitlements", "CredentialProvider-iOS.entitlements"]);
need("targets listing the Safari App Group", listing(safariAppGroup), ["App-iOS.entitlements", "SafariFill-iOS.entitlements"]);
for (const path of ["Configuration/App-Info.plist", "Configuration/SafariFill-iOS-Info.plist"]) {
  need(`${path} access group key`, plist(path).PsssSafariFillAccessGroup, group);
}
for (const path of ["Configuration/App-Info.plist", "Configuration/CredentialProvider-Info.plist"]) {
  need(`${path} vault key group key`, plist(path).PsssVaultKeyAccessGroup, keyGroup);
}
need("the extension is told no vault key group", plist("Configuration/SafariFill-iOS-Info.plist").PsssVaultKeyAccessGroup, undefined);

if (problems.length) {
  console.error(problems.map((p) => `test-safari-fill: ${p}`).join("\n"));
  process.exit(1);
}
