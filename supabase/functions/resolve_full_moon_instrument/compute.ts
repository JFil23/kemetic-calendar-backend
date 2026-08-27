import {
  Body,
  EclipseKind,
  Equator,
  Horizon,
  Observer,
  SearchHourAngle,
  SearchLunarEclipse,
  SearchMoonPhase,
  SearchRiseSet,
} from "astronomy-engine";

import {
  ANCHOR_TOLERANCE_SECONDS,
  FULL_MOON_CALCULATION_SCHEMA_VERSION,
  FULL_MOON_INSTRUMENT_SCHEMA_VERSION,
  type FullMoonInstrumentRequest,
  type FullMoonInstrumentResult,
  type LunarEclipseContact,
  type LunarEclipseContactKind,
  type LunarPositionSample,
} from "./contract.ts";

const ASTRONOMY_ENGINE_VERSION = "2.1.19" as const;
const MINUTE_MS = 60_000;
const SAMPLE_INTERVAL_MS = 5 * MINUTE_MS;

function iso(value: Date): string {
  return value.toISOString();
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function position(
  observer: Observer,
  at: Date,
): LunarPositionSample {
  const equatorial = Equator(Body.Moon, at, observer, true, true);
  const horizontal = Horizon(
    at,
    observer,
    equatorial.ra,
    equatorial.dec,
    "normal",
  );
  return {
    atUtc: iso(at),
    altitudeDegrees: rounded(horizontal.altitude),
    azimuthDegrees: rounded(horizontal.azimuth),
  };
}

function secondsBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 1000);
}

function eventDate(value: { date: Date } | Date): Date {
  return value instanceof Date ? value : value.date;
}

function contact(
  observer: Observer,
  kind: LunarEclipseContactKind,
  peak: Date,
  offsetMinutes: number,
): LunarEclipseContact {
  const at = new Date(peak.getTime() + offsetMinutes * MINUTE_MS);
  const sample = position(observer, at);
  return {
    kind,
    ...sample,
    locallyVisible: sample.altitudeDegrees >= 0,
  };
}

function sampleWindow(
  observer: Observer,
  rise: Date,
  transit: Date,
  set: Date,
  contacts: LunarEclipseContact[],
): LunarPositionSample[] {
  const instants = new Set<number>([
    rise.getTime(),
    transit.getTime(),
    set.getTime(),
    ...contacts.map((item) => Date.parse(item.atUtc)),
  ]);
  for (
    let time = rise.getTime();
    time <= set.getTime();
    time += SAMPLE_INTERVAL_MS
  ) {
    instants.add(time);
  }
  return [...instants]
    .filter((time) => time >= rise.getTime() && time <= set.getTime())
    .sort((a, b) => a - b)
    .map((time) => position(observer, new Date(time)));
}

export function computeFullMoonInstrument(
  request: FullMoonInstrumentRequest,
): FullMoonInstrumentResult {
  const catalogPhase = new Date(request.catalogPhaseInstantUtc);
  const elevationAssumed = request.elevationMeters == null;
  const elevationMeters = request.elevationMeters ?? 0;
  const observer = new Observer(
    request.latitude,
    request.longitude,
    elevationMeters,
  );

  const computedPhaseTime = SearchMoonPhase(
    180,
    new Date(catalogPhase.getTime() - 2 * 86_400_000),
    4,
  );
  if (computedPhaseTime == null) {
    throw new Error("Full Moon phase could not be resolved");
  }
  const computedPhase = eventDate(computedPhaseTime);

  // Full Moon culmination is close to local midnight. Starting eighteen hours
  // before the catalog anchor finds the transit belonging to this observing
  // cycle instead of an unrelated next rise/set event.
  const transitEvent = SearchHourAngle(
    Body.Moon,
    observer,
    0,
    new Date(catalogPhase.getTime() - 18 * 3_600_000),
    +1,
  );
  const transit = eventDate(transitEvent.time);
  const riseTime = SearchRiseSet(Body.Moon, observer, +1, transit, -2, 0);
  const setTime = SearchRiseSet(Body.Moon, observer, -1, transit, +2, 0);
  if (riseTime == null || setTime == null) {
    throw new Error(
      "Moonrise or moonset is unavailable for this observing cycle",
    );
  }
  const rise = eventDate(riseTime);
  const set = eventDate(setTime);
  if (!(rise < transit && transit < set)) {
    throw new Error("Resolved lunar cycle does not surround transit");
  }

  const issues: string[] = [];
  const phaseDeltaSeconds = secondsBetween(catalogPhase, computedPhase);
  if (phaseDeltaSeconds > ANCHOR_TOLERANCE_SECONDS) {
    issues.push("catalog_phase_anchor_mismatch");
  }

  let eclipse: FullMoonInstrumentResult["eclipse"];
  let eclipsePeakDeltaSeconds: number | undefined;
  let contacts: LunarEclipseContact[] = [];
  if (request.catalogEclipsePeakUtc != null) {
    const catalogPeak = new Date(request.catalogEclipsePeakUtc);
    const eclipseInfo = SearchLunarEclipse(
      new Date(catalogPeak.getTime() - 7 * 86_400_000),
    );
    if (eclipseInfo.kind !== EclipseKind.Partial) {
      issues.push("catalog_eclipse_kind_mismatch");
    }
    const computedPeak = eventDate(eclipseInfo.peak);
    eclipsePeakDeltaSeconds = secondsBetween(catalogPeak, computedPeak);
    if (eclipsePeakDeltaSeconds > ANCHOR_TOLERANCE_SECONDS) {
      issues.push("catalog_eclipse_anchor_mismatch");
    }
    contacts = [
      contact(observer, "P1", computedPeak, -eclipseInfo.sd_penum),
      contact(observer, "U1", computedPeak, -eclipseInfo.sd_partial),
      contact(observer, "MAX", computedPeak, 0),
      contact(observer, "U4", computedPeak, eclipseInfo.sd_partial),
      contact(observer, "P4", computedPeak, eclipseInfo.sd_penum),
    ];
    eclipse = {
      kind: "partial",
      catalogPeakUtc: iso(catalogPeak),
      computedPeakUtc: iso(computedPeak),
      obscuration: rounded(eclipseInfo.obscuration),
      contacts,
    };
  }

  return {
    schemaVersion: FULL_MOON_INSTRUMENT_SCHEMA_VERSION,
    status: issues.length === 0 ? "ok" : "anchor_mismatch",
    skyEventId: request.skyEventId,
    ...(request.companionSkyEventId == null
      ? {}
      : { companionSkyEventId: request.companionSkyEventId }),
    catalogPhaseInstantUtc: iso(catalogPhase),
    computedPhaseInstantUtc: iso(computedPhase),
    riseUtc: iso(rise),
    transitUtc: iso(transit),
    setUtc: iso(set),
    samples: sampleWindow(observer, rise, transit, set, contacts),
    ...(eclipse == null ? {} : { eclipse }),
    validation: {
      toleranceSeconds: ANCHOR_TOLERANCE_SECONDS,
      phaseDeltaSeconds,
      ...(eclipsePeakDeltaSeconds == null ? {} : { eclipsePeakDeltaSeconds }),
      issues,
    },
    provenance: {
      astronomyEngineVersion: ASTRONOMY_ENGINE_VERSION,
      calculationSchemaVersion: FULL_MOON_CALCULATION_SCHEMA_VERSION,
      observerLatitude: request.latitude,
      observerLongitude: request.longitude,
      elevationMeters,
      elevationAssumed,
    },
  };
}
