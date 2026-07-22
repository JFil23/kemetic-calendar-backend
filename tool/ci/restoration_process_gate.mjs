#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument near ${key ?? '<end>'}`);
    }
    values[key.slice(2)] = value;
  }
  for (const required of [
    'web-root',
    'results-dir',
    'build-id',
    'manifest',
    'process-unit',
  ]) {
    if (!values[required]) throw new Error(`missing --${required}`);
  }
  return values;
}

const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256Json(value) {
  return sha256(Buffer.from(JSON.stringify(value)));
}

const sentinelKey = 'lock-gate.profile-sentinel.v1';
const neutralStorageProbePath = '/__lock_gate_storage_probe.html';
const neutralStorageProbeTitle = 'LOCK_GATE_NEUTRAL_STORAGE_PROBE';
const restorationAuthorityContract = Object.freeze({
  databaseName: 'kemetic.restoration.authority.v1',
  databaseVersion: 1,
  storeName: 'snapshots',
  lastActiveUserKey: 'last_user',
  latestKeyPrefix: 'latest:',
  authoritySchemaVersion: 1,
  source: {
    platform:
      'mobile/lib/services/restoration_durable_store_web.dart:9-17,53-82,135-203',
    envelope: 'mobile/lib/services/restoration_durable_store.dart:80-206,215-237',
    precedence: 'mobile/lib/services/app_restoration_service.dart:1798-1918,2433-2489',
  },
  semantics: {
    validAcknowledgedEnvelopeSuppressesLegacyCandidates: true,
    legacyMirrorsWrittenAfterAcknowledgedCommit: true,
    newerOrEqualAcknowledgedGenerationRejectsOlderWrite: true,
    writeAcknowledgedOn: 'IDBTransaction.oncomplete',
    legacyMirrorDriftIsDiagnosticOnlyAfterAuthorityAndApplicationRestorePass: true,
  },
});

function authorityLatestKey(account) {
  return `${restorationAuthorityContract.latestKeyPrefix}${account.trim()}`;
}

export function restorationEnvelopeIntegrity(raw) {
  const payload = JSON.stringify({
    authoritySchemaVersion: raw.authoritySchemaVersion,
    snapshotSchemaVersion: raw.snapshotSchemaVersion,
    userId: raw.userId,
    windowId: raw.windowId,
    generation: raw.generation,
    snapshotJson: raw.snapshotJson,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    // Match the deployed Dart-to-JavaScript implementation exactly. The web
    // compiler emits unsigned truncation after JavaScript-number multiplication
    // for DurableRestorationEnvelope._integrityFor; Math.imul produces a
    // different value and would reject production web envelopes.
    hash = (((hash ^ payload.charCodeAt(index)) >>> 0) * 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function parseCalendarView(value) {
  const match = /^(-?\d+)-(\d+)-(\d+)$/.exec(value ?? '');
  if (!match) return null;
  return {
    kYear: Number(match[1]),
    kMonth: Number(match[2]),
    kDay: Number(match[3]),
  };
}

export function validateRestorationAuthorityRead(
  authorityRead,
  { account, expectedRoute, expectedCalendarView },
) {
  if (
    authorityRead?.databaseName !== restorationAuthorityContract.databaseName ||
    authorityRead?.databaseVersion !== restorationAuthorityContract.databaseVersion ||
    authorityRead?.storeName !== restorationAuthorityContract.storeName ||
    authorityRead?.transactionMode !== 'readonly' ||
    authorityRead?.databasePresent !== true ||
    authorityRead?.storePresent !== true ||
    authorityRead?.readCompleted !== true ||
    authorityRead?.writesAttempted !== false
  ) {
    throw new Error(
      `invalid restoration authority reader context: ${JSON.stringify(authorityRead)}`,
    );
  }
  const expectedLatestKey = authorityLatestKey(account);
  if (
    authorityRead.lastActiveUserKey !== restorationAuthorityContract.lastActiveUserKey ||
    authorityRead.latestEnvelopeKey !== expectedLatestKey ||
    authorityRead.lastActiveUserId !== account
  ) {
    throw new Error(
      `restoration authority principal/key mismatch: ${JSON.stringify({
        account,
        lastActiveUserKey: authorityRead.lastActiveUserKey,
        latestEnvelopeKey: authorityRead.latestEnvelopeKey,
        lastActiveUserId: authorityRead.lastActiveUserId,
      })}`,
    );
  }
  if (
    typeof authorityRead.latestEnvelope !== 'string' ||
    authorityRead.latestEnvelope.trim() === ''
  ) {
    throw new Error('acknowledged restoration envelope is missing');
  }
  let envelope;
  let snapshot;
  try {
    envelope = JSON.parse(authorityRead.latestEnvelope);
    snapshot = JSON.parse(envelope.snapshotJson);
  } catch (error) {
    throw new Error(`acknowledged restoration envelope is malformed: ${error}`);
  }
  if (
    envelope.authoritySchemaVersion !==
      restorationAuthorityContract.authoritySchemaVersion ||
    !Number.isInteger(envelope.snapshotSchemaVersion) ||
    envelope.snapshotSchemaVersion < 1 ||
    envelope.userId !== account ||
    typeof envelope.windowId !== 'string' ||
    envelope.windowId.trim() === '' ||
    !Number.isInteger(envelope.generation) ||
    envelope.generation < 0 ||
    typeof envelope.snapshotJson !== 'string' ||
    typeof envelope.integrity !== 'string'
  ) {
    throw new Error(
      `acknowledged restoration envelope schema/binding is invalid: ${JSON.stringify(envelope)}`,
    );
  }
  const expectedIntegrity = restorationEnvelopeIntegrity(envelope);
  if (envelope.integrity !== expectedIntegrity) {
    throw new Error(
      `acknowledged restoration envelope integrity mismatch: ` +
        `expected=${expectedIntegrity} observed=${envelope.integrity}`,
    );
  }
  if (
    snapshot?.schemaVersion !== envelope.snapshotSchemaVersion ||
    snapshot?.userId !== account ||
    snapshot?.userId !== envelope.userId ||
    snapshot?.windowId !== envelope.windowId ||
    snapshot?.updatedAtMs !== envelope.generation ||
    snapshot?.routeLocation !== expectedRoute
  ) {
    throw new Error(
      `acknowledged snapshot principal/generation/route mismatch: ${JSON.stringify({
        expectedAccount: account,
        expectedRoute,
        envelopeUserId: envelope.userId,
        envelopeWindowId: envelope.windowId,
        envelopeGeneration: envelope.generation,
        snapshotUserId: snapshot?.userId,
        snapshotWindowId: snapshot?.windowId,
        snapshotUpdatedAtMs: snapshot?.updatedAtMs,
        snapshotRoute: snapshot?.routeLocation,
      })}`,
    );
  }
  const launchMetadata = snapshot.launchRouteMetadata;
  if (
    launchMetadata?.routeClass !== 'durablePrimary' ||
    launchMetadata?.canonicalRoute !== expectedRoute ||
    launchMetadata?.canRestoreAsSurface !== true
  ) {
    throw new Error(
      `acknowledged snapshot lacks durable primary route metadata: ` +
        JSON.stringify(launchMetadata),
    );
  }
  const calendar = snapshot.calendar;
  const expectedCalendar =
    expectedCalendarView === undefined
      ? undefined
      : parseCalendarView(expectedCalendarView);
  if (
    (expectedCalendarView !== undefined && !expectedCalendar) ||
    !calendar ||
    !Number.isInteger(calendar.kYear) ||
    !Number.isInteger(calendar.kMonth) ||
    !Number.isInteger(calendar.kDay) ||
    (expectedCalendar !== undefined &&
      (calendar.kYear !== expectedCalendar.kYear ||
        calendar.kMonth !== expectedCalendar.kMonth ||
        calendar.kDay !== expectedCalendar.kDay)) ||
    typeof calendar.anchorTarget !== 'string' ||
    calendar.anchorTarget.trim() === '' ||
    !Number.isFinite(calendar.anchorAlignment) ||
    !Number.isFinite(calendar.viewportHeight) ||
    !Number.isInteger(calendar.layoutRevision)
  ) {
    throw new Error(
      `acknowledged snapshot Calendar anchor/placement mismatch: ${JSON.stringify({
        expectedCalendar,
        calendar,
      })}`,
    );
  }
  return {
    databaseName: authorityRead.databaseName,
    databaseVersion: authorityRead.databaseVersion,
    storeName: authorityRead.storeName,
    lastActiveUserKey: authorityRead.lastActiveUserKey,
    latestEnvelopeKey: authorityRead.latestEnvelopeKey,
    account,
    windowId: envelope.windowId,
    generation: envelope.generation,
    routeLocation: snapshot.routeLocation,
    launchRouteMetadata: launchMetadata,
    calendar,
    integrity: envelope.integrity,
    envelopeSha256: sha256(Buffer.from(authorityRead.latestEnvelope)),
    commitContract: {
      explicitEnvelopeCommitMetadata: false,
      productionAcknowledgement: 'IDBTransaction.oncomplete',
      postTerminationReadCompleted: authorityRead.readCompleted,
    },
  };
}

export function compareRestorationAuthorityReads(observed, expected, description) {
  const changedFields = [
    'databaseName',
    'databaseVersion',
    'storeName',
    'lastActiveUserKey',
    'latestEnvelopeKey',
    'lastActiveUserId',
    'latestEnvelope',
  ].filter((field) => observed?.[field] !== expected?.[field]);
  const comparison = {
    description,
    changedFields,
    exact: changedFields.length === 0,
    expectedEnvelopeSha256:
      typeof expected?.latestEnvelope === 'string'
        ? sha256(Buffer.from(expected.latestEnvelope))
        : null,
    observedEnvelopeSha256:
      typeof observed?.latestEnvelope === 'string'
        ? sha256(Buffer.from(observed.latestEnvelope))
        : null,
  };
  if (!comparison.exact) {
    throw new Error(
      `${description} did not preserve the exact acknowledged authority: ` +
        JSON.stringify({ changedFields }),
    );
  }
  return comparison;
}

export function legacyMirrorDiagnostics(storage, expected) {
  const expectedKeys = Object.keys(expected);
  const missingKeys = expectedKeys.filter((key) => !(key in storage));
  const changedKeys = expectedKeys.filter(
    (key) => key in storage && storage[key] !== expected[key],
  );
  return {
    authority: 'diagnostic-only',
    mayDifferWithoutFailingGate: true,
    expectedKeys,
    missingKeys,
    changedKeys,
    exact: missingKeys.length === 0 && changedKeys.length === 0,
    expectedValuesSha256: sha256Json(expected),
    observedValuesSha256: sha256Json(
      Object.fromEntries(expectedKeys.map((key) => [key, storage[key]])),
    ),
  };
}

function requiredAppStorageKeys(account) {
  return [
    'flutter.app_restoration_last_user_v2',
    `flutter.app_restoration_latest_v2:${account}`,
    'kemetic.restoration.last_user.v2',
    `kemetic.restoration.critical.latest.v2:${account}`,
  ];
}

function browserArguments({ debugPort, profile, url }) {
  return [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,960',
    url,
  ];
}

export function assertPersistentBrowserContext(args, expectedProfile) {
  const forbidden = ['--incognito', '--guest', '--temp-profile', '--disable-local-storage'];
  const presentForbidden = forbidden.filter((flag) => args.includes(flag));
  if (presentForbidden.length > 0) {
    throw new Error(`forbidden temporary browser context flags: ${presentForbidden.join(', ')}`);
  }
  const userDataArgs = args.filter((value) => value.startsWith('--user-data-dir='));
  if (
    userDataArgs.length !== 1 ||
    userDataArgs[0] !== `--user-data-dir=${expectedProfile}`
  ) {
    throw new Error(
      `browser profile mismatch: expected ${expectedProfile}; args=${JSON.stringify(userDataArgs)}`,
    );
  }
}

async function serve(webRoot) {
  const root = resolve(webRoot);
  const server = createServer(async (request, response) => {
    try {
      const requested = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      if (requested === neutralStorageProbePath) {
        const body = Buffer.from(
          '<!doctype html><html><head><meta charset="utf-8">' +
            '<meta name="lock-gate-neutral-probe" content="no-app-boot">' +
            `<title>${neutralStorageProbeTitle}</title></head>` +
            '<body data-lock-gate-neutral-probe="true">storage probe</body></html>',
        );
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; script-src 'none'",
          'content-type': 'text/html; charset=utf-8',
          'x-lock-gate-neutral-probe': 'true',
        });
        response.end(body);
        return;
      }
      const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
      let candidate = resolve(root, normalize(relative));
      if (!candidate.startsWith(`${root}${sep}`) && candidate !== root) {
        response.writeHead(403).end('forbidden');
        return;
      }
      try {
        if (!(await stat(candidate)).isFile()) throw new Error('not a file');
      } catch {
        candidate = join(root, 'index.html');
      }
      const body = await readFile(candidate);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': mimeTypes[extname(candidate)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return { server, port: server.address().port };
}

function chromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const selected = candidates.find((candidate) => existsSync(candidate));
  if (!selected) throw new Error('Chrome/Chromium binary not found');
  return selected;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function processesUsingProfile(profile) {
  const command = ['ps', '-axo', 'pid=,ppid=,pgid=,stat=,command='];
  const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
  if (result.error) {
    return { command, error: String(result.error), matches: [] };
  }
  const matches = (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(`--user-data-dir=${profile}`));
  return {
    command,
    status: result.status,
    matches,
    matchesSha256: sha256(Buffer.from(matches.join('\n'))),
  };
}

async function pathEvidence(root, relativePaths) {
  const evidence = [];
  async function visit(relative) {
    const absolute = join(root, relative);
    let entryStat;
    try {
      entryStat = await lstat(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        evidence.push({ path: relative, type: 'missing' });
        return;
      }
      throw error;
    }
    if (entryStat.isSymbolicLink()) {
      evidence.push({ path: relative, type: 'symlink', target: await readlink(absolute) });
      return;
    }
    if (entryStat.isDirectory()) {
      evidence.push({ path: relative, type: 'directory' });
      const children = await readdir(absolute);
      for (const child of children.sort()) await visit(join(relative, child));
      return;
    }
    if (entryStat.isFile()) {
      const bytes = await readFile(absolute);
      evidence.push({
        path: relative,
        type: 'file',
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
      return;
    }
    evidence.push({ path: relative, type: 'other', bytes: entryStat.size });
  }
  for (const relative of relativePaths) await visit(relative);
  return { entries: evidence, sha256: sha256Json(evidence) };
}

async function captureProfileEvidence(profile) {
  const storage = await pathEvidence(profile, [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'Local State',
    join('Default', 'Preferences'),
    join('Default', 'Local Storage', 'leveldb'),
    join('Default', 'IndexedDB'),
  ]);
  const processes = processesUsingProfile(profile);
  const value = { profile, storage, processes };
  return { ...value, sha256: sha256Json(value) };
}

export function bufferContainsStorageToken(bytes, token) {
  return [Buffer.from(token, 'utf8'), Buffer.from(token, 'utf16le')].some(
    (encoded) => bytes.includes(encoded),
  );
}

async function localStorageDiskEvidence(profile, requiredTokens) {
  const leveldb = join(profile, 'Default', 'Local Storage', 'leveldb');
  const files = [];
  try {
    for (const name of (await readdir(leveldb)).sort()) {
      const path = join(leveldb, name);
      const entryStat = await lstat(path);
      if (!entryStat.isFile()) continue;
      const bytes = await readFile(path);
      files.push({
        name,
        bytes: bytes.length,
        sha256: sha256(bytes),
        tokens: requiredTokens.filter((token) => bufferContainsStorageToken(bytes, token)),
      });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const observedTokens = [...new Set(files.flatMap((file) => file.tokens))].sort();
  const missingTokens = requiredTokens.filter((token) => !observedTokens.includes(token));
  const value = { leveldb, requiredTokens, observedTokens, missingTokens, files };
  return { ...value, sha256: sha256Json(value) };
}

async function waitForLocalStorageDurability(profile, requiredTokens, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  const transitions = [];
  let lastEvidence;
  let lastSha;
  while (Date.now() < deadline) {
    lastEvidence = await localStorageDiskEvidence(profile, requiredTokens);
    if (lastEvidence.sha256 !== lastSha) {
      transitions.push({ observedAt: new Date().toISOString(), ...lastEvidence });
      lastSha = lastEvidence.sha256;
    }
    if (lastEvidence.missingTokens.length === 0) {
      return {
        durableAt: new Date().toISOString(),
        condition: 'all required localStorage tokens observed in profile LevelDB',
        transitions,
        finalEvidence: lastEvidence,
      };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    `timed out waiting for localStorage profile durability; missing=${JSON.stringify(lastEvidence?.missingTokens ?? requiredTokens)}`,
  );
}

async function profileLifecycleState(profile) {
  const locks = [];
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const path = join(profile, name);
    try {
      const entryStat = await lstat(path);
      locks.push({
        name,
        type: entryStat.isSymbolicLink() ? 'symlink' : 'other',
        target: entryStat.isSymbolicLink() ? await readlink(path) : null,
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const processes = processesUsingProfile(profile);
  const lockRetainers = locks.flatMap((lock) => {
    if (lock.name !== 'SingletonLock' || lock.type !== 'symlink') return [];
    const pidMatch = lock.target?.match(/-(\d+)$/);
    if (!pidMatch) return [{ ...lock, ownerPid: null, ownerAlive: null }];
    const ownerPid = Number(pidMatch[1]);
    try {
      process.kill(ownerPid, 0);
      return [{ ...lock, ownerPid, ownerAlive: true }];
    } catch (error) {
      if (error?.code === 'ESRCH') return [];
      return [{ ...lock, ownerPid, ownerAlive: null, probeError: String(error) }];
    }
  });
  const value = { locks, lockRetainers, processes };
  return { ...value, sha256: sha256Json(value) };
}

async function waitForJson(url, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = await response.json();
        const matched = predicate(value);
        if (matched) return matched;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError ?? 'no match'}`);
}

export class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.closedError = null;
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result ?? {});
    });
    const rejectPending = (event) => {
      this.closedError ??= new Error(
        `CDP socket closed before response${event?.type ? ` (${event.type})` : ''}`,
      );
      for (const pending of this.pending.values()) pending.reject(this.closedError);
      this.pending.clear();
    };
    this.socket.addEventListener('close', rejectPending);
    this.socket.addEventListener('error', rejectPending);
  }

  call(method, params = {}) {
    if (this.closedError || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        this.closedError ?? new Error(`CDP socket is not open for ${method}`),
      );
    }
    const id = this.nextId++;
    const completion = new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject });
    });
    try {
      this.socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      this.pending.delete(id);
      return Promise.reject(error);
    }
    return completion;
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`browser evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function inspectBrowserProcess(debugPort) {
  const versionResponse = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
  if (!versionResponse.ok) throw new Error(`browser version endpoint returned ${versionResponse.status}`);
  const version = await versionResponse.json();
  const browserCdp = new Cdp(version.webSocketDebuggerUrl);
  await browserCdp.open();
  try {
    const processInfo = await browserCdp.call('SystemInfo.getProcessInfo');
    const browser = processInfo.processInfo?.find((item) => item.type === 'browser');
    return { version, processInfo: processInfo.processInfo ?? [], browser };
  } finally {
    browserCdp.close();
  }
}

async function launchChrome({ binary, profile, url, ordinal }) {
  const debugPort = await reservePort();
  const args = browserArguments({ debugPort, profile, url });
  assertPersistentBrowserContext(args, profile);
  const stdout = [];
  const stderr = [];
  const child = spawn(binary, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const launchedAt = new Date().toISOString();
  let exitStatus;
  const exitPromise = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => {
      exitStatus = { code, signal, observedAt: new Date().toISOString() };
      resolveExit(exitStatus);
    });
  });
  child.unref();
  const target = await waitForJson(
    `http://127.0.0.1:${debugPort}/json/list`,
    (targets) => targets.find((item) => item.type === 'page' && item.url.startsWith(url.split('?')[0])),
  );
  const browserInspection = await inspectBrowserProcess(debugPort);
  const realBrowserPid = Number(browserInspection.browser?.id);
  if (!Number.isInteger(realBrowserPid) || realBrowserPid !== child.pid) {
    throw new Error(
      `spawned PID ${child.pid} is not the Chrome browser PID ${browserInspection.browser?.id}`,
    );
  }
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  return {
    ordinal,
    child,
    cdp,
    debugPort,
    profile,
    url,
    origin: new URL(url).origin,
    args,
    command: [binary, ...args],
    commandSha256: sha256Json([binary, ...args]),
    launchedAt,
    browserInspection,
    realBrowserPid,
    exitPromise,
    get exitStatus() {
      return exitStatus;
    },
    stdout,
    stderr,
  };
}

async function evaluateUntil(cdp, expression, description, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await cdp.evaluate(expression);
    if (lastValue) return lastValue;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`timed out waiting for ${description}; last=${JSON.stringify(lastValue)}`);
}

async function waitForSurface(cdp, label, buildId) {
  const expectedPath = {
    Calendar: '/',
    Planner: '/rhythm/today',
    Library: '/nodes',
  }[label];
  return evaluateUntil(
    cdp,
    `(() => {
      const expectedTitle = ${JSON.stringify(`LOCK_GATE|${buildId}|${label}|${expectedPath}`)};
      if (document.title !== expectedTitle) return null;
      const visibleRoute = location.hash.startsWith('#/')
        ? location.hash.slice(1).split('?')[0]
        : location.pathname;
      if (visibleRoute !== ${JSON.stringify(expectedPath)}) return null;
      return {title: document.title, visibleRoute, url: location.href};
    })()`,
    `${label} surface and build identity`,
  );
}

async function readInitialHarnessState(cdp, buildId) {
  return evaluateUntil(
    cdp,
    `(async () => {
      const prefix = ${JSON.stringify(`LOCK_GATE|${buildId}|`)};
      if (!document.title.startsWith(prefix)) return null;
      const parts = document.title.split('|');
      const visibleRoute = location.hash.startsWith('#/')
        ? location.hash.slice(1).split('?')[0]
        : location.pathname;
      const databases = typeof indexedDB.databases === 'function'
        ? await indexedDB.databases()
        : [];
      return {
        title: document.title,
        label: parts[2],
        route: parts[3],
        visibleRoute,
        url: location.href,
        origin: location.origin,
        localStorage: Object.fromEntries(Object.entries(localStorage).sort()),
        indexedDB: databases
          .map((database) => ({name: database.name ?? null, version: database.version ?? null}))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      };
    })()`,
    'initial rendered harness state',
  );
}

async function readCalendarViewportHarnessState(cdp, buildId) {
  return evaluateUntil(
    cdp,
    `(async () => {
      const prefix = ${JSON.stringify(`CAL_VIEWPORT_GATE|${buildId}|`)};
      if (!document.title.startsWith(prefix)) return null;
      const parts = document.title.split('|');
      const fields = Object.fromEntries(parts.slice(4).map((entry) => {
        const separator = entry.indexOf('=');
        return separator < 0
          ? [entry, '']
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      }));
      const visibleRoute = location.hash.startsWith('#/')
        ? location.hash.slice(1).split('?')[0]
        : location.pathname;
      const databases = typeof indexedDB.databases === 'function'
        ? await indexedDB.databases()
        : [];
      return {
        title: document.title,
        label: parts[2],
        route: parts[3],
        visibleRoute,
        savedCalendarAnchor: fields.saved,
        visibleCalendarAnchor: fields.visible,
        calendarDecision: fields.decision,
        url: location.href,
        origin: location.origin,
        localStorage: Object.fromEntries(Object.entries(localStorage).sort()),
        indexedDB: databases
          .map((database) => ({name: database.name ?? null, version: database.version ?? null}))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      };
    })()`,
    'Calendar viewport process-restoration harness state',
  );
}

function parseKemeticAnchor(value) {
  if (!value || value === 'none') return null;
  const match = value.match(/^(-?\d+)-(\d+)-(\d+)$/);
  if (!match) return null;
  return { kYear: Number(match[1]), kMonth: Number(match[2]), kDay: Number(match[3]) };
}

async function readTodayProcessHarnessState(cdp, buildId) {
  return evaluateUntil(
    cdp,
    `(async () => {
      const prefix = ${JSON.stringify(`TODAY_PROCESS_GATE|${buildId}|`)};
      if (!document.title.startsWith(prefix)) return null;
      const parts = document.title.split('|');
      const fields = Object.fromEntries(parts.slice(3).map((entry) => {
        const separator = entry.indexOf('=');
        return separator < 0
          ? [entry, '']
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      }));
      const route = parts[2];
      const visibleRoute = location.hash.startsWith('#/')
        ? location.hash.slice(1).split('?')[0]
        : location.pathname;
      const databases = typeof indexedDB.databases === 'function'
        ? await indexedDB.databases()
        : [];
      return {
        title: document.title,
        label: route === '/' ? 'Calendar' : route === '/rhythm/today' ? 'Planner' : route,
        route,
        visibleRoute,
        today: fields.today,
        view: fields.view,
        todayVisible: fields.todayVisible === 'true',
        todayMounted: fields.todayMounted === 'true',
        disposition: fields.disposition,
        commandGeneration: Number(fields.commandGeneration ?? 0),
        intentGeneration: Number(fields.intentGeneration ?? 0),
        hydrating: fields.hydrating === 'true',
        settled: fields.settled === 'true',
        stateIdentity: Number(fields.stateIdentity ?? 0),
        url: location.href,
        origin: location.origin,
        localStorage: Object.fromEntries(Object.entries(localStorage).sort()),
        indexedDB: databases
          .map((database) => ({name: database.name ?? null, version: database.version ?? null}))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      };
    })()`,
    'Today post-process production-shell state',
  );
}

async function waitForTodayProcessState(cdp, buildId, predicate, description) {
  return evaluateUntil(
    cdp,
    `(() => {
      const prefix = ${JSON.stringify(`TODAY_PROCESS_GATE|${buildId}|`)};
      if (!document.title.startsWith(prefix)) return null;
      const parts = document.title.split('|');
      const fields = Object.fromEntries(parts.slice(3).map((entry) => {
        const separator = entry.indexOf('=');
        return separator < 0
          ? [entry, '']
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      }));
      const state = {
        route: parts[2],
        today: fields.today,
        view: fields.view,
        todayVisible: fields.todayVisible === 'true',
        disposition: fields.disposition,
        commandGeneration: Number(fields.commandGeneration ?? 0),
        intentGeneration: Number(fields.intentGeneration ?? 0),
        hydrating: fields.hydrating === 'true',
        settled: fields.settled === 'true',
        stateIdentity: Number(fields.stateIdentity ?? 0),
      };
      return (${predicate.toString()})(state) ? state : null;
    })()`,
    description,
  );
}

function restorationAuthorityCalendarView(authority) {
  const calendar = authority?.validated?.calendar;
  if (
    !Number.isInteger(calendar?.kYear) ||
    !Number.isInteger(calendar?.kMonth) ||
    !Number.isInteger(calendar?.kDay)
  ) {
    return null;
  }
  return `${calendar.kYear}-${calendar.kMonth}-${calendar.kDay}`;
}

export async function waitForTodayViewportQuiescence({
  minimumYear,
  description,
  readObservation,
  waitForNextObservation,
  timeoutMs = 30_000,
  requiredConsecutive = 12,
  now = Date.now,
}) {
  if (!Number.isInteger(minimumYear)) throw new Error('minimumYear must be an integer');
  if (!Number.isInteger(requiredConsecutive) || requiredConsecutive < 2) {
    throw new Error('requiredConsecutive must be an integer of at least 2');
  }
  if (typeof readObservation !== 'function' || typeof waitForNextObservation !== 'function') {
    throw new Error('quiescence observation callbacks are required');
  }

  const startedAtMs = now();
  const deadline = startedAtMs + timeoutMs;
  const observations = [];
  let candidateViewport = null;
  let previousViewport = null;
  let consecutiveViewport = 0;
  let consecutiveAuthoritativeViewport = 0;
  let maximumConsecutiveViewport = 0;
  let maximumConsecutiveAuthoritativeViewport = 0;

  while (now() < deadline) {
    const observation = await readObservation();
    const state = observation?.state;
    const viewport = state?.view ?? null;
    const anchor = parseKemeticAnchor(viewport);
    const thresholdReached = anchor !== null && anchor.kYear >= minimumYear;
    const viewportEligible =
      state?.route === '/' &&
      state?.settled === true &&
      state?.hydrating === false &&
      thresholdReached;
    const movementDetected = previousViewport !== null && viewport !== previousViewport;
    const authorityViewport = restorationAuthorityCalendarView(observation?.authority);
    const authorityMatchedViewport =
      viewportEligible &&
      observation?.authority?.validated?.routeLocation === '/' &&
      authorityViewport === viewport;

    if (!viewportEligible) {
      candidateViewport = null;
      consecutiveViewport = 0;
      consecutiveAuthoritativeViewport = 0;
    } else if (candidateViewport !== viewport) {
      candidateViewport = viewport;
      consecutiveViewport = 1;
      consecutiveAuthoritativeViewport = authorityMatchedViewport ? 1 : 0;
    } else {
      consecutiveViewport += 1;
      consecutiveAuthoritativeViewport = authorityMatchedViewport
        ? consecutiveAuthoritativeViewport + 1
        : 0;
    }
    maximumConsecutiveViewport = Math.max(maximumConsecutiveViewport, consecutiveViewport);
    maximumConsecutiveAuthoritativeViewport = Math.max(
      maximumConsecutiveAuthoritativeViewport,
      consecutiveAuthoritativeViewport,
    );

    const accepted =
      consecutiveViewport >= requiredConsecutive &&
      consecutiveAuthoritativeViewport >= requiredConsecutive;
    const authorityRead = observation?.authority?.read;
    const diagnostic = {
      observationIndex: observations.length,
      observedAtMs: now(),
      viewport,
      route: state?.route ?? null,
      movementDetected,
      intentGeneration: state?.intentGeneration ?? null,
      settlementState: state?.settled ?? null,
      hydrationInFlight: state?.hydrating ?? null,
      stateIdentity: state?.stateIdentity ?? null,
      thresholdReached,
      candidateViewport,
      consecutiveIdenticalViewportObservations: consecutiveViewport,
      consecutiveAuthoritativeViewportObservations: consecutiveAuthoritativeViewport,
      authorityMatchedViewport,
      authorityViewport,
      authorityGeneration: observation?.authority?.validated?.generation ?? null,
      authorityEnvelopeSha256:
        typeof authorityRead?.latestEnvelope === 'string'
          ? sha256(Buffer.from(authorityRead.latestEnvelope))
          : null,
      authorityError: observation?.authorityError ?? null,
      accepted,
    };
    observations.push(diagnostic);
    previousViewport = viewport;

    if (accepted) {
      return {
        state,
        authority: observation.authority,
        evidence: {
          description,
          minimumYear,
          requiredConsecutive,
          timedOut: false,
          acceptedObservationIndex: diagnostic.observationIndex,
          stableViewport: viewport,
          authorityMatchedViewport: true,
          consecutiveIdenticalViewportObservations: consecutiveViewport,
          consecutiveAuthoritativeViewportObservations:
            consecutiveAuthoritativeViewport,
          maximumConsecutiveIdenticalViewportObservations: maximumConsecutiveViewport,
          maximumConsecutiveAuthoritativeViewportObservations:
            maximumConsecutiveAuthoritativeViewport,
          observations,
        },
      };
    }

    await waitForNextObservation();
  }

  const last = observations.at(-1);
  const evidence = {
    description,
    minimumYear,
    requiredConsecutive,
    timedOut: true,
    elapsedMs: now() - startedAtMs,
    stableViewport: null,
    authorityMatchedViewport: false,
    maximumConsecutiveIdenticalViewportObservations: maximumConsecutiveViewport,
    maximumConsecutiveAuthoritativeViewportObservations:
      maximumConsecutiveAuthoritativeViewport,
    observations,
  };
  const lastAuthorityDetail = last?.authorityMatchedViewport
    ? `authority matched viewport ${last.viewport}`
    : last?.authorityViewport === null || last?.authorityViewport === undefined
      ? `authority unavailable: ${last?.authorityError ?? 'no acknowledged Calendar authority'}`
      : `authority Calendar ${last.authorityViewport} did not match viewport ${last?.viewport}`;
  const error = new Error(
    `${description} did not become quiescent and authoritative; ` +
      `lastViewport=${last?.viewport ?? 'none'}; ` +
      `intentGeneration=${last?.intentGeneration ?? 'none'}; ` +
      `settled=${last?.settlementState ?? 'none'}; ` +
      `maxConsecutiveViewport=${maximumConsecutiveViewport}; ` +
      `maxConsecutiveAuthoritativeViewport=${maximumConsecutiveAuthoritativeViewport}; ` +
      lastAuthorityDetail,
  );
  error.quiescenceEvidence = evidence;
  throw error;
}

async function waitForTodayProcessViewportQuiescence(
  cdp,
  buildId,
  account,
  minimumYear,
  description,
) {
  return waitForTodayViewportQuiescence({
    minimumYear,
    description,
    readObservation: async () => {
      const state = await readTodayProcessHarnessState(cdp, buildId);
      try {
        const read = await readRestorationAuthority(cdp, account, description);
        const validated = validateRestorationAuthorityRead(read, {
          account,
          expectedRoute: '/',
          expectedCalendarView: state.view,
        });
        return { state, authority: { read, validated } };
      } catch (error) {
        return { state, authority: null, authorityError: error?.stack ?? String(error) };
      }
    },
    waitForNextObservation: () =>
      cdp.evaluate(
        `new Promise((resolveFrame) => requestAnimationFrame(() => ` +
          `requestAnimationFrame(() => resolveFrame(true))))`,
      ),
  });
}

async function synthesizeCalendarSwipe(cdp, direction = 'future') {
  await cdp.call('Input.synthesizeScrollGesture', {
    x: 640,
    y: 700,
    yDistance: direction === 'future' ? -1800 : 1800,
    speed: 2400,
    gestureSourceType: 'touch',
  });
}

async function scrollTodayProcessToYear(cdp, buildId, account, minimumYear) {
  const observations = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const before = await readTodayProcessHarnessState(cdp, buildId);
    const beforeAnchor = parseKemeticAnchor(before.view);
    observations.push({ attempt, phase: 'before', state: before });
    if (beforeAnchor && beforeAnchor.kYear >= minimumYear) {
      const quiescent = await waitForTodayProcessViewportQuiescence(
        cdp,
        buildId,
        account,
        minimumYear,
        `Calendar viewport at or beyond Kemetic year ${minimumYear}`,
      );
      return {
        state: quiescent.state,
        authority: quiescent.authority,
        observations,
        quiescence: quiescent.evidence,
      };
    }
    await synthesizeCalendarSwipe(cdp, 'future');
    const after = await readTodayProcessHarnessState(cdp, buildId);
    observations.push({ attempt, phase: 'after', state: after });
  }
  throw new Error(
    `real touch gestures never reached Kemetic year ${minimumYear}: ` +
      JSON.stringify(observations.slice(-6)),
  );
}

async function waitForCalendarViewportSurface(cdp, { label, route, buildId }) {
  return evaluateUntil(
    cdp,
    `(() => {
      const prefix = ${JSON.stringify(`CAL_VIEWPORT_GATE|${buildId}|${label}|${route}|`)};
      if (!document.title.startsWith(prefix)) return null;
      const visibleRoute = location.hash.startsWith('#/')
        ? location.hash.slice(1).split('?')[0]
        : location.pathname;
      return visibleRoute === ${JSON.stringify(route)} ? true : null;
    })()`,
    `${label} Calendar viewport harness surface`,
  );
}

async function writeProfileSentinel(cdp, value) {
  return cdp.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(sentinelKey)}, ${JSON.stringify(value)});
    return {
      key: ${JSON.stringify(sentinelKey)},
      value: localStorage.getItem(${JSON.stringify(sentinelKey)}),
      origin: location.origin,
      url: location.href,
    };
  })()`);
}

async function readRestorationAuthority(cdp, account, description) {
  return evaluateUntil(
    cdp,
    `(async () => {
      const databaseName = ${JSON.stringify(restorationAuthorityContract.databaseName)};
      const databaseVersion = ${restorationAuthorityContract.databaseVersion};
      const storeName = ${JSON.stringify(restorationAuthorityContract.storeName)};
      const lastActiveUserKey = ${JSON.stringify(
        restorationAuthorityContract.lastActiveUserKey,
      )};
      const latestEnvelopeKey = ${JSON.stringify(authorityLatestKey(account))};
      const databases = typeof indexedDB.databases === 'function'
        ? await indexedDB.databases()
        : [];
      const matchingDatabase = databases.find(
        (database) => database.name === databaseName,
      );
      if (!matchingDatabase) {
        return {
          databaseName,
          databaseVersion,
          storeName,
          lastActiveUserKey,
          latestEnvelopeKey,
          databasePresent: false,
          storePresent: false,
          transactionMode: 'readonly',
          readCompleted: false,
          writesAttempted: false,
          lastActiveUserId: null,
          latestEnvelope: null,
        };
      }
      const database = await new Promise((resolveDatabase, rejectDatabase) => {
        const request = indexedDB.open(databaseName);
        request.onupgradeneeded = () => {
          request.transaction?.abort();
          rejectDatabase(new Error('neutral authority reader would create or upgrade storage'));
        };
        request.onerror = () => rejectDatabase(
          request.error ?? new Error('neutral authority database open failed'),
        );
        request.onblocked = () => rejectDatabase(
          new Error('neutral authority database open blocked'),
        );
        request.onsuccess = () => resolveDatabase(request.result);
      });
      try {
        if (
          database.version !== databaseVersion ||
          !database.objectStoreNames.contains(storeName)
        ) {
          return {
            databaseName,
            databaseVersion: database.version,
            storeName,
            lastActiveUserKey,
            latestEnvelopeKey,
            databasePresent: true,
            storePresent: database.objectStoreNames.contains(storeName),
            transactionMode: 'readonly',
            readCompleted: false,
            writesAttempted: false,
            lastActiveUserId: null,
            latestEnvelope: null,
          };
        }
        const transaction = database.transaction(storeName, 'readonly');
        const completion = new Promise((resolveCompletion, rejectCompletion) => {
          transaction.oncomplete = () => resolveCompletion(true);
          transaction.onabort = () => rejectCompletion(
            transaction.error ?? new Error('neutral authority read aborted'),
          );
          transaction.onerror = () => rejectCompletion(
            transaction.error ?? new Error('neutral authority read failed'),
          );
        });
        const store = transaction.objectStore(storeName);
        const readKey = (key) => new Promise((resolveValue, rejectValue) => {
          const request = store.get(key);
          request.onerror = () => rejectValue(
            request.error ?? new Error('neutral authority key read failed'),
          );
          request.onsuccess = () => resolveValue(request.result ?? null);
        });
        const [lastActiveUserId, latestEnvelope] = await Promise.all([
          readKey(lastActiveUserKey),
          readKey(latestEnvelopeKey),
        ]);
        await completion;
        return {
          databaseName,
          databaseVersion: database.version,
          storeName,
          lastActiveUserKey,
          latestEnvelopeKey,
          databasePresent: true,
          storePresent: true,
          transactionMode: transaction.mode,
          readCompleted: true,
          writesAttempted: false,
          lastActiveUserId,
          latestEnvelope,
        };
      } finally {
        database.close();
      }
    })()`,
    description,
  );
}

async function waitForRestorationAuthority(
  cdp,
  account,
  expectations,
  description,
) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const read = await readRestorationAuthority(cdp, account, description);
      const validated = validateRestorationAuthorityRead(read, {
        account,
        ...expectations,
      });
      return { read, validated };
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error(`${description} did not become authoritative: ${lastError}`);
}

async function waitForStableRestorationAuthority(
  cdp,
  account,
  expectations,
  description,
) {
  const deadline = Date.now() + 30_000;
  let previous;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const read = await readRestorationAuthority(cdp, account, description);
      const validated = validateRestorationAuthorityRead(read, {
        account,
        ...expectations,
      });
      if (
        previous !== undefined &&
        previous.read.lastActiveUserId === read.lastActiveUserId &&
        previous.read.latestEnvelope === read.latestEnvelope
      ) {
        return {
          read,
          validated,
          stableReadEvidence: {
            consecutiveExactReads: 2,
            firstReadSha256: sha256Json(previous.read),
            secondReadSha256: sha256Json(read),
          },
        };
      }
      previous = { read, validated };
      lastError = new Error('acknowledged authority changed between consecutive reads');
    } catch (error) {
      previous = undefined;
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`${description} did not become stable and authoritative: ${lastError}`);
}

function captureLegacyMirrorBaseline(storage, { account, sentinelValue }) {
  const keys = [sentinelKey, ...requiredAppStorageKeys(account)];
  const missingKeys = keys.filter((key) => !(key in storage));
  if (storage[sentinelKey] !== sentinelValue) {
    throw new Error('live process sentinel value changed before termination');
  }
  return {
    values: Object.fromEntries(
      keys.filter((key) => key in storage).map((key) => [key, storage[key]]),
    ),
    missingKeys,
  };
}

function requireExactStorageValues(storage, expected, description) {
  const missingKeys = Object.keys(expected).filter((key) => !(key in storage));
  const changedKeys = Object.keys(expected).filter(
    (key) => key in storage && storage[key] !== expected[key],
  );
  const comparison = {
    description,
    expectedKeys: Object.keys(expected),
    expectedValuesSha256: sha256Json(expected),
    observedValuesSha256: sha256Json(
      Object.fromEntries(Object.keys(expected).map((key) => [key, storage[key]])),
    ),
    missingKeys,
    changedKeys,
    exact: missingKeys.length === 0 && changedKeys.length === 0,
  };
  if (!comparison.exact) {
    const error = new Error(
      `${description} did not preserve exact storage values: ` +
        JSON.stringify({ missingKeys, changedKeys }),
    );
    error.storageComparison = comparison;
    throw error;
  }
  return comparison;
}

function requireRestoredCalendarPlacement({
  state,
  expectedSnapshot,
  observedAuthority,
}) {
  const actualCalendar = observedAuthority.calendar;
  const logicalAnchor =
    `${actualCalendar.kYear}-${actualCalendar.kMonth}-${actualCalendar.kDay}`;
  const expectedLogicalAnchor =
    `${expectedSnapshot.calendar.kYear}-${expectedSnapshot.calendar.kMonth}-` +
    `${expectedSnapshot.calendar.kDay}`;
  const placementMatched =
    actualCalendar.anchorTarget === expectedSnapshot.calendar.anchorTarget &&
    actualCalendar.anchorAlignment === expectedSnapshot.calendar.anchorAlignment &&
    actualCalendar.viewportHeight === expectedSnapshot.calendar.viewportHeight &&
    actualCalendar.layoutRevision === expectedSnapshot.calendar.layoutRevision;
  const comparison = {
    expectedView: expectedLogicalAnchor,
    observedView: state.view,
    expectedLogicalAnchor,
    observedLogicalAnchor: logicalAnchor,
    expectedPlacement: expectedSnapshot.calendar,
    observedPlacement: actualCalendar,
    logicalAnchorMatched:
      state.view === expectedLogicalAnchor && logicalAnchor === expectedLogicalAnchor,
    placementMatched,
  };
  if (!comparison.logicalAnchorMatched || !comparison.placementMatched) {
    throw new Error(`restored Calendar placement mismatch: ${JSON.stringify(comparison)}`);
  }
  return comparison;
}

async function readNeutralStorageProbe(cdp) {
  return evaluateUntil(
    cdp,
    `(() => {
      if (document.title !== ${JSON.stringify(neutralStorageProbeTitle)}) return null;
      const marker = document.querySelector(
        'meta[name="lock-gate-neutral-probe"][content="no-app-boot"]',
      );
      return {
        title: document.title,
        url: location.href,
        origin: location.origin,
        path: location.pathname,
        scriptCount: document.scripts.length,
        markerPresent: marker != null,
        flutterWindowPresent: '_flutter' in window,
        flutterViewPresent: document.querySelector('flt-glass-pane, flutter-view') != null,
        localStorage: Object.fromEntries(Object.entries(localStorage).sort()),
      };
    })()`,
    'script-free neutral same-origin storage probe',
  );
}

export function classifyFreshProcess({
  state,
  expectedSurface,
  expectedOrigin,
  sentinelValue,
  account,
}) {
  const requiredAppKeys = requiredAppStorageKeys(account);
  const missingAppKeys = requiredAppKeys.filter((key) => !(key in state.localStorage));
  const sentinelSurvived = state.localStorage[sentinelKey] === sentinelValue;
  const originMatched = state.origin === expectedOrigin;
  let classification = 'passed';
  if (!originMatched || !sentinelSurvived) classification = 'profile-or-origin-lifecycle-loss';
  else if (missingAppKeys.length > 0) classification = 'application-storage-loss';
  else if (state.label !== expectedSurface || state.route !== state.visibleRoute) {
    classification = 'application-restoration-reader-failure';
  }
  return {
    classification,
    expectedSurface,
    observedSurface: state.label,
    observedRoute: state.visibleRoute,
    expectedOrigin,
    observedOrigin: state.origin,
    originMatched,
    sentinelKey,
    sentinelSurvived,
    requiredAppKeys,
    missingAppKeys,
    indexedDB: state.indexedDB,
  };
}

export function terminationBoundaryReady({
  debugEndpointClosed,
  exitStatus,
  profileProcesses,
  profileLockRetainers,
}) {
  return (
    debugEndpointClosed &&
    exitStatus != null &&
    profileProcesses.length === 0 &&
    profileLockRetainers.length === 0
  );
}

function requireFreshProcessClassification(classification) {
  if (classification.classification === 'passed') return;
  throw new Error(
    `fresh-process classification=${classification.classification} ` +
      `sentinel=${classification.sentinelSurvived} ` +
      `missingAppKeys=${JSON.stringify(classification.missingAppKeys)} ` +
      `origin=${classification.observedOrigin} ` +
      `surface=${classification.observedSurface} ${classification.observedRoute}`,
  );
}

function requireInitialSurface(state, expected) {
  if (state.label !== expected || state.route !== state.visibleRoute) {
    throw new Error(
      `fresh process restored ${state.label} ${state.visibleRoute}; expected ${expected}`,
    );
  }
}

async function sendHarnessKey(cdp, key) {
  const upper = key.toUpperCase();
  const virtualKeyCode = upper.codePointAt(0);
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.call('Input.dispatchKeyEvent', {
      type,
      key,
      code: `Key${upper}`,
      text: type === 'rawKeyDown' ? key : undefined,
      unmodifiedText: type === 'rawKeyDown' ? key : undefined,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    });
  }
}

async function screenshot(cdp, path) {
  const captured = await cdp.call('Page.captureScreenshot', { format: 'png' });
  const bytes = Buffer.from(captured.data, 'base64');
  await writeFile(path, bytes);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
}

async function writeBrowserLogs(launch, resultsDir) {
  const outputs = {};
  for (const [name, chunks] of [
    ['stdout', launch.stdout],
    ['stderr', launch.stderr],
  ]) {
    const bytes = Buffer.concat(chunks);
    const path = join(
      resultsDir,
      `browser-${String(launch.ordinal).padStart(2, '0')}.${name}.log`,
    );
    await writeFile(path, bytes);
    outputs[name] = { path, bytes: bytes.length, sha256: sha256(bytes) };
  }
  return outputs;
}

async function forceTerminate(launch, resultsDir) {
  const evidence = {
    ordinal: launch.ordinal,
    signal: 'SIGTERM',
    signalTargetPid: launch.child.pid,
    realBrowserPid: launch.realBrowserPid,
    signalTargetWasRealBrowser: launch.child.pid === launch.realBrowserPid,
    requestedAt: new Date().toISOString(),
    profileBeforeSignal: await captureProfileEvidence(launch.profile),
  };
  launch.cdp.close();
  process.kill(launch.child.pid, 'SIGTERM');
  const deadline = Date.now() + 15_000;
  let debugEndpointClosed = false;
  let lastLifecycleSha;
  evidence.lifecycleTransitions = [];
  while (Date.now() < deadline) {
    if (!debugEndpointClosed) {
      try {
        await fetch(`http://127.0.0.1:${launch.debugPort}/json/version`);
      } catch {
        debugEndpointClosed = true;
        evidence.debugEndpointClosedAt = new Date().toISOString();
        evidence.exitStatusAtDebugEndpointClose = launch.exitStatus ?? null;
      }
    }
    const lifecycle = await profileLifecycleState(launch.profile);
    if (lifecycle.sha256 !== lastLifecycleSha) {
      evidence.lifecycleTransitions.push({
        observedAt: new Date().toISOString(),
        childExitStatus: launch.exitStatus ?? null,
        ...lifecycle,
      });
      lastLifecycleSha = lifecycle.sha256;
    }
    if (
      terminationBoundaryReady({
        debugEndpointClosed,
        exitStatus: launch.exitStatus,
        profileProcesses: lifecycle.processes.matches,
        profileLockRetainers: lifecycle.lockRetainers,
      })
    ) {
      evidence.exitStatusAtRelaunchBoundary = launch.exitStatus;
      evidence.profileAtRelaunchBoundary = await captureProfileEvidence(launch.profile);
      evidence.browserLogs = await writeBrowserLogs(launch, resultsDir);
      evidence.completeExitObserved = true;
      evidence.noProcessRetainsProfile = true;
      evidence.noProfileLockRetained = true;
      evidence.profileLockArtifactsAtBoundary = lifecycle.locks;
      evidence.sha256 = sha256Json(evidence);
      return evidence;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const timeoutState = await profileLifecycleState(launch.profile);
  evidence.timeout = {
    observedAt: new Date().toISOString(),
    childExitStatus: launch.exitStatus ?? null,
    debugEndpointClosed,
    ...timeoutState,
  };
  try {
    process.kill(-launch.child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const error = new Error(
    `browser process group ${launch.child.pid} did not fully exit and release profile after SIGTERM`,
  );
  error.terminationEvidence = evidence;
  throw error;
}

function browserLaunchEvidence(launch) {
  return {
    ordinal: launch.ordinal,
    spawnedPid: launch.child.pid,
    realBrowserPid: launch.realBrowserPid,
    spawnedPidIsRealBrowser: launch.child.pid === launch.realBrowserPid,
    debugPort: launch.debugPort,
    profile: launch.profile,
    profileSha256: sha256(Buffer.from(launch.profile)),
    url: launch.url,
    origin: launch.origin,
    command: launch.command,
    commandSha256: launch.commandSha256,
    launchedAt: launch.launchedAt,
    contextFlags: {
      incognito: launch.args.includes('--incognito'),
      guest: launch.args.includes('--guest'),
      temporaryProfile: launch.args.includes('--temp-profile'),
      disableLocalStorage: launch.args.includes('--disable-local-storage'),
    },
    browserVersion: launch.browserInspection.version.Browser,
    browserUserAgent: launch.browserInspection.version['User-Agent'],
    processInfo: launch.browserInspection.processInfo,
  };
}

function assertLaunchContinuity(launch, { profile, origin }) {
  if (launch.profile !== profile) {
    throw new Error(`launch ${launch.ordinal} changed profile to ${launch.profile}`);
  }
  if (launch.origin !== origin) {
    throw new Error(`launch ${launch.ordinal} changed origin to ${launch.origin}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const webRoot = resolve(args['web-root']);
  const resultsDir = resolve(args['results-dir']);
  const buildId = args['build-id'];
  const manifestBytes = await readFile(resolve(args.manifest));
  const manifest = JSON.parse(manifestBytes);
  const processUnit = manifest.processUnits?.find(
    (unit) => unit.id === args['process-unit'],
  );
  if (!processUnit || processUnit.evidenceType !== 'process-behavior') {
    throw new Error(`missing process-behavior unit ${args['process-unit']}`);
  }
  await mkdir(resultsDir, { recursive: true });
  await writeFile(join(resultsDir, 'locked-contracts.json'), manifestBytes);
  const profile = await mkdtemp(join(tmpdir(), 'kemetic-lock-gate-profile-'));
  const binary = chromeBinary();
  const { server, port } = await serve(webRoot);
  const isCalendarViewportUnit =
    processUnit.id === 'calendar-viewport-process-restoration';
  const isTodayPostProcessUnit =
    processUnit.id === 'today-post-process-restoration';
  const appUrl = `http://127.0.0.1:${port}/?account=lock-gate${
    isCalendarViewportUnit
      ? '&mode=calendar-viewport'
      : isTodayPostProcessUnit
        ? '&mode=today-post-process'
        : ''
  }`;
  const origin = new URL(appUrl).origin;
  const neutralUrl = `${origin}${neutralStorageProbePath}`;
  const account = 'restoration-e2e-lock-gate';
  const sentinelValue = `profile-${sha256Json({ buildId, origin, profile })}`;
  const receipt = {
    schemaVersion: 3,
    passed: false,
    buildId,
    browserBinary: binary,
    origin,
    accountNamespace: account,
    restorationAuthorityContract,
    profile: {
      path: profile,
      pathSha256: sha256(Buffer.from(profile)),
      createdOnceForRun: true,
      reusedAcrossLaunches: true,
      removedOnlyAfterAllLaunches: true,
      perLaunchCleanup: false,
    },
    sentinel: { key: sentinelKey, value: sentinelValue },
    selection: processUnit,
    selectionManifestSha256: sha256(manifestBytes),
    launches: [],
    forcedTerminations: [],
    classifications: [],
    neutralStorageVerifications: [],
    todayCycles: [],
    buildArtifacts: {},
  };
  let active;
  try {
    for (const file of ['index.html', 'flutter_bootstrap.js', 'main.dart.js']) {
      const bytes = await readFile(join(webRoot, file));
      receipt.buildArtifacts[file] = { sha256: sha256(bytes), bytes: bytes.length };
    }

    if (isTodayPostProcessUnit) {
      let nextOrdinal = 1;
      const observedBrowserPids = new Set();
      const registerBrowserPid = (launch, role) => {
        if (observedBrowserPids.has(launch.realBrowserPid)) {
          throw new Error(
            `${role} reused Chrome PID ${launch.realBrowserPid}; fresh process proof is invalid`,
          );
        }
        observedBrowserPids.add(launch.realBrowserPid);
      };
      const launchApplication = async () => {
        const launch = await launchChrome({
          binary,
          profile,
          url: appUrl,
          ordinal: nextOrdinal++,
        });
        assertLaunchContinuity(launch, { profile, origin });
        registerBrowserPid(launch, 'application');
        return launch;
      };
      const crossTerminationBoundary = async ({
        cycleNumber,
        boundaryName,
        expectedView,
        requiredTokens,
      }) => {
        const liveState = await readTodayProcessHarnessState(active.cdp, buildId);
        if (liveState.route !== '/rhythm/today') {
          throw new Error(
            `cycle ${cycleNumber} ${boundaryName} was not on Planner before termination`,
          );
        }
        const legacyBaseline = captureLegacyMirrorBaseline(liveState.localStorage, {
          account,
          sentinelValue,
        });
        const profileBeforeTermination = await captureProfileEvidence(profile);
        const screenshotBeforeTermination = await screenshot(
          active.cdp,
          join(
            resultsDir,
            `cycle-${cycleNumber}-${boundaryName}-planner-before-sigterm.png`,
          ),
        );
        // Make the final pre-SIGTERM operation a predicate-based confirmation
        // that the acknowledged envelope has stopped advancing. This prevents
        // an older, already-valid read from racing a later acknowledged write.
        const expectedAuthority = await waitForStableRestorationAuthority(
          active.cdp,
          account,
          {
            expectedRoute: liveState.route,
          },
          `cycle ${cycleNumber} ${boundaryName} live acknowledged authority`,
        );
        const selectedCalendar = parseCalendarView(expectedView);
        const authoritativeCalendar = expectedAuthority.validated.calendar;
        if (!selectedCalendar || authoritativeCalendar.kYear !== selectedCalendar.kYear) {
          throw new Error(
            `cycle ${cycleNumber} ${boundaryName} acknowledged Calendar year drifted ` +
              `from the selected distant position: ${JSON.stringify({
                selectedCalendar,
                authoritativeCalendar,
              })}`,
          );
        }
        const authoritativeCalendarView =
          `${authoritativeCalendar.kYear}-${authoritativeCalendar.kMonth}-` +
          `${authoritativeCalendar.kDay}`;
        const expectedCalendarSnapshot = {
          key: expectedAuthority.read.latestEnvelopeKey,
          routeLocation: expectedAuthority.validated.routeLocation,
          updatedAtMs: expectedAuthority.validated.generation,
          calendar: expectedAuthority.validated.calendar,
          sha256: sha256Json(expectedAuthority.validated.calendar),
        };
        const liveStorageText = Object.entries(liveState.localStorage).flat().join('\n');
        const missingLiveTokens = requiredTokens.filter(
          (token) => !liveStorageText.includes(token),
        );
        const terminatedApplicationPid = active.realBrowserPid;
        const applicationEvidence = {
          ...browserLaunchEvidence(active),
          role: 'application-before-sigterm',
          cycleNumber,
          boundaryName,
          expectedSurface: 'Planner',
          selectedCalendarViewBeforePlanner: expectedView,
          expectedCalendarView: authoritativeCalendarView,
          liveState,
          expectedAuthority: expectedAuthority.read,
          validatedExpectedAuthority: expectedAuthority.validated,
          expectedAuthoritySha256: sha256Json(expectedAuthority.read),
          legacyMirrorBaseline: legacyBaseline,
          expectedCalendarSnapshot,
          durabilityBeforeTermination: {
            authority: 'acknowledged IndexedDB envelope exact-value read',
            databaseName: restorationAuthorityContract.databaseName,
            databaseVersion: restorationAuthorityContract.databaseVersion,
            storeName: restorationAuthorityContract.storeName,
            latestEnvelopeKey: expectedAuthority.read.latestEnvelopeKey,
            transactionMode: expectedAuthority.read.transactionMode,
            readCompleted: expectedAuthority.read.readCompleted,
            writesAttempted: expectedAuthority.read.writesAttempted,
            productionAcknowledgement: 'IDBTransaction.oncomplete',
            stableReadEvidence: expectedAuthority.stableReadEvidence,
            legacyMirrorTokens: requiredTokens,
            missingLegacyMirrorTokens: missingLiveTokens,
            legacyMirrorsAuthoritative: false,
          },
          profileBeforeTermination,
          screenshot: screenshotBeforeTermination,
          observedAt: new Date().toISOString(),
        };
        receipt.launches.push(applicationEvidence);
        const applicationTermination = await forceTerminate(active, resultsDir);
        receipt.forcedTerminations.push({
          role: 'application',
          cycleNumber,
          boundaryName,
          ...applicationTermination,
        });
        active = undefined;

        let rawLevelDbEvidence;
        try {
          rawLevelDbEvidence = await localStorageDiskEvidence(profile, requiredTokens);
        } catch (error) {
          rawLevelDbEvidence = {
            inspectionError: error?.stack ?? String(error),
            requiredTokens,
            observedTokens: [],
            missingTokens: requiredTokens,
            sha256: sha256Json({
              inspectionError: error?.stack ?? String(error),
              requiredTokens,
            }),
          };
        }
        applicationEvidence.rawLevelDbDiagnosticAfterTermination = {
          authority: 'diagnostic-only',
          mayFailWithoutFailingGate: true,
          ...rawLevelDbEvidence,
        };

        active = await launchChrome({
          binary,
          profile,
          url: neutralUrl,
          ordinal: nextOrdinal++,
        });
        assertLaunchContinuity(active, { profile, origin });
        registerBrowserPid(active, 'neutral storage probe');
        if (active.realBrowserPid === terminatedApplicationPid) {
          throw new Error('neutral storage probe reused the terminated application PID');
        }
        const neutralState = await readNeutralStorageProbe(active.cdp);
        if (
          neutralState.origin !== origin ||
          neutralState.path !== neutralStorageProbePath ||
          !neutralState.markerPresent ||
          neutralState.scriptCount !== 0 ||
          neutralState.flutterWindowPresent ||
          neutralState.flutterViewPresent
        ) {
          throw new Error(
            `cycle ${cycleNumber} ${boundaryName} neutral process booted an invalid context: ` +
              JSON.stringify(neutralState),
          );
        }
        const neutralAuthority = await readRestorationAuthority(
          active.cdp,
          account,
          `cycle ${cycleNumber} ${boundaryName} neutral acknowledged authority`,
        );
        const validatedNeutralAuthority = validateRestorationAuthorityRead(
          neutralAuthority,
          {
            account,
            expectedRoute: liveState.route,
            expectedCalendarView: authoritativeCalendarView,
          },
        );
        const neutralAuthorityComparison = compareRestorationAuthorityReads(
          neutralAuthority,
          expectedAuthority.read,
          `cycle ${cycleNumber} ${boundaryName} neutral fresh process`,
        );
        const secondNeutralRead = await readNeutralStorageProbe(active.cdp);
        const secondNeutralAuthority = await readRestorationAuthority(
          active.cdp,
          account,
          `cycle ${cycleNumber} ${boundaryName} neutral read-only authority`,
        );
        const validatedSecondNeutralAuthority = validateRestorationAuthorityRead(
          secondNeutralAuthority,
          {
            account,
            expectedRoute: liveState.route,
            expectedCalendarView: authoritativeCalendarView,
          },
        );
        const neutralAuthorityReadOnlyComparison = compareRestorationAuthorityReads(
          secondNeutralAuthority,
          neutralAuthority,
          `cycle ${cycleNumber} ${boundaryName} neutral read-only verification`,
        );
        const neutralLocalStorageReadOnlyComparison = requireExactStorageValues(
          secondNeutralRead.localStorage,
          neutralState.localStorage,
          `cycle ${cycleNumber} ${boundaryName} neutral localStorage read-only verification`,
        );
        const firstLegacyMirrorDiagnostic = legacyMirrorDiagnostics(
          neutralState.localStorage,
          legacyBaseline.values,
        );
        const secondLegacyMirrorDiagnostic = legacyMirrorDiagnostics(
          secondNeutralRead.localStorage,
          legacyBaseline.values,
        );
        const neutralEvidence = {
          ...browserLaunchEvidence(active),
          role: 'neutral-storage-reader',
          cycleNumber,
          boundaryName,
          distinctFromTerminatedApplicationPid:
            active.realBrowserPid !== terminatedApplicationPid,
          flutterApplicationBooted: false,
          firstRead: neutralState,
          secondRead: secondNeutralRead,
          authorityContract: restorationAuthorityContract,
          firstAuthorityRead: neutralAuthority,
          validatedFirstAuthorityRead: validatedNeutralAuthority,
          secondAuthorityRead: secondNeutralAuthority,
          validatedSecondAuthorityRead: validatedSecondNeutralAuthority,
          exactAuthorityComparison: neutralAuthorityComparison,
          authorityReadOnlyComparison: neutralAuthorityReadOnlyComparison,
          localStorageReadOnlyComparison: neutralLocalStorageReadOnlyComparison,
          firstLegacyMirrorDiagnostic,
          secondLegacyMirrorDiagnostic,
          screenshot: await screenshot(
            active.cdp,
            join(resultsDir, `cycle-${cycleNumber}-${boundaryName}-neutral-reader.png`),
          ),
          observedAt: new Date().toISOString(),
        };
        receipt.launches.push(neutralEvidence);
        const neutralPid = active.realBrowserPid;
        const neutralTermination = await forceTerminate(active, resultsDir);
        receipt.forcedTerminations.push({
          role: 'neutral-storage-reader',
          cycleNumber,
          boundaryName,
          ...neutralTermination,
        });
        active = undefined;

        active = await launchApplication();
        if (
          active.realBrowserPid === terminatedApplicationPid ||
          active.realBrowserPid === neutralPid
        ) {
          throw new Error('fresh application did not use a distinct Chrome PID');
        }
        const restoredPlanner = await readTodayProcessHarnessState(active.cdp, buildId);
        const restoredApplicationAuthority = await readRestorationAuthority(
          active.cdp,
          account,
          `cycle ${cycleNumber} ${boundaryName} restored application authority`,
        );
        const validatedRestoredApplicationAuthority =
          validateRestorationAuthorityRead(restoredApplicationAuthority, {
            account,
            expectedRoute: restoredPlanner.route,
            expectedCalendarView: authoritativeCalendarView,
          });
        const restoredApplicationAuthorityComparison =
          compareRestorationAuthorityReads(
            restoredApplicationAuthority,
            expectedAuthority.read,
            `cycle ${cycleNumber} ${boundaryName} restored application`,
          );
        const classification = classifyFreshProcess({
          state: restoredPlanner,
          expectedSurface: 'Planner',
          expectedOrigin: origin,
          sentinelValue,
          account,
        });
        receipt.classifications.push({
          ordinal: active.ordinal,
          cycleNumber,
          boundaryName,
          ...classification,
        });
        requireFreshProcessClassification(classification);
        const applicationLaunchEvidence = {
          ...browserLaunchEvidence(active),
          role: 'application-restoration-reader',
          cycleNumber,
          boundaryName,
          distinctFromTerminatedApplicationPid:
            active.realBrowserPid !== terminatedApplicationPid,
          distinctFromNeutralPid: active.realBrowserPid !== neutralPid,
          initialState: restoredPlanner,
          authorityRead: restoredApplicationAuthority,
          validatedAuthority: validatedRestoredApplicationAuthority,
          authorityComparison: restoredApplicationAuthorityComparison,
          legacyMirrorDiagnostic: legacyMirrorDiagnostics(
            restoredPlanner.localStorage,
            legacyBaseline.values,
          ),
          profileImmediatelyAfterStart: await captureProfileEvidence(profile),
          observedAt: new Date().toISOString(),
        };
        receipt.launches.push(applicationLaunchEvidence);
        const verification = {
          cycleNumber,
          boundaryName,
          expectedAuthoritySha256: sha256Json(expectedAuthority.read),
          rawLevelDbDiagnostic: rawLevelDbEvidence,
          rawLevelDbPredicateAuthoritative: false,
          legacyMirrorBaseline: legacyBaseline,
          legacyMirrorsAuthoritative: false,
          neutralProcess: neutralEvidence,
          expectedCalendarSnapshot,
          restoredApplicationPid: active.realBrowserPid,
          restoredPlanner,
          restoredApplicationAuthority,
          restoredApplicationAuthorityComparison,
        };
        receipt.neutralStorageVerifications.push(verification);
        return {
          expectedCalendarSnapshot,
          restoredPlanner,
          applicationLaunchEvidence,
          verification,
        };
      };

      active = await launchApplication();
      const initialCalendar = await readTodayProcessHarnessState(active.cdp, buildId);
      requireInitialSurface(initialCalendar, 'Calendar');
      await waitForTodayProcessState(
        active.cdp,
        buildId,
        (state) => state.route === '/' && state.settled && state.view !== 'none',
        'initial settled production Calendar',
      );
      receipt.sentinel.written = await writeProfileSentinel(active.cdp, sentinelValue);
      if (receipt.sentinel.written.value !== sentinelValue) {
        throw new Error('neutral profile sentinel was not readable immediately after write');
      }

      for (let cycleNumber = 1; cycleNumber <= 3; cycleNumber += 1) {
        const cycle = { cycleNumber };
        const cycleStartState = await readTodayProcessHarnessState(active.cdp, buildId);
        requireInitialSurface(cycleStartState, 'Calendar');
        await waitForTodayProcessState(
          active.cdp,
          buildId,
          (state) => state.route === '/' && state.settled && state.view !== 'none',
          `cycle ${cycleNumber} settled production Calendar`,
        );
        const todayAnchor = parseKemeticAnchor(cycleStartState.today);
        if (!todayAnchor) throw new Error(`invalid Today anchor ${cycleStartState.today}`);

        const firstFarScroll = await scrollTodayProcessToYear(
          active.cdp,
          buildId,
          account,
          todayAnchor.kYear + 3,
        );
        const selectedState = firstFarScroll.state;
        const selectedAnchor = parseKemeticAnchor(selectedState.view);
        if (!selectedAnchor) throw new Error(`invalid far Calendar view ${selectedState.view}`);
        const selectedCalendarAuthority = await waitForRestorationAuthority(
          active.cdp,
          account,
          {
            expectedRoute: '/',
            expectedCalendarView: selectedState.view,
          },
          `cycle ${cycleNumber} acknowledged far Calendar before Planner`,
        );
        await sendHarnessKey(active.cdp, 'p');
        await waitForTodayProcessState(
          active.cdp,
          buildId,
          (state) => state.route === '/rhythm/today',
          `cycle ${cycleNumber} Planner before far-position termination`,
        );
        const firstBoundary = await crossTerminationBoundary({
          cycleNumber,
          boundaryName: 'far-position',
          expectedView: selectedState.view,
          requiredTokens: [
            sentinelKey,
            ...requiredAppStorageKeys(account),
            '/rhythm/today',
            `\"kYear\":${selectedAnchor.kYear}`,
          ],
        });
        await sendHarnessKey(active.cdp, 'c');
        await waitForTodayProcessState(
          active.cdp,
          buildId,
          (state) => state.route === '/' && state.settled && state.view !== 'none',
          `cycle ${cycleNumber} far Calendar after neutral and application processes`,
        );
        const restoredFarState = await readTodayProcessHarnessState(active.cdp, buildId);
        const restoredFarAuthority = await waitForRestorationAuthority(
          active.cdp,
          account,
          {
            expectedRoute: '/',
            expectedCalendarView: restoredFarState.view,
          },
          `cycle ${cycleNumber} restored far Calendar authority`,
        );
        const restoredFarPlacement = requireRestoredCalendarPlacement({
          state: restoredFarState,
          expectedSnapshot: firstBoundary.expectedCalendarSnapshot,
          observedAuthority: restoredFarAuthority.validated,
        });
        Object.assign(firstBoundary.applicationLaunchEvidence, {
          restoredCalendarState: restoredFarState,
          restoredCalendarAuthority: restoredFarAuthority,
          restoredCalendarPlacement: restoredFarPlacement,
          screenshot: await screenshot(
            active.cdp,
            join(resultsDir, `cycle-${cycleNumber}-far-position-restored-calendar.png`),
          ),
        });

        const manualScroll = await scrollTodayProcessToYear(
          active.cdp,
          buildId,
          account,
          selectedAnchor.kYear + 1,
        );
        const manualState = manualScroll.state;
        const manualAnchor = parseKemeticAnchor(manualState.view);
        if (!manualAnchor) throw new Error(`invalid manual Calendar view ${manualState.view}`);
        const stateIdentityAtTodayTap = manualState.stateIdentity;
        const intentAtTodayTap = manualState.intentGeneration;
        await sendHarnessKey(active.cdp, 't');
        await waitForTodayProcessState(
          active.cdp,
          buildId,
          (state) =>
            state.route === '/' &&
            state.disposition === 'accepted' &&
            state.commandGeneration === 1 &&
            state.todayVisible &&
            state.view === state.today,
          `cycle ${cycleNumber} one Today command after process restoration`,
        );
        const todaySamples = [];
        for (let sample = 0; sample < 30; sample += 1) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
          todaySamples.push(await readTodayProcessHarnessState(active.cdp, buildId));
        }
        if (
          todaySamples.some(
            (state) =>
              state.route !== '/' ||
              state.view !== state.today ||
              !state.todayVisible ||
              state.disposition !== 'accepted' ||
              state.commandGeneration !== 1 ||
              state.stateIdentity !== stateIdentityAtTodayTap ||
              state.intentGeneration <= intentAtTodayTap,
          )
        ) {
          throw new Error(
            `cycle ${cycleNumber} Today did not remain stable: ` +
              JSON.stringify(todaySamples),
          );
        }

        const laterScroll = await scrollTodayProcessToYear(
          active.cdp,
          buildId,
          account,
          todayAnchor.kYear + cycleNumber,
        );
        const laterState = laterScroll.state;
        const laterAnchor = parseKemeticAnchor(laterState.view);
        if (!laterAnchor || laterState.view === laterState.today) {
          throw new Error(`later manual Calendar position was not selected: ${laterState.view}`);
        }
        const laterCalendarAuthority = await waitForRestorationAuthority(
          active.cdp,
          account,
          {
            expectedRoute: '/',
            expectedCalendarView: laterState.view,
          },
          `cycle ${cycleNumber} acknowledged later manual Calendar after Today`,
        );
        await sendHarnessKey(active.cdp, 'p');
        await waitForTodayProcessState(
          active.cdp,
          buildId,
          (state) => state.route === '/rhythm/today',
          `cycle ${cycleNumber} Planner before later-position termination`,
        );
        const secondBoundary = await crossTerminationBoundary({
          cycleNumber,
          boundaryName: 'later-manual-position',
          expectedView: laterState.view,
          requiredTokens: [
            sentinelKey,
            ...requiredAppStorageKeys(account),
            '/rhythm/today',
            `\"kYear\":${laterAnchor.kYear}`,
          ],
        });
        await sendHarnessKey(active.cdp, 'c');
        await waitForTodayProcessState(
          active.cdp,
          buildId,
          (state) => state.route === '/' && state.settled && state.view !== 'none',
          `cycle ${cycleNumber} later Calendar after neutral and application processes`,
        );
        const restoredLaterState = await readTodayProcessHarnessState(active.cdp, buildId);
        if (restoredLaterState.view === restoredLaterState.today) {
          throw new Error('later manual Calendar position restored as Today');
        }
        const restoredLaterAuthority = await waitForRestorationAuthority(
          active.cdp,
          account,
          {
            expectedRoute: '/',
            expectedCalendarView: restoredLaterState.view,
          },
          `cycle ${cycleNumber} restored later Calendar authority`,
        );
        const restoredLaterPlacement = requireRestoredCalendarPlacement({
          state: restoredLaterState,
          expectedSnapshot: secondBoundary.expectedCalendarSnapshot,
          observedAuthority: restoredLaterAuthority.validated,
        });
        Object.assign(secondBoundary.applicationLaunchEvidence, {
          restoredCalendarState: restoredLaterState,
          restoredCalendarAuthority: restoredLaterAuthority,
          restoredCalendarPlacement: restoredLaterPlacement,
          screenshot: await screenshot(
            active.cdp,
            join(
              resultsDir,
              `cycle-${cycleNumber}-later-manual-position-restored-calendar.png`,
            ),
          ),
        });
        Object.assign(cycle, {
          startState: cycleStartState,
          firstFarScroll: {
            observations: firstFarScroll.observations,
            quiescence: firstFarScroll.quiescence,
            selectedState,
            selectedAuthority: selectedCalendarAuthority,
            restoredState: restoredFarState,
            restoredAuthority: restoredFarAuthority,
            restoredPlacement: restoredFarPlacement,
          },
          manualStateBeforeToday: manualState,
          manualTouchScrollObservations: manualScroll.observations,
          manualTouchScrollQuiescence: manualScroll.quiescence,
          todayStabilitySamples: todaySamples,
          laterManualScroll: {
            observations: laterScroll.observations,
            quiescence: laterScroll.quiescence,
            selectedState: laterState,
            selectedAuthority: laterCalendarAuthority,
            restoredState: restoredLaterState,
            restoredAuthority: restoredLaterAuthority,
            restoredPlacement: restoredLaterPlacement,
          },
          firstBoundary: firstBoundary.verification,
          secondBoundary: secondBoundary.verification,
        });
        receipt.todayCycles.push(cycle);
      }
      receipt.passed = true;
    } else if (isCalendarViewportUnit) {
      active = await launchChrome({ binary, profile, url: appUrl, ordinal: 1 });
      assertLaunchContinuity(active, { profile, origin });
      const initialCalendar = await readCalendarViewportHarnessState(active.cdp, buildId);
      requireInitialSurface(initialCalendar, 'Calendar');
      receipt.sentinel.written = await writeProfileSentinel(active.cdp, sentinelValue);
      await evaluateUntil(
        active.cdp,
        `(() => document.title.includes('|decision=explicit_user_scroll') ? true : null)()`,
        'durable explicit future Calendar viewport selection',
      );
      const selectedState = await readCalendarViewportHarnessState(active.cdp, buildId);
      if (
        selectedState.savedCalendarAnchor === 'none' ||
        selectedState.savedCalendarAnchor !== selectedState.visibleCalendarAnchor ||
        selectedState.calendarDecision !== 'explicit_user_scroll'
      ) {
        throw new Error(
          `explicit Calendar viewport was not selected durably: ${JSON.stringify(selectedState)}`,
        );
      }
      const expectedAnchor = selectedState.savedCalendarAnchor;
      await sendHarnessKey(active.cdp, 'p');
      await waitForCalendarViewportSurface(active.cdp, {
        label: 'Planner',
        route: '/rhythm/today',
        buildId,
      });
      const plannerState = await readCalendarViewportHarnessState(active.cdp, buildId);
      const plannerDurability = await waitForLocalStorageDurability(profile, [
        sentinelKey,
        ...requiredAppStorageKeys(account),
        '/rhythm/today',
        'monthBody',
      ]);
      receipt.launches.push({
        ...browserLaunchEvidence(active),
        expectedSurface: 'Planner',
        initialState: initialCalendar,
        selectedCalendarState: selectedState,
        stateBeforeTermination: plannerState,
        expectedCalendarAnchor: expectedAnchor,
        durabilityBeforeTermination: plannerDurability,
        profileBeforeTermination: await captureProfileEvidence(profile),
        screenshot: await screenshot(
          active.cdp,
          join(resultsDir, '01-calendar-anchor-planner-before-termination.png'),
        ),
        observedAt: new Date().toISOString(),
      });
      receipt.forcedTerminations.push(await forceTerminate(active, resultsDir));
      active = undefined;

      active = await launchChrome({ binary, profile, url: appUrl, ordinal: 2 });
      assertLaunchContinuity(active, { profile, origin });
      const restoredPlanner = await readCalendarViewportHarnessState(active.cdp, buildId);
      const plannerClassification = classifyFreshProcess({
        state: restoredPlanner,
        expectedSurface: 'Planner',
        expectedOrigin: origin,
        sentinelValue,
        account,
      });
      receipt.classifications.push({ ordinal: 2, ...plannerClassification });
      requireFreshProcessClassification(plannerClassification);
      if (restoredPlanner.savedCalendarAnchor !== expectedAnchor) {
        throw new Error(
          `fresh process loaded ${restoredPlanner.savedCalendarAnchor}; expected ${expectedAnchor}`,
        );
      }
      await sendHarnessKey(active.cdp, 'c');
      await waitForCalendarViewportSurface(active.cdp, {
        label: 'Calendar',
        route: '/',
        buildId,
      });
      const restoredCalendar = await readCalendarViewportHarnessState(active.cdp, buildId);
      receipt.launches.push({
        ...browserLaunchEvidence(active),
        expectedInitialSurface: 'Planner',
        initialState: restoredPlanner,
        restoredCalendarState: restoredCalendar,
        profileImmediatelyAfterStart: await captureProfileEvidence(profile),
        screenshot: await screenshot(
          active.cdp,
          join(resultsDir, '02-calendar-anchor-after-fresh-process.png'),
        ),
        observedAt: new Date().toISOString(),
      });
      if (
        restoredCalendar.savedCalendarAnchor !== expectedAnchor ||
        restoredCalendar.visibleCalendarAnchor !== expectedAnchor ||
        restoredCalendar.calendarDecision !== 'restored_persisted_anchor'
      ) {
        throw new Error(
          'Calendar process-restoration contract failed: ' +
            JSON.stringify({ expectedAnchor, restoredCalendar }),
        );
      }
      receipt.passed = true;
    } else {
    active = await launchChrome({ binary, profile, url: appUrl, ordinal: 1 });
    assertLaunchContinuity(active, { profile, origin });
    const initialCalendar = await readInitialHarnessState(active.cdp, buildId);
    requireInitialSurface(initialCalendar, 'Calendar');
    if (initialCalendar.origin !== origin) {
      throw new Error(`launch 1 origin ${initialCalendar.origin} did not match ${origin}`);
    }
    receipt.sentinel.written = await writeProfileSentinel(active.cdp, sentinelValue);
    if (receipt.sentinel.written.value !== sentinelValue) {
      throw new Error('neutral profile sentinel was not readable immediately after write');
    }
    await sendHarnessKey(active.cdp, 'p');
    const planner = await waitForSurface(active.cdp, 'Planner', buildId);
    const plannerDurability = await waitForLocalStorageDurability(profile, [
      sentinelKey,
      ...requiredAppStorageKeys(account),
      '/rhythm/today',
    ]);
    const storageBeforePlannerTermination = await active.cdp.evaluate(
      `Object.fromEntries(Object.entries(localStorage).sort())`,
    );
    receipt.launches.push({
      ...browserLaunchEvidence(active),
      expectedSurface: 'Planner',
      observedUrl: planner.url,
      initialState: initialCalendar,
      storageBeforeTermination: storageBeforePlannerTermination,
      sentinelPresentBeforeTermination:
        storageBeforePlannerTermination[sentinelKey] === sentinelValue,
      durabilityBeforeTermination: plannerDurability,
      profileBeforeTermination: await captureProfileEvidence(profile),
      screenshot: await screenshot(active.cdp, join(resultsDir, '01-planner-before-termination.png')),
      observedAt: new Date().toISOString(),
    });
    receipt.forcedTerminations.push(await forceTerminate(active, resultsDir));
    active = undefined;

    active = await launchChrome({ binary, profile, url: appUrl, ordinal: 2 });
    assertLaunchContinuity(active, { profile, origin });
    const restoredPlanner = await readInitialHarnessState(active.cdp, buildId);
    const plannerClassification = classifyFreshProcess({
      state: restoredPlanner,
      expectedSurface: 'Planner',
      expectedOrigin: origin,
      sentinelValue,
      account,
    });
    receipt.classifications.push({ ordinal: 2, ...plannerClassification });
    receipt.launches.push({
      ...browserLaunchEvidence(active),
      expectedInitialSurface: 'Planner',
      initialState: restoredPlanner,
      profileImmediatelyAfterStart: await captureProfileEvidence(profile),
      observedAt: new Date().toISOString(),
    });
    requireFreshProcessClassification(plannerClassification);
    await sendHarnessKey(active.cdp, 'l');
    const library = await waitForSurface(active.cdp, 'Library', buildId);
    const libraryDurability = await waitForLocalStorageDurability(profile, [
      sentinelKey,
      ...requiredAppStorageKeys(account),
      '/nodes',
    ]);
    Object.assign(receipt.launches.at(-1), {
      expectedSurface: 'Library',
      observedUrl: library.url,
      storageBeforeTermination: await active.cdp.evaluate(
        `Object.fromEntries(Object.entries(localStorage).sort())`,
      ),
      durabilityBeforeTermination: libraryDurability,
      profileBeforeTermination: await captureProfileEvidence(profile),
      screenshot: await screenshot(active.cdp, join(resultsDir, '02-library-before-termination.png')),
    });
    receipt.forcedTerminations.push(await forceTerminate(active, resultsDir));
    active = undefined;

    active = await launchChrome({ binary, profile, url: appUrl, ordinal: 3 });
    assertLaunchContinuity(active, { profile, origin });
    const restoredLibrary = await readInitialHarnessState(active.cdp, buildId);
    const libraryClassification = classifyFreshProcess({
      state: restoredLibrary,
      expectedSurface: 'Library',
      expectedOrigin: origin,
      sentinelValue,
      account,
    });
    receipt.classifications.push({ ordinal: 3, ...libraryClassification });
    receipt.launches.push({
      ...browserLaunchEvidence(active),
      expectedInitialSurface: 'Library',
      initialState: restoredLibrary,
      profileImmediatelyAfterStart: await captureProfileEvidence(profile),
      screenshot: await screenshot(active.cdp, join(resultsDir, '03-library-restored.png')),
      observedAt: new Date().toISOString(),
    });
    requireFreshProcessClassification(libraryClassification);
    receipt.passed = true;
    }
  } catch (error) {
    receipt.error = error?.stack ?? String(error);
    if (error?.quiescenceEvidence) {
      receipt.quiescenceFailure = error.quiescenceEvidence;
    }
    if (error?.terminationEvidence) {
      receipt.forcedTerminations.push(error.terminationEvidence);
      active = undefined;
    }
    if (active) {
      try {
        receipt.failureBrowserState = await active.cdp.evaluate(`(async () => ({
          title: document.title,
          url: location.href,
          origin: location.origin,
          localStorage: Object.fromEntries(Object.entries(localStorage).sort()),
          indexedDB: typeof indexedDB.databases === 'function'
            ? await indexedDB.databases()
            : [],
        }))()`);
        receipt.failureScreenshot = await screenshot(
          active.cdp,
          join(resultsDir, 'failure-state.png'),
        );
        const dom = await active.cdp.evaluate(`document.documentElement.outerHTML`);
        await writeFile(join(resultsDir, 'failure-dom.html'), dom);
      } catch (captureError) {
        receipt.failureCaptureError = String(captureError);
      }
    }
    throw error;
  } finally {
    if (active) {
      try {
        receipt.cleanupTermination = await forceTerminate(active, resultsDir);
      } catch (error) {
        receipt.cleanupError = String(error);
      }
    }
    await new Promise((resolveClose) => server.close(resolveClose));
    receipt.profile.finalEvidence = await captureProfileEvidence(profile);
    await rm(profile, { recursive: true, force: true });
    receipt.profile.removedAt = new Date().toISOString();
    await writeFile(
      join(resultsDir, 'process-gate-receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
