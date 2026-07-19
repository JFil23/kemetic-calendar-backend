import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Cdp,
  assertPersistentBrowserContext,
  classifyFreshProcess,
  terminationBoundaryReady,
} from './restoration_process_gate.mjs';

const account = 'restoration-e2e-lock-gate';
const origin = 'http://127.0.0.1:43210';
const sentinelValue = 'profile-sentinel-fixture';
const requiredStorage = {
  'flutter.app_restoration_last_user_v2': `"${account}"`,
  [`flutter.app_restoration_latest_v2:${account}`]: '{"routeLocation":"/rhythm/today"}',
  'kemetic.restoration.last_user.v2': account,
  [`kemetic.restoration.critical.latest.v2:${account}`]:
    '{"routeLocation":"/rhythm/today"}',
};

function state({ label = 'Planner', route = '/rhythm/today', storage = {} } = {}) {
  return {
    label,
    route,
    visibleRoute: route,
    origin,
    localStorage: storage,
    indexedDB: [],
  };
}

function classify(value) {
  return classifyFreshProcess({
    state: value,
    expectedSurface: 'Planner',
    expectedOrigin: origin,
    sentinelValue,
    account,
  });
}

test('missing neutral sentinel classifies profile or origin lifecycle loss', () => {
  const result = classify(state({ storage: requiredStorage }));
  assert.equal(result.classification, 'profile-or-origin-lifecycle-loss');
  assert.equal(result.sentinelSurvived, false);
});

test('surviving sentinel with missing app keys classifies application storage loss', () => {
  const result = classify(
    state({ storage: { 'lock-gate.profile-sentinel.v1': sentinelValue } }),
  );
  assert.equal(result.classification, 'application-storage-loss');
  assert.equal(result.sentinelSurvived, true);
  assert.notEqual(result.missingAppKeys.length, 0);
});

test('surviving sentinel and app keys with Calendar classifies reader failure', () => {
  const result = classify(
    state({
      label: 'Calendar',
      route: '/',
      storage: { ...requiredStorage, 'lock-gate.profile-sentinel.v1': sentinelValue },
    }),
  );
  assert.equal(result.classification, 'application-restoration-reader-failure');
});

test('surviving sentinel, app keys, and expected surface pass', () => {
  const result = classify(
    state({
      storage: { ...requiredStorage, 'lock-gate.profile-sentinel.v1': sentinelValue },
    }),
  );
  assert.equal(result.classification, 'passed');
});

test('persistent browser context rejects temporary flags and profile drift', () => {
  const profile = '/tmp/profile-fixture';
  assert.doesNotThrow(() =>
    assertPersistentBrowserContext([`--user-data-dir=${profile}`], profile),
  );
  assert.throws(
    () =>
      assertPersistentBrowserContext(
        ['--incognito', `--user-data-dir=${profile}`],
        profile,
      ),
    /temporary browser context/,
  );
  assert.throws(
    () => assertPersistentBrowserContext(['--user-data-dir=/tmp/other'], profile),
    /profile mismatch/,
  );
});

test('DevTools closure alone cannot authorize a fresh-process relaunch', () => {
  assert.equal(
    terminationBoundaryReady({
      debugEndpointClosed: true,
      exitStatus: null,
      profileProcesses: ['orphaned storage service'],
      profileLockRetainers: ['live SingletonLock owner'],
    }),
    false,
  );
  assert.equal(
    terminationBoundaryReady({
      debugEndpointClosed: true,
      exitStatus: { code: 0, signal: null },
      profileProcesses: [],
      profileLockRetainers: [],
    }),
    true,
  );
});

test('stale lock artifacts do not block a fully exited profile', () => {
  assert.equal(
    terminationBoundaryReady({
      debugEndpointClosed: true,
      exitStatus: { code: 0, signal: null },
      profileProcesses: [],
      profileLockRetainers: [],
      profileLocks: ['stale SingletonLock artifact'],
    }),
    true,
  );
  assert.equal(
    terminationBoundaryReady({
      debugEndpointClosed: true,
      exitStatus: { code: 0, signal: null },
      profileProcesses: [],
      profileLockRetainers: ['live owner'],
    }),
    false,
  );
});

test('closed DevTools socket rejects calls instead of hanging recovery', async () => {
  const cdp = Object.create(Cdp.prototype);
  cdp.socket = { readyState: WebSocket.CLOSED };
  cdp.nextId = 1;
  cdp.pending = new Map();
  cdp.closedError = new Error('CDP socket closed before response');
  await assert.rejects(cdp.call('Runtime.evaluate'), /CDP socket closed/);
});
