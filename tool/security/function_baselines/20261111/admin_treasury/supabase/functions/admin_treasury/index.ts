// Edge Function: admin_treasury
// Lightweight cost, ledger, and budget summary endpoint.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  corsHeaders,
  createServiceClient,
  type HandlerDeps,
  jsonResponse,
  requireAdmin,
  selectRows,
  serializeError,
  serverNotConfiguredResponse,
  writeAudit,
} from "../_shared/admin.ts";

type LedgerRow = {
  id: string;
  run_id?: string | null;
  agent_slug?: string | null;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | string;
  duration_ms?: number | null;
  budget_period: string;
  created_at: string;
};

type BudgetRow = {
  id: string;
  scope: "global" | "agent_slug";
  agent_slug?: string | null;
  period: "daily" | "weekly" | "monthly";
  limit_usd: number | string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function cost(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeLedger(ledger: LedgerRow[]) {
  const totalCost = ledger.reduce((sum, row) => sum + cost(row.cost_usd), 0);
  const byAgent = new Map<
    string,
    { agent_slug: string; cost_usd: number; run_count: number }
  >();

  for (const row of ledger) {
    const slug = row.agent_slug ?? "unknown";
    const current = byAgent.get(slug) ?? {
      agent_slug: slug,
      cost_usd: 0,
      run_count: 0,
    };
    current.cost_usd += cost(row.cost_usd);
    current.run_count += 1;
    byAgent.set(slug, current);
  }

  return {
    totals: {
      cost_usd: Number(totalCost.toFixed(6)),
      run_count: ledger.length,
    },
    by_agent: Array.from(byAgent.values())
      .map((row) => ({ ...row, cost_usd: Number(row.cost_usd.toFixed(6)) }))
      .sort((a, b) => b.cost_usd - a.cost_usd),
    recent_ledger: ledger
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 25),
  };
}

export function createAdminTreasuryHandler(deps: HandlerDeps) {
  return async function adminTreasuryHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (req.method !== "GET") {
      return jsonResponse(req, { error: "method_not_allowed" }, {
        status: 405,
      });
    }

    const auth = await requireAdmin(req, deps, {
      scope: "treasury.read",
      deniedAction: "treasury.denied",
      resourceType: "treasury",
    });
    if (auth.ok === false) return auth.response;

    const [ledgerResult, budgetResult] = await Promise.all([
      selectRows<LedgerRow>(
        deps.client,
        "haw_treasury_ledger",
        "id,run_id,agent_slug,provider,model,tokens_in,tokens_out,cost_usd,duration_ms,budget_period,created_at",
      ),
      selectRows<BudgetRow>(
        deps.client,
        "haw_treasury_budgets",
        "id,scope,agent_slug,period,limit_usd,is_active,created_at,updated_at",
      ),
    ]);

    if (ledgerResult.error || budgetResult.error) {
      return jsonResponse(req, {
        error: "treasury_summary_failed",
        detail: serializeError(ledgerResult.error ?? budgetResult.error),
      }, { status: 500 });
    }

    await writeAudit(req, deps, {
      actorUserId: auth.context.user.id,
      actorRole: auth.context.staff.role,
      action: "treasury.view",
      resourceType: "treasury",
      riskLevel: "low",
    });

    return jsonResponse(req, {
      ...summarizeLedger(ledgerResult.data ?? []),
      budgets: (budgetResult.data ?? []).filter((budget) => budget.is_active),
    });
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client
      ? createAdminTreasuryHandler({ client })
      : serverNotConfiguredResponse,
  );
}
