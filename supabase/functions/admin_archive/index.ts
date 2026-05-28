// Edge Function: admin_archive
// Archive list, read, and manual create endpoints for the private admin console.

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
  toStringArray,
  writeAudit,
} from "../_shared/admin.ts";

type ArchiveEntry = {
  id: string;
  namespace: string;
  title: string;
  content_md: string;
  tags: string[];
  source_run_id?: string | null;
  source_type?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

const VALID_NAMESPACES = new Set([
  "research",
  "copy",
  "social",
  "suggestions",
  "codex",
  "chief_report",
  "brand",
  "technical",
  "source_notes",
  "ops",
]);

function listEntries(entries: ArchiveEntry[], req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const namespace = (url.searchParams.get("namespace") ?? "").trim();
  const id = (url.searchParams.get("id") ?? "").trim();

  if (id) {
    return entries.find((entry) => entry.id === id) ?? null;
  }

  return entries
    .filter((entry) => !namespace || entry.namespace === namespace)
    .filter((entry) => {
      if (!q) return true;
      return entry.title.toLowerCase().includes(q) ||
        entry.content_md.toLowerCase().includes(q) ||
        (entry.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 75);
}

export function createAdminArchiveHandler(deps: HandlerDeps) {
  return async function adminArchiveHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (req.method === "GET") {
      const auth = await requireAdmin(req, deps, {
        scope: "archive.read",
        deniedAction: "archive.denied",
        resourceType: "archive",
      });
      if (auth.ok === false) return auth.response;

      const { data, error } = await selectRows<ArchiveEntry>(
        deps.client,
        "haw_archive_entries",
        "id,namespace,title,content_md,tags,source_run_id,source_type,created_by,created_at,updated_at",
      );

      if (error) {
        return jsonResponse(req, {
          error: "archive_list_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      const result = listEntries(data ?? [], req);
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "archive.view",
        resourceType: "archive",
        resourceId: Array.isArray(result) ? null : result?.id ?? null,
        riskLevel: "low",
      });

      return jsonResponse(
        req,
        Array.isArray(result) ? { entries: result } : {
          entry: result,
        },
      );
    }

    if (req.method === "POST") {
      const auth = await requireAdmin(req, deps, {
        scope: "archive.write",
        deniedAction: "archive.denied",
        resourceType: "archive",
      });
      if (auth.ok === false) return auth.response;

      const body = await readJsonBody(req) as Record<string, unknown> | null;
      const namespace = clampText(body?.namespace, 60);
      const title = clampText(body?.title, 180);
      const contentMd = clampText(body?.content_md, 50000);
      const tags = toStringArray(body?.tags);
      const sourceType = clampText(body?.source_type, 80) || "manual";

      if (!VALID_NAMESPACES.has(namespace) || !title || !contentMd) {
        return jsonResponse(req, { error: "invalid_archive_entry" }, {
          status: 400,
        });
      }

      const { data, error } = await insertRow<ArchiveEntry>(
        deps.client,
        "haw_archive_entries",
        {
          namespace,
          title,
          content_md: contentMd,
          tags,
          source_type: sourceType,
          created_by: auth.context.user.id,
        },
      );

      if (error || !data) {
        return jsonResponse(req, {
          error: "archive_create_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "archive.entry_created",
        resourceType: "archive_entry",
        resourceId: data.id,
        riskLevel: "low",
        metadata: { namespace },
      });

      return jsonResponse(req, { entry: data }, { status: 201 });
    }

    return jsonResponse(req, { error: "method_not_allowed" }, { status: 405 });
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client
      ? createAdminArchiveHandler({ client })
      : serverNotConfiguredResponse,
  );
}
