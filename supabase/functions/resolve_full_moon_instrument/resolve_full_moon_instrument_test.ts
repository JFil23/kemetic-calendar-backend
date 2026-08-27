import { deepStrictEqual, equal, match, ok } from "node:assert/strict";

import {
  ContractError,
  type FullMoonInstrumentResult,
  parseFullMoonInstrumentRequest,
} from "./contract.ts";
import { computeFullMoonInstrument } from "./compute.ts";
import { createResolveFullMoonInstrumentHandler } from "./index.ts";

const catalogRequest = {
  schemaVersion: 1,
  skyEventId: "full-moon-2026-08-28",
  companionSkyEventId: "lunar-eclipse-2026-08-28",
  catalogPhaseInstantUtc: "2026-08-28T04:18:00Z",
  catalogEclipsePeakUtc: "2026-08-28T04:13:00Z",
  latitude: 37.7749,
  longitude: -122.4194,
} as const;

Deno.test("request contract validates bounds, UTC, and paired eclipse identity", () => {
  const parsed = parseFullMoonInstrumentRequest(catalogRequest);
  equal(parsed.latitude, 37.7749);
  equal(parsed.elevationMeters, undefined);

  for (
    const invalid of [
      { ...catalogRequest, latitude: 91 },
      { ...catalogRequest, longitude: -181 },
      {
        ...catalogRequest,
        catalogPhaseInstantUtc: "2026-08-28T04:18:00-07:00",
      },
      { ...catalogRequest, companionSkyEventId: undefined },
    ]
  ) {
    let error: unknown;
    try {
      parseFullMoonInstrumentRequest(invalid);
    } catch (caught) {
      error = caught;
    }
    ok(error instanceof ContractError);
  }
});

Deno.test("real catalog anchors resolve the transit-centered partial eclipse schema", () => {
  const result = computeFullMoonInstrument(
    parseFullMoonInstrumentRequest(catalogRequest),
  );
  equal(result.status, "ok");
  equal(result.schemaVersion, 1);
  equal(result.catalogPhaseInstantUtc, "2026-08-28T04:18:00.000Z");
  ok(result.computedPhaseInstantUtc.endsWith("Z"));
  ok(Date.parse(result.riseUtc) < Date.parse(result.transitUtc));
  ok(Date.parse(result.transitUtc) < Date.parse(result.setUtc));
  ok(result.samples.length > 20);
  deepStrictEqual(
    result.eclipse?.contacts.map((item) => item.kind),
    ["P1", "U1", "MAX", "U4", "P4"],
  );
  equal(result.provenance.elevationMeters, 0);
  equal(result.provenance.elevationAssumed, true);
  equal(result.provenance.astronomyEngineVersion, "2.1.19");
  ok(result.validation.phaseDeltaSeconds <= result.validation.toleranceSeconds);
  ok(
    (result.validation.eclipsePeakDeltaSeconds ?? Infinity) <=
      result.validation.toleranceSeconds,
  );
});

Deno.test("catalog mismatch is explicit and never overwrites the catalog anchor", () => {
  const request = parseFullMoonInstrumentRequest({
    ...catalogRequest,
    catalogPhaseInstantUtc: "2026-08-27T04:18:00Z",
    companionSkyEventId: undefined,
    catalogEclipsePeakUtc: undefined,
  });
  const result = computeFullMoonInstrument(request);
  equal(result.status, "anchor_mismatch");
  equal(result.catalogPhaseInstantUtc, "2026-08-27T04:18:00.000Z");
  ok(result.validation.issues.includes("catalog_phase_anchor_mismatch"));
});

Deno.test("handler requires auth and returns 422 for provenance mismatch", async () => {
  const unauthorized = await createResolveFullMoonInstrumentHandler()(
    new Request("http://localhost/resolve_full_moon_instrument", {
      method: "POST",
      body: JSON.stringify(catalogRequest),
    }),
  );
  equal(unauthorized.status, 401);

  const mismatch: FullMoonInstrumentResult = {
    ...computeFullMoonInstrument(
      parseFullMoonInstrumentRequest(catalogRequest),
    ),
    status: "anchor_mismatch",
    validation: {
      toleranceSeconds: 900,
      phaseDeltaSeconds: 901,
      issues: ["catalog_phase_anchor_mismatch"],
    },
  };
  const response = await createResolveFullMoonInstrumentHandler({
    compute: () => mismatch,
  })(
    new Request("http://localhost/resolve_full_moon_instrument", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(catalogRequest),
    }),
  );
  equal(response.status, 422);
  const body = await response.json();
  equal(body.status, "anchor_mismatch");
  match(JSON.stringify(body), /catalog_phase_anchor_mismatch/);
});
