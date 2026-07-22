import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Cdp,
  assertPersistentBrowserContext,
  bufferContainsStorageToken,
  classifyFreshProcess,
  compareRestorationAuthorityReads,
  legacyMirrorDiagnostics,
  restorationEnvelopeIntegrity,
  terminationBoundaryReady,
  validateRestorationAuthorityRead,
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

function authorityFixture({
  fixtureAccount = account,
  route = '/rhythm/today',
  generation = 100,
  snapshotGeneration = generation,
  calendar = {
    kYear: 5,
    kMonth: 5,
    kDay: 5,
    showGregorian: false,
    expansion: 'compact',
    anchorTarget: 'monthBody',
    anchorAlignment: 0.458,
    viewportHeight: 761,
    layoutRevision: 1,
  },
} = {}) {
  const snapshot = {
    routeLocation: route,
    launchRouteMetadata: {
      schemaVersion: 2,
      source: 'userPrimaryTab',
      routeClass: 'durablePrimary',
      section: route === '/rhythm/today' ? 'planner' : 'calendar',
      canonicalRoute: route,
      recordedAtMs: generation,
      canRecordPrimarySelection: true,
      canRestoreAsSurface: true,
    },
    schemaVersion: 1,
    userId: fixtureAccount,
    windowId: 'window-fixture',
    updatedAtMs: snapshotGeneration,
    calendar,
  };
  const envelope = {
    authoritySchemaVersion: 1,
    snapshotSchemaVersion: 1,
    userId: fixtureAccount,
    windowId: 'window-fixture',
    generation,
    snapshotJson: JSON.stringify(snapshot),
  };
  envelope.integrity = restorationEnvelopeIntegrity(envelope);
  return {
    databaseName: 'kemetic.restoration.authority.v1',
    databaseVersion: 1,
    storeName: 'snapshots',
    lastActiveUserKey: 'last_user',
    latestEnvelopeKey: `latest:${fixtureAccount}`,
    databasePresent: true,
    storePresent: true,
    transactionMode: 'readonly',
    readCompleted: true,
    writesAttempted: false,
    lastActiveUserId: fixtureAccount,
    latestEnvelope: JSON.stringify(envelope),
  };
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

test('profile durability token detection supports LevelDB string encodings', () => {
  const token = 'lock-gate.profile-sentinel.v1';
  assert.equal(bufferContainsStorageToken(Buffer.from(`prefix${token}suffix`), token), true);
  assert.equal(
    bufferContainsStorageToken(Buffer.concat([Buffer.from('prefix'), Buffer.from(token, 'utf16le')]), token),
    true,
  );
  assert.equal(bufferContainsStorageToken(Buffer.from('unrelated bytes'), token), false);
});

test('neutral authority validates the exact production database envelope contract', () => {
  const authority = authorityFixture();
  assert.equal(
    JSON.parse(authority.latestEnvelope).integrity,
    'fnv1a32:07e42d50',
    'the harness must retain the deployed Flutter-web checksum semantics',
  );
  const validated = validateRestorationAuthorityRead(authority, {
    account,
    expectedRoute: '/rhythm/today',
    expectedCalendarView: '5-5-5',
  });
  assert.equal(validated.account, account);
  assert.equal(validated.generation, 100);
  assert.equal(validated.routeLocation, '/rhythm/today');
  assert.deepEqual(
    [validated.calendar.kYear, validated.calendar.kMonth, validated.calendar.kDay],
    [5, 5, 5],
  );
  assert.equal(validated.commitContract.productionAcknowledgement, 'IDBTransaction.oncomplete');
  assert.equal(
    validateRestorationAuthorityRead(authority, {
      account,
      expectedRoute: '/rhythm/today',
    }).calendar.kMonth,
    5,
    'a live authority read validates its bound Calendar value without inventing an older expectation',
  );
});

test('neutral authority rejects wrong principal, integrity, and generation binding', () => {
  assert.throws(
    () =>
      validateRestorationAuthorityRead(authorityFixture({ fixtureAccount: 'foreign' }), {
        account,
        expectedRoute: '/rhythm/today',
        expectedCalendarView: '5-5-5',
      }),
    /principal\/key mismatch/,
  );

  const invalidIntegrity = authorityFixture();
  const rawEnvelope = JSON.parse(invalidIntegrity.latestEnvelope);
  rawEnvelope.integrity = 'fnv1a32:00000000';
  invalidIntegrity.latestEnvelope = JSON.stringify(rawEnvelope);
  assert.throws(
    () =>
      validateRestorationAuthorityRead(invalidIntegrity, {
        account,
        expectedRoute: '/rhythm/today',
        expectedCalendarView: '5-5-5',
      }),
    /integrity mismatch/,
  );

  assert.throws(
    () =>
      validateRestorationAuthorityRead(authorityFixture({ snapshotGeneration: 99 }), {
        account,
        expectedRoute: '/rhythm/today',
        expectedCalendarView: '5-5-5',
      }),
    /generation\/route mismatch/,
  );
});

test('neutral authority rejects route, viewport, or mutating-reader mismatches', () => {
  assert.throws(
    () =>
      validateRestorationAuthorityRead(authorityFixture({ route: '/' }), {
        account,
        expectedRoute: '/rhythm/today',
        expectedCalendarView: '5-5-5',
      }),
    /generation\/route mismatch/,
  );
  assert.throws(
    () =>
      validateRestorationAuthorityRead(authorityFixture(), {
        account,
        expectedRoute: '/rhythm/today',
        expectedCalendarView: '6-5-5',
      }),
    /Calendar anchor\/placement mismatch/,
  );
  assert.throws(
    () =>
      validateRestorationAuthorityRead(
        { ...authorityFixture(), writesAttempted: true },
        {
          account,
          expectedRoute: '/rhythm/today',
          expectedCalendarView: '5-5-5',
        },
      ),
    /invalid restoration authority reader context/,
  );
});

test('neutral authority comparison requires the exact acknowledged envelope', () => {
  const expected = authorityFixture();
  assert.equal(
    compareRestorationAuthorityReads(expected, expected, 'fixture').exact,
    true,
  );
  assert.throws(
    () =>
      compareRestorationAuthorityReads(
        authorityFixture({ generation: 101 }),
        expected,
        'fixture',
      ),
    /exact acknowledged authority/,
  );
});

test('stale legacy mirrors remain visible diagnostics but are not authority', () => {
  const expected = {
    [`flutter.app_restoration_latest_v2:${account}`]: 'new-planner',
    [`kemetic.restoration.critical.latest.v2:${account}`]: 'new-planner',
  };
  const diagnostic = legacyMirrorDiagnostics(
    {
      [`flutter.app_restoration_latest_v2:${account}`]: 'old-calendar',
      [`kemetic.restoration.critical.latest.v2:${account}`]: 'old-calendar',
    },
    expected,
  );
  assert.equal(diagnostic.authority, 'diagnostic-only');
  assert.equal(diagnostic.exact, false);
  assert.deepEqual(diagnostic.missingKeys, []);
  assert.deepEqual(diagnostic.changedKeys.sort(), Object.keys(expected).sort());
});
