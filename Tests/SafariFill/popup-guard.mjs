// What the files of the iPhone and iPad popup may contain: nothing that could keep, send or print a value, draw text as
// HTML or open anything but its two links. A guard against mistakes, read from the text: comments are searched too (in the
// shared scripts, all but whole-line `//` comments), and anything not listed as allowed in the HTML is refused. Used by
// target-check.mjs; popup-guard.test.mjs shows what it catches.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const WEB = "Extensions/SafariIOS/web";
const SHARED = "Extensions/Browser/src";
const OWN = ["popup.js", "popup-logic.js"];
const BORROWED = ["page-fill.js", "display.js", "origin.js"];
const LINKS = ["psss://safari-fill", "psss://open"];
const SVG = "http://www.w3.org/2000/svg";
// The one other address in the popup's own scripts: the test that a page is HTTPS.
const HTTPS_TEST = "startsWith('https://')";

// In every script the popup runs, the shared ones included.
const ANY_SCRIPT = [
  /innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|document\.write/,
  /\beval\b|\bFunction\s*\(|\bimportScripts\b|\bimport\s*\(/,
  /\bconsole\b|localStorage|sessionStorage|indexedDB|\bstorage\b|\bcookie\b|clipboard|\bcaches\b/,
  /\bfetch\b|XMLHttpRequest|WebSocket|WebTransport|EventSource|sendBeacon|postMessage|BroadcastChannel|RTCPeerConnection/,
  /\bImage\b|\bAudio\b|\bWorker\b|\bSharedWorker\b|\bnavigator\b/,
  // Setting any of these makes the browser load or go somewhere.
  /\.\s*(?:src|srcset|srcdoc|href|action|formAction|poster|data|background)\s*[-+|?&]?=(?!=)/,
  /\blocation(?:\s*\.\s*href)?\s*=(?!=)|\blocation\s*\.\s*(?:assign|replace|reload)\b/,
  /createElement(?:NS)?\([^)]*['"`](?:img|script|iframe|link|a|form|object|embed|video|audio|source|style|meta|base)['"`]/
];
// In the popup's own scripts, which have no business with the page they are drawn in beyond drawing.
const OWN_SCRIPT = [
  /\blocation\b|\bself\b|\bframes\b|\bparent\s*[.[]/,
  /\bwindow\b(?!\.close\(\))/,
  /\bglobalThis\b(?!\.(?:browser|chrome)\b)/,
  /\bdocument\s*(?:\[|\.(?!getElementById\b|createElement\b))/,
  // The browser's extension API: these four calls, spelled out.
  /\b(?:api|browser|chrome)\s*\[|\bapi\s*(?:\?\.|\.)(?!(?:tabs\.(?:query|update)|scripting\.executeScript|runtime\.sendNativeMessage)\b)/,
  /=\s*api\b/,
  /setAttribute(?:NS)?\((?!\s*'(?:aria-label|aria-hidden|aria-busy|role)')/,
  /\b(?:src|href|srcdoc|srcset|action)\s*:/,
  /['"`]\s*(?:\/\/[a-z0-9]|(?:javascript|data|blob|file|https?|mailto|sms|facetime|shortcuts|itms[a-z-]*):(?!\/\/(?:safari-fill|open)))/i
];

const TAGS = new Set(["!doctype", "html", "head", "meta", "title", "link", "body", "header", "svg", "rect", "g", "path",
  "circle", "div", "select", "main", "script"]);
const ATTRIBUTES = new Set(["html", "lang", "charset", "name", "content", "rel", "href", "class", "xmlns", "viewBox", "role",
  "aria-label", "aria-live", "focusable", "id", "hidden", "src", "x", "y", "width", "height", "rx", "fill", "stroke",
  "stroke-width", "stroke-linejoin", "d", "cx", "cy", "r"]);
const SCRIPTS = ["display.js", "origin.js", "page-fill.js", "popup-logic.js", "popup.js"];

/** The problems of the popup in the checkout at `root`, one line each. */
export function popupProblems(root = ".") {
  const problems = [];
  const need = (what, got, wanted) => {
    if (!isDeepStrictEqual(got, wanted)) problems.push(`${what}: expected ${JSON.stringify(wanted)}, found ${JSON.stringify(got)}`);
  };
  const read = (folder, file) => readFileSync(join(root, folder, file), "utf8");
  const urls = (text) => text.match(/\b[a-z][a-z0-9+.-]*:\/\/[^'"`\s<>)]*/gi) ?? [];

  // Everything in the folder is built into the extension, hidden files too. Finder's own file is not.
  need("web files", readdirSync(join(root, WEB)).filter((file) => file !== ".DS_Store").sort(),
    ["manifest.json", "popup-logic.js", "popup.css", "popup.html", "popup.js"]);

  for (const [folder, file] of [...OWN.map((f) => [WEB, f]), ...BORROWED.map((f) => [SHARED, f])]) {
    // A line that is nothing but a `//` comment holds no code; the shared scripts' own explanations may name these things.
    const text = read(folder, file);
    const code = folder === WEB ? text.replace(HTTPS_TEST, "") : text.replace(/^[ \t]*\/\/.*$/gm, "");
    for (const rule of [...ANY_SCRIPT, ...(folder === WEB ? OWN_SCRIPT : [])]) {
      need(`${file} keeps, sends, prints, parses or opens nothing`, code.match(rule)?.[0], undefined);
    }
    // Links: the popup's two, written once each in its logic.
    need(`${file} links`, urls(code).sort(), file === "popup-logic.js" ? [...LINKS].sort() : []);
    need(`${file} names of the app's address`, (code.match(/psss:/gi) ?? []).length, file === "popup-logic.js" ? LINKS.length : 0);
  }

  const css = read(WEB, "popup.css");
  need("popup.css loads nothing", css.match(/url\s*\(|@import|image-set|[a-z]+:\/\/|\\[0-9a-f]/i)?.[0], undefined);

  const html = read(WEB, "popup.html");
  const tags = [...html.matchAll(/<(\/?)([^\s/<>]+)([^<>]*)>/g)];
  need("popup.html has only whole tags", (html.match(/</g) ?? []).length, tags.length);
  for (const [whole, closing, tag, rest] of tags) {
    if (!TAGS.has(closing ? tag : tag.replace(/^!DOCTYPE$/i, "!doctype"))) problems.push(`popup.html tag not allowed: ${whole}`);
    const attributes = [...rest.matchAll(/([^\s="'/]+)(?:\s*=\s*"([^"]*)")?/g)];
    need(`popup.html attributes of ${whole.slice(0, 40)} are plain`, rest.replace(/([^\s="'/]+)(?:\s*=\s*"[^"]*")?/g, "").replace(/[\s/]/g, ""), "");
    for (const [, name, value] of attributes) {
      if (!ATTRIBUTES.has(name)) problems.push(`popup.html attribute not allowed: ${name} in <${tag}>`);
      if (name === "href") need("popup.html href", [tag, value], ["link", "popup.css"]);
      if (name === "src") need("popup.html src is a script's", [tag, SCRIPTS.includes(value)], ["script", true]);
      if (name === "name") need("popup.html name", value, "viewport");
      if (value && /url\s*\(|[a-z]+:/i.test(value) && !(name === "xmlns" && value === SVG)) {
        problems.push(`popup.html value not allowed: ${name}="${value}"`);
      }
    }
  }
  const scripts = [...html.matchAll(/<script\b([^>]*)>([^<]*)<\/script>/gi)];
  need("popup scripts, in order", scripts.map(([, attributes]) => attributes.trim()), SCRIPTS.map((file) => `src="${file}"`));
  need("inline script text", scripts.map(([, , body]) => body.trim()).join(""), "");
  need("script tags", html.toLowerCase().split("<script").length - 1, scripts.length);
  const logo = (folder) => read(folder, "popup.html").match(/<svg class="logo"[\s\S]*?<\/svg>/)?.[0];
  need("the logo is the browser popup's", logo(WEB), logo(SHARED));
  return problems;
}
