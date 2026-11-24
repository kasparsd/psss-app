import test from 'node:test';
import assert from 'node:assert/strict';
import origin from '../src/origin.js';

const { OriginPolicy } = origin;

test('fills on https and returns only the origin', () => {
  assert.equal(OriginPolicy.fillableOrigin('https://example.com/login?next=/a#x'), 'https://example.com');
  assert.equal(OriginPolicy.fillableOrigin('https://example.com:8443/'), 'https://example.com:8443');
});

test('allows plain http only for localhost', () => {
  assert.equal(OriginPolicy.fillableOrigin('http://localhost:8080/login.html'), 'http://localhost:8080');
  assert.equal(OriginPolicy.fillableOrigin('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.equal(OriginPolicy.fillableOrigin('http://example.com/'), null);
  assert.equal(OriginPolicy.fillableOrigin('http://localhost.evil.example/'), null);
});

test('refuses other schemes, credentials in the URL and garbage', () => {
  for (const url of ['file:///etc/passwd', 'chrome://settings', 'about:blank', 'javascript:alert(1)',
                     'https://paypal.com@evil.example/', 'https://user:pw@example.com/', '', 'not a url', undefined]) {
    assert.equal(OriginPolicy.fillableOrigin(url), null, String(url));
  }
});

test('sameOrigin detects navigation between list and fill', () => {
  assert.ok(OriginPolicy.sameOrigin('https://a.example/x', 'https://a.example/y'));
  assert.ok(!OriginPolicy.sameOrigin('https://a.example/', 'https://b.example/'));
  assert.ok(!OriginPolicy.sameOrigin('https://a.example/', 'http://a.example/'));
  assert.ok(!OriginPolicy.sameOrigin('https://a.example/', 'about:blank'));
});
