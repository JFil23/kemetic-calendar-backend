// Edge Function: admin_maat_ops
// Read-only Ma'at operations surfaces plus approval-gated routing override drafts.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  clampText,
  corsHeaders,
  createServiceClient,
  type HandlerDeps,
  insertRow,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  selectRows,
  serializeError,
  serverNotConfiguredResponse,
  updateRow,
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

type MaatDelivery = {
  id: string;
  user_id: string;
  kind: string;
  decan_period_key: string;
  status: string;
  priority?: number | null;
  teaser_text?: string | null;
  cta_type?: string | null;
  cta_ref?: string | null;
  trigger_reason?: string | null;
  shown_at?: string | null;
  dismissed_at?: string | null;
  opened_at?: string | null;
  acted_at?: string | null;
  expired_at?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type MaatEvaluation = {
  id: string;
  user_id: string;
  snapshot_id?: string | null;
  decan_period_key: string;
  window_date: string;
  policy_version: string;
  maturity_level?: string | null;
  shaping_fingerprint?: Record<string, unknown> | null;
  decision?: Record<string, unknown> | null;
  suppressed?: string[] | null;
  created_delivery_ids?: string[] | null;
  created_at: string;
};

type MaatOverride = {
  id: string;
  scope: string;
  status: string;
  cta_type?: string | null;
  cta_ref?: string | null;
  cohort_type?: string | null;
  cohort_key?: string | null;
  target_user_id?: string | null;
  override: Record<string, unknown>;
  reason: string;
  approval_request_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalRequest = {
  id: string;
  kind: string;
  status: string;
  risk_level: "low" | "medium" | "high" | "restricted";
  payload: Record<string, unknown>;
  summary: string;
};

const fixturesPayload = maatFixturesJson as {
  policy_version?: string;
  fixtures?: MaatFixture[];
};

const VALID_OVERRIDE_SCOPES = new Set([
  "global",
  "cta",
  "cohort",
  "user",
  "policy",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeDelivery(row: MaatDelivery) {
  return {
    id: row.id,
    user_id: row.user_id,
    kind: row.kind,
    decan_period_key: row.decan_period_key,
    status: row.status,
    priority: row.priority ?? null,
    teaser_preview: clampText(row.teaser_text, 180) || null,
    cta_type: row.cta_type ?? null,
    cta_ref: row.cta_ref ?? null,
    trigger_reason: row.trigger_reason ?? null,
    shown_at: row.shown_at ?? null,
    dismissed_at: row.dismissed_at ?? null,
    opened_at: row.opened_at ?? null,
    acted_at: row.acted_at ?? null,
    expired_at: row.expired_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? null,
  };
}

function safeEvaluation(row: MaatEvaluation) {
  const decision = isRecord(row.decision) ? row.decision : {};
  const drift = isRecord(decision.drift) ? decision.drift : null;
  const strength = isRecord(decision.strength) ? decision.strength : null;
  const memory = isRecord(decision.memory_brief) ? decision.memory_brief : null;
  return {
    id: row.id,
    user_id: row.user_id,
    snapshot_id: row.snapshot_id ?? null,
    decan_period_key: row.decan_period_key,
    window_date: row.window_date,
    policy_version: row.policy_version,
    maturity_level: row.maturity_level ?? null,
    suppressed: row.suppressed ?? [],
    created_delivery_ids: row.created_delivery_ids ?? [],
    drift,
    strength,
    memory_brief: memory,
    created_at: row.created_at,
  };
}

function sortByCreatedDesc<T extends { created_at?: string | null }>(
  rows: T[],
) {
  return [...rows].sort((a, b) =>
    Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "")
  );
}

function listOverrides(overrides: MaatOverride[], req: Request) {
  const status = (new URL(req.url).searchParams.get("status") ?? "").trim();
  return sortByCreatedDesc(overrides)
    .filter((row) => !status || row.status === status)
    .slice(0, 100);
}

export function createAdminMaatOpsHandler(deps: HandlerDeps) {
  return async function adminMaatOpsHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "fixtures";

    if (req.method === "GET" && action === "fixtures") {
      const auth = await requireAdmin(req, deps, {
        scope: "product.maat.read",
        deniedAction: "maat.denied",
        resourceType: "maat",
      });
      if (auth.ok === false) return auth.response;

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "maat.fixtures.view",
        resourceType: "maat_fixture",
        riskLevel: "low",
      });

      return jsonResponse(req, {
        policy_version: MAAT_GUIDANCE_POLICY_VERSION,
        fixture_policy_version: fixturesPayload.policy_version ?? null,
        fixtures: fixturesPayload.fixtures ?? [],
      });
    }

    if (req.method === "GET" && action === "deliveries") {
      const userId = clampText(url.searchParams.get("user_id"), 80);
      const auth = await requireAdmin(req, deps, {
        scope: "product.users.support",
        deniedAction: "maat.delivery_lookup.denied",
        resourceType: "maat_delivery",
        resourceId: userId || null,
        metadata: { lookup_user_id: userId || null },
      });
      if (auth.ok === false) return auth.response;

      if (!userId) {
        return jsonResponse(req, { error: "user_id_required" }, {
          status: 400,
        });
      }

      const { data, error } = await selectRows<MaatDelivery>(
        deps.client,
        "maat_guidance_deliveries",
        "id,user_id,kind,decan_period_key,status,priority,teaser_text,cta_type,cta_ref,trigger_reason,shown_at,dismissed_at,opened_at,acted_at,expired_at,created_at,updated_at",
      );

      if (error) {
        return jsonResponse(req, {
          error: "maat_delivery_lookup_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      const deliveries = sortByCreatedDesc(data ?? [])
        .filter((row) => row.user_id === userId)
        .slice(0, 25)
        .map(safeDelivery);

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "maat.delivery_lookup",
        resourceType: "maat_delivery",
        resourceId: userId,
        riskLevel: "medium",
        metadata: { result_count: deliveries.length },
      });

      return jsonResponse(req, { deliveries });
    }

    if (req.method === "GET" && action === "evaluations") {
      const userId = clampText(url.searchParams.get("user_id"), 80);
      const auth = await requireAdmin(req, deps, {
        scope: "product.users.support",
        deniedAction: "maat.evaluation_lookup.denied",
        resourceType: "maat_evaluation",
        resourceId: userId || null,
        metadata: { lookup_user_id: userId || null },
      });
      if (auth.ok === false) return auth.response;

      if (!userId) {
        return jsonResponse(req, { error: "user_id_required" }, {
          status: 400,
        });
      }

      const { data, error } = await selectRows<MaatEvaluation>(
        deps.client,
        "maat_guidance_evaluations",
        "id,user_id,snapshot_id,decan_period_key,window_date,policy_version,maturity_level,shaping_fingerprint,decision,suppressed,created_delivery_ids,created_at",
      );

      if (error) {
        return jsonResponse(req, {
          error: "maat_evaluation_lookup_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      const evaluations = sortByCreatedDesc(data ?? [])
        .filter((row) => row.user_id === userId)
        .slice(0, 25)
        .map(safeEvaluation);

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "maat.evaluation_lookup",
        resourceType: "maat_evaluation",
        resourceId: userId,
        riskLevel: "medium",
        metadata: { result_count: evaluations.length },
      });

      return jsonResponse(req, { evaluations });
    }

    if (req.method === "GET" && action === "overrides") {
      const auth = await requireAdmin(req, deps, {
        scope: "product.maat.read",
        deniedAction: "maat.override.denied",
        resourceType: "maat_override",
      });
      if (auth.ok === false) return auth.response;

      const { data, error } = await selectRows<MaatOverride>(
        deps.client,
        "maat_routing_overrides",
        "id,scope,status,cta_type,cta_ref,cohort_type,cohort_key,target_user_id,override,reason,approval_request_id,created_by,created_at,updated_at",
      );

      if (error) {
        return jsonResponse(req, {
          error: "maat_overrides_list_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "maat.overrides.view",
        resourceType: "maat_override",
        riskLevel: "low",
      });

      return jsonResponse(req, { overrides: listOverrides(data ?? [], req) });
    }

    if (req.method === "POST") {
      const auth = await requireAdmin(req, deps, {
        scope: "product.maat.write",
        deniedAction: "maat.override.denied",
        resourceType: "maat_override",
      });
      if (auth.ok === false) return auth.response;

      const body = await readJsonBody(req) as Record<string, unknown> | null;
      const scope = clampText(body?.scope, 32) || "global";
      const reason = clampText(body?.reason, 2000);
      const override = isRecord(body?.override) ? body.override : {};
      const ctaType = clampText(body?.cta_type, 60) || null;
      const ctaRef = clampText(body?.cta_ref, 120) || null;
      const cohortType = clampText(body?.cohort_type, 80) || null;
      const cohortKey = clampText(body?.cohort_key, 160) || null;
      const targetUserId = clampText(body?.target_user_id, 80) || null;

      if (!VALID_OVERRIDE_SCOPES.has(scope) || !reason) {
        return jsonResponse(req, { error: "invalid_maat_override" }, {
          status: 400,
        });
      }

      const { data: draft, error: draftError } = await insertRow<MaatOverride>(
        deps.client,
        "maat_routing_overrides",
        {
          scope,
          status: "draft",
          cta_type: ctaType,
          cta_ref: ctaRef,
          cohort_type: cohortType,
          cohort_key: cohortKey,
          target_user_id: targetUserId,
          override,
          reason,
          created_by: auth.context.user.id,
        },
      );

      if (draftError || !draft) {
        return jsonResponse(req, {
          error: "maat_override_create_failed",
          detail: serializeError(draftError),
        }, { status: 500 });
      }

      const { data: approval, error: approvalError } = await insertRow<
        ApprovalRequest
      >(
        deps.client,
        "haw_approval_requests",
        {
          kind: "maat_policy_change",
          status: "pending",
          risk_level: "high",
          summary: `Ma'at routing override: ${reason.slice(0, 180)}`,
          payload: {
            override_id: draft.id,
            scope,
            cta_type: ctaType,
            cta_ref: ctaRef,
            cohort_type: cohortType,
            cohort_key: cohortKey,
            target_user_id: targetUserId,
            override,
            manual_publish_required: true,
          },
          requested_by: auth.context.user.id,
        },
      );

      if (approvalError || !approval) {
        return jsonResponse(req, {
          error: "maat_override_approval_failed",
          detail: serializeError(approvalError),
        }, { status: 500 });
      }

      const { data: overrideDraft, error: updateError } = await updateRow<
        MaatOverride
      >(
        deps.client,
        "maat_routing_overrides",
        draft.id,
        {
          status: "pending_approval",
          approval_request_id: approval.id,
        },
      );

      if (updateError || !overrideDraft) {
        return jsonResponse(req, {
          error: "maat_override_status_failed",
          detail: serializeError(updateError),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "maat.override_draft_created",
        resourceType: "maat_override",
        resourceId: overrideDraft.id,
        riskLevel: "high",
        metadata: { approval_request_id: approval.id, scope },
      });

      return jsonResponse(
        req,
        { override: overrideDraft, approval },
        { status: 201 },
      );
    }

    return jsonResponse(req, { error: "method_not_allowed" }, { status: 405 });
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client
      ? createAdminMaatOpsHandler({ client })
      : serverNotConfiguredResponse,
  );
}
