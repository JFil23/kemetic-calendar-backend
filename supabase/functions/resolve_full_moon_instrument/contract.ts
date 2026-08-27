export const FULL_MOON_INSTRUMENT_SCHEMA_VERSION = 1 as const;
export const FULL_MOON_CALCULATION_SCHEMA_VERSION =
  "full-moon-local-v1" as const;
export const ANCHOR_TOLERANCE_SECONDS = 15 * 60;

export type FullMoonInstrumentRequest = {
  schemaVersion: 1;
  skyEventId: string;
  companionSkyEventId?: string;
  catalogPhaseInstantUtc: string;
  catalogEclipsePeakUtc?: string;
  latitude: number;
  longitude: number;
  elevationMeters?: number;
};

export type LunarPositionSample = {
  atUtc: string;
  altitudeDegrees: number;
  azimuthDegrees: number;
};

export type LunarEclipseContactKind = "P1" | "U1" | "MAX" | "U4" | "P4";

export type LunarEclipseContact = LunarPositionSample & {
  kind: LunarEclipseContactKind;
  locallyVisible: boolean;
};

export type FullMoonInstrumentResult = {
  schemaVersion: 1;
  status: "ok" | "anchor_mismatch";
  skyEventId: string;
  companionSkyEventId?: string;
  catalogPhaseInstantUtc: string;
  computedPhaseInstantUtc: string;
  riseUtc: string;
  transitUtc: string;
  setUtc: string;
  samples: LunarPositionSample[];
  eclipse?: {
    kind: "partial";
    catalogPeakUtc: string;
    computedPeakUtc: string;
    obscuration: number;
    contacts: LunarEclipseContact[];
  };
  validation: {
    toleranceSeconds: number;
    phaseDeltaSeconds: number;
    eclipsePeakDeltaSeconds?: number;
    issues: string[];
  };
  provenance: {
    astronomyEngineVersion: "2.1.19";
    calculationSchemaVersion: "full-moon-local-v1";
    observerLatitude: number;
    observerLongitude: number;
    elevationMeters: number;
    elevationAssumed: boolean;
  };
};

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractError(`${key} is required`);
  }
  return value.trim();
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractError(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function utcInstant(value: string, key: string): string {
  if (!value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new ContractError(`${key} must be an ISO-8601 UTC instant`);
  }
  return new Date(value).toISOString();
}

function boundedNumber(
  body: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = body[key];
  if (
    typeof value !== "number" || !Number.isFinite(value) ||
    value < minimum || value > maximum
  ) {
    throw new ContractError(`${key} is outside its allowed range`);
  }
  return value;
}

export function parseFullMoonInstrumentRequest(
  value: unknown,
): FullMoonInstrumentRequest {
  if (!isRecord(value)) throw new ContractError("body must be an object");
  if (value.schemaVersion !== FULL_MOON_INSTRUMENT_SCHEMA_VERSION) {
    throw new ContractError("unsupported schemaVersion");
  }

  const companionSkyEventId = optionalString(value, "companionSkyEventId");
  const catalogEclipsePeakRaw = optionalString(
    value,
    "catalogEclipsePeakUtc",
  );
  if ((companionSkyEventId == null) !== (catalogEclipsePeakRaw == null)) {
    throw new ContractError(
      "companionSkyEventId and catalogEclipsePeakUtc must be supplied together",
    );
  }

  const elevationRaw = value.elevationMeters;
  const elevationMeters = elevationRaw == null
    ? undefined
    : boundedNumber(value, "elevationMeters", -500, 10_000);

  return {
    schemaVersion: FULL_MOON_INSTRUMENT_SCHEMA_VERSION,
    skyEventId: requiredString(value, "skyEventId"),
    ...(companionSkyEventId == null ? {} : { companionSkyEventId }),
    catalogPhaseInstantUtc: utcInstant(
      requiredString(value, "catalogPhaseInstantUtc"),
      "catalogPhaseInstantUtc",
    ),
    ...(catalogEclipsePeakRaw == null ? {} : {
      catalogEclipsePeakUtc: utcInstant(
        catalogEclipsePeakRaw,
        "catalogEclipsePeakUtc",
      ),
    }),
    latitude: boundedNumber(value, "latitude", -90, 90),
    longitude: boundedNumber(value, "longitude", -180, 180),
    ...(elevationMeters == null ? {} : { elevationMeters }),
  };
}
