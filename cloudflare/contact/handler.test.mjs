import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleContact, composeMessage } from './handler.mjs';

const valid = { name: 'Website visitor', email: 'visitor@example.com', topic: 'A suggestion', message: 'A calendar question. Thank you — ḥꜣw 🌙', device: 'Mobile browser', website: '' };
function request(data = valid, { method = 'POST', headers = {}, url = 'https://thisishaw.com/api/contact' } = {}) {
  return new Request(url, { method, headers: { Origin: 'https://thisishaw.com', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers }, ...(method === 'POST' ? { body: typeof data === 'string' ? data : JSON.stringify(data) } : {}) });
}
function harness(overrides = {}) {
  const sent = [], limited = [];
  return { sent, limited, env: { send: async message => { sent.push(message); }, limiter: { limit: async input => { limited.push(input); return { success: true }; } }, version: 'a'.repeat(40), ...overrides } };
}

test('valid submission sends only to info and preserves Unicode in a plain-text body', async () => {
  const { env, sent } = harness(); const res = await handleContact(request(), env);
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'info@thisishaw.com');
  assert.equal(sent[0].from, 'website@contact.thisishaw.com');
  assert.match(sent[0].raw, /Reply-To: visitor@example.com\r\n/);
  const body = Buffer.from(sent[0].raw.split('\r\n\r\n')[1].replaceAll('\r\n', ''), 'base64').toString('utf8');
  assert.match(body, /ḥꜣw 🌙/); assert.match(body, /Device \/ app version: Mobile browser/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Haw-Contact-Commit'), 'a'.repeat(40));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('success waits for delivery acknowledgement', async () => {
  let finish; let completed = false;
  const { env } = harness({ send: () => new Promise(resolve => { finish = resolve; }) });
  const pending = handleContact(request(), env).then(result => { completed = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false); assert.equal(typeof finish, 'function');
  finish(); assert.equal((await pending).status, 200);
});

test('delivery failure never returns success', async () => {
  const { env } = harness({ send: async () => { throw new Error('rejected'); } });
  const res = await handleContact(request(), env);
  assert.equal(res.status, 503); assert.deepEqual(await res.json(), { ok: false, code: 'delivery_unavailable' });
});

test('invalid, oversized, injected, and bot submissions never send mail', async () => {
  const cases = [null, [], '{bad', { ...valid, message: '  \n ' }, { ...valid, topic: 'Injected subject' },
    { ...valid, email: 'visitor@example.com\r\nBcc: other@example.com' }, { ...valid, email: 'a@localhost' },
    { ...valid, website: 'https://spam.example' }, { ...valid, to: 'other@example.com' },
    { ...valid, name: 'x'.repeat(121) }, { ...valid, device: 7 }, { ...valid, message: 'x'.repeat(6001) },
    { ...valid, email: null }, { ...valid, constructor: 'unexpected' }, JSON.parse('{"__proto__":"unexpected"}')];
  for (const data of cases) {
    const { env, sent } = harness(); const res = await handleContact(request(data), env);
    assert.equal(res.status, 400, JSON.stringify(data)); assert.equal(sent.length, 0);
  }
  const { env, sent } = harness();
  assert.equal((await handleContact(request('x'.repeat(32769)), env)).status, 413); assert.equal(sent.length, 0);
});

test('bounded Unicode messages and omitted optional fields remain valid', async () => {
  const { env, sent } = harness();
  const res = await handleContact(request({ email: valid.email, topic: valid.topic, message: '月'.repeat(6000) }), env);
  assert.equal(res.status, 200); assert.equal(sent.length, 1);
});

test('method, origin, path, and content-type boundaries never send mail', async () => {
  const cases = [
    [{ method: 'GET' }, 405], [{ method: 'OPTIONS' }, 405],
    [{ url: 'https://thisishaw.com/' }, 404], [{ url: 'https://kemet.pages.dev/api/contact' }, 404],
    [{ url: 'https://thisishaw.com/api/contact?to=other@example.com' }, 404],
    [{ headers: { Origin: 'https://evil.example' } }, 403], [{ headers: { Origin: '' } }, 403],
    [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415], [{ headers: { 'CF-Connecting-IP': '' } }, 403],
  ];
  for (const [options, status] of cases) {
    const { env, sent } = harness(); const res = await handleContact(request(valid, options), env);
    assert.equal(res.status, status, JSON.stringify(options)); assert.equal(sent.length, 0);
  }
});

test('rate limiting and missing or failing bindings fail closed', async () => {
  const { env, sent } = harness({ limiter: { limit: async () => ({ success: false }) } });
  const limited = await handleContact(request(), env);
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60'); assert.equal(sent.length, 0);
  for (const overrides of [{ limiter: undefined }, { send: undefined }, { limiter: { limit: async () => { throw new Error('offline'); } } }]) {
    const item = harness(overrides); assert.equal((await handleContact(request(), item.env)).status, 503); assert.equal(item.sent.length, 0);
  }
});

test('deployment owns only the contact route and fixed recipient; static and app origins stay separate', () => {
  const config = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.routes, [{ pattern: 'thisishaw.com/api/contact', zone_id: 'd47d4496edf9b7230e0e75e20fbe609c' }]);
  assert.deepEqual(config.send_email, [{ name: 'CONTACT_EMAIL', destination_address: 'info@thisishaw.com' }]);
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.equal(config.observability.enabled, false);
  const entry = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  assert.match(entry, /handleContact\(request/); assert.match(entry, /new EmailMessage\(message.from, message.to, message.raw\)/);
});


test('long UTF-8 subjects use bounded encoded words without splitting code points', () => {
  const topic = 'Sharing & practicing together';
  const raw = composeMessage({ ...valid, topic }).raw;
  const subject = raw.match(/Subject: (.*(?:\r\n [^\r\n]*)*)/)[1];
  const words = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  assert.ok(words.length > 1);
  assert.ok(words.every(word => word[0].length <= 75));
  assert.equal(words.map(word => Buffer.from(word[1], 'base64').toString('utf8')).join(''), 'ḥꜣw website — ' + topic);
});
