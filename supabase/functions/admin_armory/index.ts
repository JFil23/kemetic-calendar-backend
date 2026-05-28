// Edge Function: admin_armory
// Read-only Armory playbook endpoint for the private admin console.

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

type Playbook = {
  id: string;
  slug: string;
  agent_slug?: string | null;
  version: number;
  name: string;
  system_prompt_md: string;
  tools_allowed: unknown;
  output_schema: unknown;
  requires_approval: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function listPlaybooks(playbooks: Playbook[], req: Request) {
  const url = new URL(req.url);
  const agentSlug = (url.searchParams.get("agent_slug") ?? "").trim();
  const id = (url.searchParams.get("id") ?? "").trim();

  if (id) {
    return playbooks.find((playbook) => playbook.id === id) ?? null;
  }

  return playbooks
    .filter((playbook) => playbook.is_active)
    .filter((playbook) => !agentSlug || playbook.agent_slug === agentSlug)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function createAdminArmoryHandler(deps: HandlerDeps) {
  return async function adminArmoryHandler(req: Request): Promise<Response> {
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
      scope: "armory.read",
      deniedAction: "armory.denied",
      resourceType: "armory",
    });
    if (auth.ok === false) return auth.response;

    const { data, error } = await selectRows<Playbook>(
      deps.client,
      "haw_armory_playbooks",
      "id,slug,agent_slug,version,name,system_prompt_md,tools_allowed,output_schema,requires_approval,is_active,created_at,updated_at",
    );

    if (error) {
      return jsonResponse(req, {
        error: "armory_list_failed",
        detail: serializeError(error),
      }, { status: 500 });
    }

    const result = listPlaybooks(data ?? [], req);
    await writeAudit(req, deps, {
      actorUserId: auth.context.user.id,
      actorRole: auth.context.staff.role,
      action: "armory.view",
      resourceType: "armory",
      resourceId: Array.isArray(result) ? null : result?.id ?? null,
      riskLevel: "low",
    });

    return jsonResponse(
      req,
      Array.isArray(result) ? { playbooks: result } : {
        playbook: result,
      },
    );
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client ? createAdminArmoryHandler({ client }) : serverNotConfiguredResponse,
  );
}
