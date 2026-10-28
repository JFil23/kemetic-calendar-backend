const ORIGIN = 'https://thisishaw.com';
const SENDER = 'website@contact.thisishaw.com';
const RECIPIENT = 'info@thisishaw.com';
const MAX_BODY_BYTES = 32768;
const TOPICS = new Set([
  'Something isn’t working', 'My account', 'Flows & the calendar',
  'Sharing & practicing together', 'A suggestion', 'Something else',
]);
const LIMITS = { name: 120, email: 254, topic: 80, message: 6000, device: 200, website: 200 };

function response(status, code, version = '', headers = {}) {
  const values = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...headers,
  };
  if (/^[a-f0-9]{40}$/.test(version)) values['X-Haw-Contact-Commit'] = version;
  return new Response(JSON.stringify({ ok: status === 200, ...(code ? { code } : {}) }), { status, headers: values });
}

async function readSubmission(request) {
  const length = Number(request.headers.get('Content-Length'));
  if (length > MAX_BODY_BYTES) throw 413;
  if (!request.body) throw 400;
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw 413; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw 400; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw 400;
  if (Object.keys(data).some(key => !Object.hasOwn(LIMITS, key))) throw 400;
  const fields = {};
  for (const [name, limit] of Object.entries(LIMITS)) {
    if (data[name] != null && typeof data[name] !== 'string') throw 400;
    fields[name] = (data[name] || '').trim();
    if (fields[name].length > limit || /[\u0000\u000b\u000c]/.test(fields[name])) throw 400;
  }
  if (!fields.message || !TOPICS.has(fields.topic) || fields.website) throw 400;
  // Reply-To is the only visitor-controlled header. Restrict it to one address.
  if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(fields.email)) throw 400;
  return fields;
}

function base64(text) {
  return btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));
}

function encodedWords(text) {
  const words = []; let chunk = '', size = 0;
  for (const character of text) {
    const bytes = new TextEncoder().encode(character).length;
    if (size + bytes > 39) { words.push('=?UTF-8?B?' + base64(chunk) + '?='); chunk = ''; size = 0; }
    chunk += character; size += bytes;
  }
  if (chunk) words.push('=?UTF-8?B?' + base64(chunk) + '?=');
  return words.join('\r\n ');
}

export function composeMessage(fields) {
  const subject = encodedWords('ḥꜣw website — ' + fields.topic);
  const lines = [
    `Topic: ${fields.topic}`, `Name: ${fields.name || 'Not provided'}`,
    `Reply to: ${fields.email}`,
    ...(fields.device ? [`Device / app version: ${fields.device}`] : []),
    '', fields.message,
  ];
  const body = base64(lines.join('\n')).match(/.{1,76}/g).join('\r\n');
  const raw = [
    `From: =?UTF-8?B?${base64('ḥꜣw support')}?= <${SENDER}>`,
    `To: ${RECIPIENT}`, `Reply-To: ${fields.email}`, `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@contact.thisishaw.com>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', body, '',
  ].join('\r\n');
  return { from: SENDER, to: RECIPIENT, raw };
}

export async function handleContact(request, { send, limiter, version = '' }) {
  const url = new URL(request.url);
  if (url.origin !== ORIGIN || url.pathname !== '/api/contact' || url.search) return response(404, 'not_found', version);
  if (request.method !== 'POST') return response(405, 'method_not_allowed', version, { Allow: 'POST' });
  if (request.headers.get('Origin') !== ORIGIN ||
      ![null, 'same-origin'].includes(request.headers.get('Sec-Fetch-Site'))) return response(403, 'origin_not_allowed', version);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response(415, 'unsupported_content_type', version);
  if (typeof send !== 'function' || typeof limiter?.limit !== 'function') return response(503, 'delivery_unavailable', version);
  try {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return response(403, 'request_not_allowed', version);
    const { success } = await limiter.limit({ key: 'contact:' + ip });
    if (!success) return response(429, 'rate_limited', version, { 'Retry-After': '60' });
  } catch { return response(503, 'delivery_unavailable', version); }
  let fields;
  try { fields = await readSubmission(request); }
  catch (error) { return response(error === 413 ? 413 : 400, 'invalid_submission', version); }
  try {
    // The response is held until the email service acknowledges acceptance.
    await send(composeMessage(fields));
    return response(200, '', version);
  } catch { return response(503, 'delivery_unavailable', version); }
}
