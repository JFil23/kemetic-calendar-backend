// Edge Function: admin_maat_dry_run
// No-write Ma'at policy dry-run for operator inspection.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  clampText,
  corsHeaders,
  createServiceClient,
  type HandlerDeps,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  serverNotConfiguredResponse,
  writeAudit,
} from "../_shared/admin.ts";
import { MAAT_GUIDANCE_POLICY_VERSION } from "../_shared/maat_guidance.ts";
import maatFixturesJson from "../_shared/maat_fixtures.json" with {
  type: "json",
};

type MaatFixture = {
  id: string;
  description: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
};

const fixturesPayload = maatFixturesJson as {
  policy_version?: string;
  fixtures?: MaatFixture[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeInputPreview(input: Record<string, unknown>) {
  const evidenceTexts = Array.isArray(input.evidenceTexts)
    ? input.evidenceTexts
      .filter((item): item is string => typeof item === "string")
      .map((item) => clampText(item, 240))
      .slice(0, 6)
    : [];

  return {
    evidenceTexts,
    planner: isRecord(input.planner) ? input.planner : {},
    maturityLevel: clampText(input.maturityLevel, 24) || null,
  };
}

function resolveFixture(fixtureId: string) {
  return (fixturesPayload.fixtures ?? []).find((item) =>
    item.id === fixtureId
  ) ??
    null;
}

function buildDryRunResult(body: Record<string, unknown> | null) {
  const fixtureId = clampText(body?.fixture_id, 80);
  const fixture = fixtureId ? resolveFixture(fixtureId) : null;
  const input = isRecord(body?.input) ? body.input : fixture?.input ?? {};
  const expect = fixture?.expect ?? {};
  const delivery = isRecord(expect.delivery) ? expect.delivery : null;

  return {
    dry_run: true,
    policy_version: MAAT_GUIDANCE_POLICY_VERSION,
    fixture_policy_version: fixturesPayload.policy_version ?? null,
    fixture: fixture
      ? {
        id: fixture.id,
        description: fixture.description,
      }
      : null,
    input_preview: safeInputPreview(input),
    decision: {
      hard_gates: Array.isArray(expect.hardGates) ? expect.hardGates : [],
      band: typeof expect.band === "string" ? expect.band : null,
      not_band: typeof expect.notBand === "string" ? expect.notBand : null,
      reflection_move: typeof expect.reflectionMove === "string"
        ? expect.reflectionMove
        : null,
      would_create_delivery: !!delivery,
      delivery,
      source: fixture ? "fixture_expectation" : "manual_input_preview",
      note: fixture
        ? "Fixture dry-run mirrors the checked policy expectation and performs no database writes."
        : "Manual dry-run validates payload shape and performs no database writes.",
    },
    side_effects: {
      deliveries_written: 0,
      snapshots_written: 0,
      evaluations_written: 0,
      routing_changed: false,
    },
  };
}

export function createAdminMaatDryRunHandler(deps: HandlerDeps) {
  return async function adminMaatDryRunHandler(
    req: Request,
  ): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "method_not_allowed" }, {
        status: 405,
      });
    }

    const auth = await requireAdmin(req, deps, {
      scope: "product.maat.read",
      deniedAction: "maat.dry_run.denied",
      resourceType: "maat_dry_run",
    });
    if (auth.ok === false) return auth.response;

    const body = await readJsonBody(req) as Record<string, unknown> | null;
    const result = buildDryRunResult(body);

    await writeAudit(req, deps, {
      actorUserId: auth.context.user.id,
      actorRole: auth.context.staff.role,
      action: "maat.dry_run",
      resourceType: "maat_dry_run",
      riskLevel: "low",
      metadata: {
        fixture_id: result.fixture?.id ?? null,
        dry_run: true,
      },
    });

    return jsonResponse(req, result);
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client
      ? createAdminMaatDryRunHandler({ client })
      : serverNotConfiguredResponse,
  );
}
