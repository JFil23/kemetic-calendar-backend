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
  waitForTodayViewportQuiescence,
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

function quiescenceObservation(
  view,
  {
    authorityView = view,
    generation = 100,
    intentGeneration = generation,
    settled = true,
    hydrating = false,
  } = {},
) {
  const [authorityYear, authorityMonth, authorityDay] = authorityView
    .split('-')
    .map(Number);
  const authority = authorityFixture({
    route: '/',
    generation,
    calendar: {
      kYear: authorityYear,
      kMonth: authorityMonth,
      kDay: authorityDay,
      showGregorian: false,
      expansion: 'compact',
      anchorTarget: 'monthBody',
      anchorAlignment: 0.458,
      viewportHeight: 761,
      layoutRevision: 1,
    },
  });
  const validated = validateRestorationAuthorityRead(authority, {
    account,
    expectedRoute: '/',
  });
  return {
    state: {
      route: '/',
      view,
      intentGeneration,
      settled,
      hydrating,
      stateIdentity: 7,
    },
    authority: { read: authority, validated },
  };
}

async function runQuiescenceSequence(
  sequence,
  { timeoutMs = 1_000, requiredConsecutive = 3 } = {},
) {
  let index = 0;
  let nowMs = 0;
  return waitForTodayViewportQuiescence({
    minimumYear: 5,
    description: 'fixture viewport quiescence',
    timeoutMs,
    requiredConsecutive,
    readObservation: async () => sequence[index++ % sequence.length],
    waitForNextObservation: async () => {
      nowMs += 100;
    },
    now: () => nowMs,
  });
}

test('threshold crossing followed by continued momentum is not accepted', async () => {
  const result = await runQuiescenceSequence([
    quiescenceObservation('5-1-5'),
    quiescenceObservation('5-3-5'),
    quiescenceObservation('5-3-5'),
    quiescenceObservation('5-3-5'),
  ]);
  assert.equal(result.state.view, '5-3-5');
  assert.equal(result.evidence.acceptedObservationIndex, 3);
  assert.equal(result.evidence.observations[0].accepted, false);
  assert.equal(result.evidence.observations[1].movementDetected, true);
});

test('consecutive identical viewport and acknowledged authority are accepted', async () => {
  const result = await runQuiescenceSequence([
    quiescenceObservation('5-3-5', { generation: 101 }),
    quiescenceObservation('5-3-5', { generation: 101 }),
    quiescenceObservation('5-3-5', { generation: 101 }),
  ]);
  assert.equal(result.state.view, '5-3-5');
  assert.equal(result.authority.validated.generation, 101);
  assert.equal(result.evidence.consecutiveIdenticalViewportObservations, 3);
  assert.equal(result.evidence.authorityMatchedViewport, true);
});

test('stable viewport with mismatched acknowledged authority is rejected', async () => {
  await assert.rejects(
    runQuiescenceSequence(
      [quiescenceObservation('5-1-5', { authorityView: '5-3-5' })],
      { timeoutMs: 300 },
    ),
    (error) => {
      assert.match(error.message, /did not become quiescent and authoritative/);
      assert.match(error.message, /authority Calendar 5-3-5 did not match viewport 5-1-5/);
      assert.equal(error.quiescenceEvidence.observations.at(-1).authorityMatchedViewport, false);
      return true;
    },
  );
});

test('authority match while viewport is still moving is rejected', async () => {
  await assert.rejects(
    runQuiescenceSequence(
      [
        quiescenceObservation('5-1-5'),
        quiescenceObservation('5-3-5'),
        quiescenceObservation('5-5-5'),
      ],
      { timeoutMs: 500 },
    ),
    (error) => {
      assert.equal(
        error.quiescenceEvidence.observations.every(
          (observation) => observation.authorityMatchedViewport,
        ),
        true,
      );
      assert.equal(error.quiescenceEvidence.maximumConsecutiveIdenticalViewportObservations, 1);
      return true;
    },
  );
});

test('quiescence timeout includes actionable viewport and authority evidence', async () => {
  await assert.rejects(
    runQuiescenceSequence(
      [
        quiescenceObservation('5-1-5', { authorityView: '5-3-5', intentGeneration: 544 }),
        quiescenceObservation('5-3-5', { intentGeneration: 544 }),
      ],
      { timeoutMs: 400 },
    ),
    (error) => {
      assert.match(error.message, /lastViewport=5-3-5/);
      assert.match(error.message, /intentGeneration=544/);
      assert.equal(error.quiescenceEvidence.timedOut, true);
      assert.equal(error.quiescenceEvidence.observations.length, 4);
      assert.deepEqual(
        error.quiescenceEvidence.observations.map((observation) => observation.viewport),
        ['5-1-5', '5-3-5', '5-1-5', '5-3-5'],
      );
      return true;
    },
  );
});

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
