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

async function synthesizeCalendarSwipe(cdp, direction = 'future') {
  await cdp.call('Input.synthesizeScrollGesture', {
    x: 640,
    y: 700,
    yDistance: direction === 'future' ? -1800 : 1800,
    speed: 2400,
    gestureSourceType: 'touch',
  });
}

async function scrollTodayProcessToYear(cdp, buildId, minimumYear) {
  const observations = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const before = await readTodayProcessHarnessState(cdp, buildId);
    const beforeAnchor = parseKemeticAnchor(before.view);
    observations.push({ attempt, phase: 'before', state: before });
    if (beforeAnchor && beforeAnchor.kYear >= minimumYear) {
      return { state: before, observations };
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
  const account = 'restoration-e2e-lock-gate';
  const sentinelValue = `profile-${sha256Json({ buildId, origin, profile })}`;
  const receipt = {
    schemaVersion: 2,
    passed: false,
    buildId,
    browserBinary: binary,
    origin,
    accountNamespace: account,
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
    buildArtifacts: {},
  };
  let active;
  try {
    for (const file of ['index.html', 'flutter_bootstrap.js', 'main.dart.js']) {
      const bytes = await readFile(join(webRoot, file));
      receipt.buildArtifacts[file] = { sha256: sha256(bytes), bytes: bytes.length };
    }

    if (isTodayPostProcessUnit) {
      active = await launchChrome({ binary, profile, url: appUrl, ordinal: 1 });
      assertLaunchContinuity(active, { profile, origin });
      const initialCalendar = await readTodayProcessHarnessState(active.cdp, buildId);
      requireInitialSurface(initialCalendar, 'Calendar');
      await waitForTodayProcessState(
        active.cdp,
        buildId,
        (state) => state.route === '/' && state.settled && state.view !== 'none',
        'initial settled production Calendar',
      );
      receipt.sentinel.written = await writeProfileSentinel(active.cdp, sentinelValue);
      const todayAnchor = parseKemeticAnchor(initialCalendar.today);
      if (!todayAnchor) throw new Error(`invalid Today anchor ${initialCalendar.today}`);
      const firstFarScroll = await scrollTodayProcessToYear(
        active.cdp,
        buildId,
        todayAnchor.kYear + 3,
      );
      const selectedState = firstFarScroll.state;
      const selectedAnchor = parseKemeticAnchor(selectedState.view);
      if (!selectedAnchor) throw new Error(`invalid far Calendar view ${selectedState.view}`);
      await evaluateUntil(
        active.cdp,
        `(() => Object.values(localStorage).some((value) =>
          String(value).includes(${JSON.stringify(`\"kYear\":${selectedAnchor.kYear}`)})
        ) ? true : null)()`,
        'durable far Calendar year before Planner',
      );
      await sendHarnessKey(active.cdp, 'p');
      await waitForTodayProcessState(
        active.cdp,
        buildId,
        (state) => state.route === '/rhythm/today',
        'Planner before first forced termination',
      );
      const plannerState = await readTodayProcessHarnessState(active.cdp, buildId);
      const plannerDurabilityTokens = [
        sentinelKey,
        ...requiredAppStorageKeys(account),
        '/rhythm/today',
        `\"kYear\":${selectedAnchor.kYear}`,
      ];
      const plannerStorageBeforeTermination = await active.cdp.evaluate(
        `Object.fromEntries(Object.entries(localStorage).sort())`,
      );
      const plannerStorageText = Object.entries(plannerStorageBeforeTermination)
        .flat()
        .join('\n');
      const missingPlannerTokens = plannerDurabilityTokens.filter(
        (token) => !plannerStorageText.includes(token),
      );
      if (missingPlannerTokens.length > 0) {
        throw new Error(
          `Today process state was incomplete before termination: ` +
            JSON.stringify(missingPlannerTokens),
        );
      }
      const firstLaunchEvidence = {
        ...browserLaunchEvidence(active),
        expectedSurface: 'Planner',
        initialState: initialCalendar,
        touchScrollObservations: firstFarScroll.observations,
        selectedCalendarState: selectedState,
        stateBeforeTermination: plannerState,
        storageBeforeTermination: plannerStorageBeforeTermination,
        durabilityBeforeTermination: {
          condition: 'all required tokens readable from live localStorage',
          requiredTokens: plannerDurabilityTokens,
          missingTokens: missingPlannerTokens,
        },
        profileBeforeTermination: await captureProfileEvidence(profile),
        screenshot: await screenshot(
          active.cdp,
          join(resultsDir, '01-today-process-planner-before-termination.png'),
        ),
        observedAt: new Date().toISOString(),
      };
      receipt.launches.push(firstLaunchEvidence);
      receipt.forcedTerminations.push(await forceTerminate(active, resultsDir));
      active = undefined;
      firstLaunchEvidence.durabilityAfterTermination =
        await localStorageDiskEvidence(profile, plannerDurabilityTokens);
      if (firstLaunchEvidence.durabilityAfterTermination.missingTokens.length > 0) {
        throw new Error(
          `Today process state was not durable after forced termination: ` +
            JSON.stringify(firstLaunchEvidence.durabilityAfterTermination.missingTokens),
        );
      }

      active = await launchChrome({ binary, profile, url: appUrl, ordinal: 2 });
      assertLaunchContinuity(active, { profile, origin });
      const restoredPlanner = await readTodayProcessHarnessState(active.cdp, buildId);
      const plannerClassification = classifyFreshProcess({
        state: restoredPlanner,
        expectedSurface: 'Planner',
        expectedOrigin: origin,
        sentinelValue,
        account,
      });
      receipt.classifications.push({ ordinal: 2, ...plannerClassification });
      requireFreshProcessClassification(plannerClassification);
      await sendHarnessKey(active.cdp, 'c');
      await waitForTodayProcessState(
        active.cdp,
        buildId,
        (state) => state.route === '/' && state.settled && state.view !== 'none',
        'far Calendar after fresh Planner process',
      );
      const restoredFarState = await readTodayProcessHarnessState(active.cdp, buildId);
      if (restoredFarState.view !== selectedState.view) {
        throw new Error(
          `fresh process restored ${restoredFarState.view}; expected ${selectedState.view}`,
        );
      }
      const manualScroll = await scrollTodayProcessToYear(
        active.cdp,
        buildId,
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
        'one Today command after process restoration and manual touch scroll',
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
        throw new Error(`Today did not remain stable: ${JSON.stringify(todaySamples)}`);
      }
      const laterScroll = await scrollTodayProcessToYear(
        active.cdp,
        buildId,
        todayAnchor.kYear + 1,
      );
      const laterState = laterScroll.state;
      const laterAnchor = parseKemeticAnchor(laterState.view);
      if (!laterAnchor || laterState.view === laterState.today) {
        throw new Error(`later manual Calendar position was not selected: ${laterState.view}`);
      }
      await evaluateUntil(
        active.cdp,
        `(() => Object.values(localStorage).some((value) =>
          String(value).includes(${JSON.stringify(`\"kYear\":${laterAnchor.kYear}`)})
        ) ? true : null)()`,
        'durable later manual Calendar year after Today',
      );
      await sendHarnessKey(active.cdp, 'p');
      await waitForTodayProcessState(
        active.cdp,
        buildId,
        (state) => state.route === '/rhythm/today',
        'Planner before second forced termination',
      );
      receipt.launches.push({
        ...browserLaunchEvidence(active),
        expectedInitialSurface: 'Planner',
        initialState: restoredPlanner,
        restoredFarCalendarState: restoredFarState,
        manualTouchScrollObservations: manualScroll.observations,
        manualStateBeforeToday: manualState,
        todayStabilitySamples: todaySamples,
        laterTouchScrollObservations: laterScroll.observations,
        laterStateBeforeTermination: laterState,
        profileImmediatelyAfterStart: await captureProfileEvidence(profile),
        screenshot: await screenshot(
          active.cdp,
          join(resultsDir, '02-today-after-process-and-later-scroll.png'),
        ),
        observedAt: new Date().toISOString(),
      });
      receipt.forcedTerminations.push(await forceTerminate(active, resultsDir));
      active = undefined;
      const laterDurabilityTokens = [
        sentinelKey,
        ...requiredAppStorageKeys(account),
        '/rhythm/today',
        `\"kYear\":${laterAnchor.kYear}`,
      ];
      receipt.launches.at(-1).durabilityAfterTermination =
        await localStorageDiskEvidence(profile, laterDurabilityTokens);
      if (
        receipt.launches.at(-1).durabilityAfterTermination.missingTokens.length > 0
      ) {
        throw new Error(
          `later manual Calendar state was not durable after forced termination: ` +
            JSON.stringify(
              receipt.launches.at(-1).durabilityAfterTermination.missingTokens,
            ),
        );
      }

      active = await launchChrome({ binary, profile, url: appUrl, ordinal: 3 });
      assertLaunchContinuity(active, { profile, origin });
      const secondRestoredPlanner = await readTodayProcessHarnessState(active.cdp, buildId);
      const secondPlannerClassification = classifyFreshProcess({
        state: secondRestoredPlanner,
        expectedSurface: 'Planner',
        expectedOrigin: origin,
        sentinelValue,
        account,
      });
      receipt.classifications.push({ ordinal: 3, ...secondPlannerClassification });
      requireFreshProcessClassification(secondPlannerClassification);
      await sendHarnessKey(active.cdp, 'c');
      await waitForTodayProcessState(
        active.cdp,
        buildId,
        (state) => state.route === '/' && state.settled && state.view !== 'none',
        'later manual Calendar after second fresh Planner process',
      );
      const restoredLaterState = await readTodayProcessHarnessState(active.cdp, buildId);
      if (
        restoredLaterState.view !== laterState.view ||
        restoredLaterState.view === restoredLaterState.today
      ) {
        throw new Error(
          `later manual position lost after second process: ` +
            JSON.stringify({ expected: laterState, actual: restoredLaterState }),
        );
      }
      receipt.launches.push({
        ...browserLaunchEvidence(active),
        expectedInitialSurface: 'Planner',
        initialState: secondRestoredPlanner,
        restoredLaterCalendarState: restoredLaterState,
        profileImmediatelyAfterStart: await captureProfileEvidence(profile),
        screenshot: await screenshot(
          active.cdp,
          join(resultsDir, '03-later-manual-calendar-after-second-process.png'),
        ),
        observedAt: new Date().toISOString(),
      });
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
