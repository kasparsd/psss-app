// What the iPhone and iPad Safari extension is made of and asks for (docs/plans/ios-safari-fill.md, sections 5 and 7). Run by
// scripts/test-safari-fill.sh. Reads the project through `plutil`, changes nothing.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

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

// Sources: the grant's folder, the handler and its web files, and the four icons. No vault codec, store or app code.
need("source folders", extension.fileSystemSynchronizedGroups.map((id) => objects[id].path).sort(), ["App/SafariFill", "Extensions/SafariIOS"]);
need("files added one by one",
  all.filter(([, o]) => o.isa === "PBXFileSystemSynchronizedBuildFileExceptionSet" && o.target === extensionID)
    .flatMap(([, o]) => o.membershipExceptions).sort(),
  ["action-16.png", "action-32.png", "icon-128.png", "icon-48.png"]);
for (const id of extension.buildPhases) need(`${objects[id].isa} entries`, objects[id].files, []);
need("target dependencies", extension.dependencies, []);
need("package products", extension.packageProductDependencies ?? [], []);
for (const name of ["Debug", "Release"]) {
  const settings = configuration(extension, name);
  need(`${name} bundle identifier`, settings.PRODUCT_BUNDLE_IDENTIFIER, "app.psss.Psss.Safari");
  need(`${name} extension-safe API`, settings.APPLICATION_EXTENSION_API_ONLY, "YES");
  need(`${name} linker flags`, settings.OTHER_LDFLAGS, undefined);
}

// While the extension has no popup script it cannot fill, and a Release app must not carry it.
const unfinished = !readdirSync("Extensions/SafariIOS/web").some((file) => file.endsWith(".js"));
const [, app] = target("Psss-iOS");
if (unfinished) need("Psss-iOS Release excludes the unfinished extension", configuration(app, "Release").EXCLUDED_SOURCE_FILE_NAMES, "SafariExtension-iOS.appex");

const manifest = JSON.parse(readFileSync("Extensions/SafariIOS/web/manifest.json", "utf8"));
need("manifest keys", Object.keys(manifest).sort(),
  ["action", "description", "icons", "manifest_version", "name", "permissions", "short_name", "version"]);
need("permissions", manifest.permissions, ["activeTab", "scripting", "nativeMessaging"]);
need("description", manifest.description,
  "Fills out credit cards and addresses in forms, which system AutoFill does not do for Psss. Uses the website URL to check the page, and the form fields to match the values.");

const group = "$(AppIdentifierPrefix)app.psss.safari-fill";
need("extension entitlements", plist("Configuration/SafariFill-iOS.entitlements"),
  { "com.apple.security.application-groups": ["group.app.psss"], "keychain-access-groups": [group] });
// The app's own group comes first: an item saved without naming a group must not land where the extension can read it.
need("app Keychain groups", plist("Configuration/App-iOS.entitlements")["keychain-access-groups"],
  ["$(AppIdentifierPrefix)app.psss.Psss", group]);
for (const path of ["Configuration/CredentialProvider-iOS.entitlements", "Configuration/CredentialProvider-macOS.entitlements",
  "Configuration/App-macOS.entitlements", "Configuration/SafariExtension-macOS.entitlements"]) {
  need(`${path} must not list the fill group`, readFileSync(path, "utf8").includes("safari-fill"), false);
}
for (const path of ["Configuration/App-Info.plist", "Configuration/SafariFill-iOS-Info.plist"]) {
  need(`${path} access group key`, plist(path).PsssSafariFillAccessGroup, group);
}

if (problems.length) {
  console.error(problems.map((p) => `test-safari-fill: ${p}`).join("\n"));
  process.exit(1);
}
