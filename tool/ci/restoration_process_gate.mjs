#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

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

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
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
  }

  call(method, params = {}) {
    const id = this.nextId++;
    const completion = new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
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

async function launchChrome({ binary, profile, url }) {
  const debugPort = await reservePort();
  const child = spawn(
    binary,
    [
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
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  const target = await waitForJson(
    `http://127.0.0.1:${debugPort}/json/list`,
    (targets) => targets.find((item) => item.type === 'page' && item.url.startsWith(url.split('?')[0])),
  );
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  return { child, cdp, debugPort };
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
    `(() => {
      const prefix = ${JSON.stringify(`LOCK_GATE|${buildId}|`)};
      if (!document.title.startsWith(prefix)) return null;
      const parts = document.title.split('|');
      const visibleRoute = location.hash.startsWith('#/')
        ? location.hash.slice(1).split('?')[0]
        : location.pathname;
      return {
        title: document.title,
        label: parts[2],
        route: parts[3],
        visibleRoute,
        url: location.href,
        localStorage: Object.fromEntries(Object.entries(localStorage).sort()),
      };
    })()`,
    'initial rendered harness state',
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

async function forceTerminate(launch) {
  launch.cdp.close();
  process.kill(launch.child.pid, 'SIGTERM');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${launch.debugPort}/json/version`);
    } catch {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  process.kill(-launch.child.pid, 'SIGKILL');
  throw new Error(
    `browser process ${launch.child.pid} ignored SIGTERM and required cleanup SIGKILL`,
  );
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
  const appUrl = `http://127.0.0.1:${port}/?account=lock-gate`;
  const receipt = {
    schemaVersion: 1,
    passed: false,
    buildId,
    browserBinary: binary,
    origin: `http://127.0.0.1:${port}`,
    accountNamespace: 'restoration-e2e-lock-gate',
    selection: processUnit,
    selectionManifestSha256: sha256(manifestBytes),
    launches: [],
    forcedTerminations: [],
    buildArtifacts: {},
  };
  let active;
  try {
    for (const file of ['index.html', 'flutter_bootstrap.js', 'main.dart.js']) {
      const bytes = await readFile(join(webRoot, file));
      receipt.buildArtifacts[file] = { sha256: sha256(bytes), bytes: bytes.length };
    }

    active = await launchChrome({ binary, profile, url: appUrl });
    const initialCalendar = await readInitialHarnessState(active.cdp, buildId);
    requireInitialSurface(initialCalendar, 'Calendar');
    await sendHarnessKey(active.cdp, 'p');
    const planner = await waitForSurface(active.cdp, 'Planner', buildId);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
    receipt.launches.push({
      ordinal: 1,
      pid: active.child.pid,
      expectedSurface: 'Planner',
      observedUrl: planner.url,
      storageBeforeTermination: await active.cdp.evaluate(
        `Object.fromEntries(Object.entries(localStorage).sort())`,
      ),
      screenshot: await screenshot(active.cdp, join(resultsDir, '01-planner-before-termination.png')),
      observedAt: new Date().toISOString(),
    });
    receipt.forcedTerminations.push({ ordinal: 1, pid: active.child.pid, signal: 'SIGTERM' });
    await forceTerminate(active);
    active = undefined;

    active = await launchChrome({ binary, profile, url: appUrl });
    const restoredPlanner = await readInitialHarnessState(active.cdp, buildId);
    requireInitialSurface(restoredPlanner, 'Planner');
    await sendHarnessKey(active.cdp, 'l');
    const library = await waitForSurface(active.cdp, 'Library', buildId);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
    receipt.launches.push({
      ordinal: 2,
      pid: active.child.pid,
      expectedInitialSurface: 'Planner',
      initialObservedUrl: restoredPlanner.url,
      initialStorage: restoredPlanner.localStorage,
      expectedSurface: 'Library',
      observedUrl: library.url,
      screenshot: await screenshot(active.cdp, join(resultsDir, '02-library-before-termination.png')),
      observedAt: new Date().toISOString(),
    });
    receipt.forcedTerminations.push({ ordinal: 2, pid: active.child.pid, signal: 'SIGTERM' });
    await forceTerminate(active);
    active = undefined;

    active = await launchChrome({ binary, profile, url: appUrl });
    const restoredLibrary = await readInitialHarnessState(active.cdp, buildId);
    requireInitialSurface(restoredLibrary, 'Library');
    receipt.launches.push({
      ordinal: 3,
      pid: active.child.pid,
      expectedInitialSurface: 'Library',
      initialObservedUrl: restoredLibrary.url,
      initialStorage: restoredLibrary.localStorage,
      screenshot: await screenshot(active.cdp, join(resultsDir, '03-library-restored.png')),
      observedAt: new Date().toISOString(),
    });
    receipt.passed = true;
  } catch (error) {
    receipt.error = error?.stack ?? String(error);
    if (active) {
      try {
        receipt.failureBrowserState = await active.cdp.evaluate(`({
          title: document.title,
          url: location.href,
          localStorage: Object.fromEntries(Object.entries(localStorage).sort()),
        })`);
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
        await forceTerminate(active);
      } catch (error) {
        receipt.cleanupError = String(error);
      }
    }
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(profile, { recursive: true, force: true });
    await writeFile(
      join(resultsDir, 'process-gate-receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
