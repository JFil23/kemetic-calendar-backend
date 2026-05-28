// Edge Function: admin_approvals
// Approval inbox list, manual request, and decision endpoints.

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

type ApprovalRequest = {
  id: string;
  kind: string;
  status: string;
  risk_level: "low" | "medium" | "high" | "restricted";
  payload: Record<string, unknown>;
  summary: string;
  requested_by?: string | null;
  requested_from_run_id?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_notes?: string | null;
  created_at: string;
  updated_at: string;
};

const VALID_STATUSES = new Set([
  "pending",
  "approved",
  "rejected",
  "needs_changes",
  "cancelled",
]);
const VALID_RISKS = new Set(["low", "medium", "high", "restricted"]);

function listApprovals(approvals: ApprovalRequest[], req: Request) {
  const status = (new URL(req.url).searchParams.get("status") ?? "").trim();
  return approvals
    .filter((approval) => !status || approval.status === status)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 100);
}

export function createAdminApprovalsHandler(deps: HandlerDeps) {
  return async function adminApprovalsHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (req.method === "GET") {
      const auth = await requireAdmin(req, deps, {
        scope: "approvals.read",
        deniedAction: "approval.denied",
        resourceType: "approval",
      });
      if (auth.ok === false) return auth.response;

      const { data, error } = await selectRows<ApprovalRequest>(
        deps.client,
        "haw_approval_requests",
        "id,kind,status,risk_level,payload,summary,requested_by,requested_from_run_id,decided_by,decided_at,decision_notes,created_at,updated_at",
      );

      if (error) {
        return jsonResponse(req, {
          error: "approvals_list_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "approval.view",
        resourceType: "approval",
        riskLevel: "low",
      });

      return jsonResponse(req, { approvals: listApprovals(data ?? [], req) });
    }

    if (req.method === "POST") {
      const auth = await requireAdmin(req, deps, {
        scope: "approvals.decide",
        deniedAction: "approval.denied",
        resourceType: "approval",
      });
      if (auth.ok === false) return auth.response;

      const body = await readJsonBody(req) as Record<string, unknown> | null;
      const kind = clampText(body?.kind, 80);
      const summary = clampText(body?.summary, 500);
      const riskLevel = clampText(body?.risk_level, 20) || "low";
      const payload = typeof body?.payload === "object" && body.payload
        ? body.payload as Record<string, unknown>
        : {};

      if (!kind || !summary || !VALID_RISKS.has(riskLevel)) {
        return jsonResponse(req, { error: "invalid_approval_request" }, {
          status: 400,
        });
      }

      const { data, error } = await insertRow<ApprovalRequest>(
        deps.client,
        "haw_approval_requests",
        {
          kind,
          summary,
          risk_level: riskLevel,
          payload,
          requested_by: auth.context.user.id,
        },
      );

      if (error || !data) {
        return jsonResponse(req, {
          error: "approval_create_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "approval.requested",
        resourceType: "approval",
        resourceId: data.id,
        riskLevel: riskLevel as ApprovalRequest["risk_level"],
        metadata: { kind },
      });

      return jsonResponse(req, { approval: data }, { status: 201 });
    }

    if (req.method === "PATCH") {
      const auth = await requireAdmin(req, deps, {
        scope: "approvals.decide",
        deniedAction: "approval.denied",
        resourceType: "approval",
      });
      if (auth.ok === false) return auth.response;

      const body = await readJsonBody(req) as Record<string, unknown> | null;
      const id = clampText(body?.id, 80);
      const status = clampText(body?.status, 32);
      const decisionNotes = clampText(body?.decision_notes, 1000);

      if (!id || !VALID_STATUSES.has(status) || status === "pending") {
        return jsonResponse(req, { error: "invalid_approval_decision" }, {
          status: 400,
        });
      }

      const { data, error } = await updateRow<ApprovalRequest>(
        deps.client,
        "haw_approval_requests",
        id,
        {
          status,
          decision_notes: decisionNotes || null,
          decided_by: auth.context.user.id,
          decided_at: new Date().toISOString(),
        },
      );

      if (error || !data) {
        return jsonResponse(req, {
          error: "approval_decision_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "approval.decided",
        resourceType: "approval",
        resourceId: id,
        riskLevel: data.risk_level,
        metadata: { status },
      });

      return jsonResponse(req, { approval: data });
    }

    return jsonResponse(req, { error: "method_not_allowed" }, { status: 405 });
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client
      ? createAdminApprovalsHandler({ client })
      : serverNotConfiguredResponse,
  );
}
