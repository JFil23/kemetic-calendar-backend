// Edge Function: admin_nodes
// ADR-002 interim Node CMS: drafts, versions, preview data, and approval gates only.

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

type NodeDraft = {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  metadata: Record<string, unknown>;
  status: string;
  linked_node_slug?: string | null;
  approval_request_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

type NodeDraftVersion = {
  id: string;
  draft_id: string;
  version_number: number;
  title: string;
  body_md: string;
  metadata: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
};

type PublishedNode = {
  id: string;
  slug: string;
  title: string;
  glyph?: string | null;
  body_text: string;
  is_active?: boolean | null;
  updated_at?: string | null;
};

type ApprovalRequest = {
  id: string;
  kind: string;
  status: string;
  risk_level: "low" | "medium" | "high" | "restricted";
  payload: Record<string, unknown>;
  summary: string;
};

const VALID_DRAFT_STATUSES = new Set([
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSlug(value: unknown) {
  return clampText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sortByCreatedDesc<T extends { created_at?: string | null }>(
  rows: T[],
) {
  return [...rows].sort((a, b) =>
    Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "")
  );
}

function enrichDrafts(
  drafts: NodeDraft[],
  versions: NodeDraftVersion[],
  publishedNodes: PublishedNode[],
) {
  const publishedBySlug = new Map(
    publishedNodes.map((node) => [node.slug, node]),
  );

  return sortByCreatedDesc(drafts).map((draft) => {
    const draftVersions = versions
      .filter((version) => version.draft_id === draft.id)
      .sort((a, b) => b.version_number - a.version_number);
    const published =
      publishedBySlug.get(draft.linked_node_slug ?? draft.slug) ??
        publishedBySlug.get(draft.slug) ??
        null;
    const latestVersion = draftVersions[0] ?? null;

    return {
      ...draft,
      latest_version: latestVersion,
      version_count: draftVersions.length,
      versions: draftVersions,
      published_node: published
        ? {
          id: published.id,
          slug: published.slug,
          title: published.title,
          glyph: published.glyph ?? null,
          body_text: published.body_text,
          is_active: published.is_active ?? null,
          updated_at: published.updated_at ?? null,
        }
        : null,
      app_visibility:
        "Draft only. ADR-002 Option C means this does not change the app until a manual/Codex publish path is chosen.",
    };
  });
}

async function loadNodePayload(deps: HandlerDeps) {
  const [draftsResult, versionsResult, publishedResult] = await Promise.all([
    selectRows<NodeDraft>(
      deps.client,
      "node_drafts",
      "id,slug,title,body_md,metadata,status,linked_node_slug,approval_request_id,created_by,created_at,updated_at",
    ),
    selectRows<NodeDraftVersion>(
      deps.client,
      "node_draft_versions",
      "id,draft_id,version_number,title,body_md,metadata,created_by,created_at",
    ),
    selectRows<PublishedNode>(
      deps.client,
      "nodes",
      "id,slug,title,glyph,body_text,is_active,updated_at",
    ),
  ]);

  return { draftsResult, versionsResult, publishedResult };
}

export function createAdminNodesHandler(deps: HandlerDeps) {
  return async function adminNodesHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (req.method === "GET") {
      const auth = await requireAdmin(req, deps, {
        scope: "product.nodes.read",
        deniedAction: "nodes.denied",
        resourceType: "node_draft",
      });
      if (auth.ok === false) return auth.response;

      const { draftsResult, versionsResult, publishedResult } =
        await loadNodePayload(deps);
      const error = draftsResult.error ?? versionsResult.error ??
        publishedResult.error;
      if (error) {
        return jsonResponse(req, {
          error: "node_drafts_list_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      const drafts = enrichDrafts(
        draftsResult.data ?? [],
        versionsResult.data ?? [],
        publishedResult.data ?? [],
      );

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "node_drafts.view",
        resourceType: "node_draft",
        riskLevel: "low",
      });

      return jsonResponse(req, {
        drafts,
        published_nodes: [...(publishedResult.data ?? [])]
          .sort((a, b) => a.slug.localeCompare(b.slug))
          .slice(0, 250),
        source_of_truth:
          "ADR-002 Option C: Dart remains app-visible; admin drafts are not live content.",
      });
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "method_not_allowed" }, {
        status: 405,
      });
    }

    const body = await readJsonBody(req) as Record<string, unknown> | null;
    const action = clampText(body?.action, 40) || "create";

    if (action === "approve") {
      const auth = await requireAdmin(req, deps, {
        scope: "approvals.decide",
        deniedAction: "node_draft.denied",
        resourceType: "node_draft",
      });
      if (auth.ok === false) return auth.response;

      const id = clampText(body?.id, 80);
      if (!id) {
        return jsonResponse(req, { error: "node_draft_id_required" }, {
          status: 400,
        });
      }

      const { data, error } = await updateRow<NodeDraft>(
        deps.client,
        "node_drafts",
        id,
        { status: "approved" },
      );

      if (error || !data) {
        return jsonResponse(req, {
          error: "node_draft_approve_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "node_draft.approved",
        resourceType: "node_draft",
        resourceId: id,
        riskLevel: "medium",
        metadata: { app_visible: false },
      });

      return jsonResponse(req, { draft: data });
    }

    const auth = await requireAdmin(req, deps, {
      scope: "product.nodes.write",
      deniedAction: "node_draft.denied",
      resourceType: "node_draft",
    });
    if (auth.ok === false) return auth.response;

    if (action === "create") {
      const slug = normalizeSlug(body?.slug);
      const title = clampText(body?.title, 180);
      const bodyMd = clampText(body?.body_md, 80000);
      const metadata = isRecord(body?.metadata) ? body.metadata : {};
      const linkedNodeSlug = normalizeSlug(body?.linked_node_slug) || slug;

      if (!slug || !title || !bodyMd) {
        return jsonResponse(req, { error: "invalid_node_draft" }, {
          status: 400,
        });
      }

      const { data: draft, error: draftError } = await insertRow<NodeDraft>(
        deps.client,
        "node_drafts",
        {
          slug,
          title,
          body_md: bodyMd,
          metadata,
          status: "draft",
          linked_node_slug: linkedNodeSlug,
          created_by: auth.context.user.id,
        },
      );

      if (draftError || !draft) {
        return jsonResponse(req, {
          error: "node_draft_create_failed",
          detail: serializeError(draftError),
        }, { status: 500 });
      }

      await insertRow<NodeDraftVersion>(
        deps.client,
        "node_draft_versions",
        {
          draft_id: draft.id,
          version_number: 1,
          title,
          body_md: bodyMd,
          metadata,
          created_by: auth.context.user.id,
        },
      );

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "node_draft.created",
        resourceType: "node_draft",
        resourceId: draft.id,
        riskLevel: "medium",
        metadata: { slug, app_visible: false },
      });

      return jsonResponse(req, { draft }, { status: 201 });
    }

    if (action === "version") {
      const id = clampText(body?.id, 80);
      const title = clampText(body?.title, 180);
      const bodyMd = clampText(body?.body_md, 80000);
      const metadata = isRecord(body?.metadata) ? body.metadata : {};
      const status = clampText(body?.status, 32) || "draft";

      if (!id || !title || !bodyMd || !VALID_DRAFT_STATUSES.has(status)) {
        return jsonResponse(req, { error: "invalid_node_draft_version" }, {
          status: 400,
        });
      }

      const { data: versions, error: versionListError } = await selectRows<
        NodeDraftVersion
      >(
        deps.client,
        "node_draft_versions",
        "id,draft_id,version_number,title,body_md,metadata,created_by,created_at",
      );
      if (versionListError) {
        return jsonResponse(req, {
          error: "node_draft_versions_failed",
          detail: serializeError(versionListError),
        }, { status: 500 });
      }

      const nextVersion = Math.max(
        0,
        ...(versions ?? [])
          .filter((version) => version.draft_id === id)
          .map((version) => Number(version.version_number) || 0),
      ) + 1;

      const { data: draft, error: updateError } = await updateRow<NodeDraft>(
        deps.client,
        "node_drafts",
        id,
        {
          title,
          body_md: bodyMd,
          metadata,
          status,
        },
      );

      if (updateError || !draft) {
        return jsonResponse(req, {
          error: "node_draft_update_failed",
          detail: serializeError(updateError),
        }, { status: 500 });
      }

      const { data: version, error: versionError } = await insertRow<
        NodeDraftVersion
      >(
        deps.client,
        "node_draft_versions",
        {
          draft_id: id,
          version_number: nextVersion,
          title,
          body_md: bodyMd,
          metadata,
          created_by: auth.context.user.id,
        },
      );

      if (versionError || !version) {
        return jsonResponse(req, {
          error: "node_draft_version_create_failed",
          detail: serializeError(versionError),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "node_draft.version_created",
        resourceType: "node_draft",
        resourceId: id,
        riskLevel: "medium",
        metadata: { version_number: nextVersion, app_visible: false },
      });

      return jsonResponse(req, { draft, version });
    }

    if (action === "request_approval") {
      const id = clampText(body?.id, 80);
      if (!id) {
        return jsonResponse(req, { error: "node_draft_id_required" }, {
          status: 400,
        });
      }

      const { draftsResult } = await loadNodePayload(deps);
      const draft = (draftsResult.data ?? []).find((item) => item.id === id) ??
        null;
      if (draftsResult.error || !draft) {
        return jsonResponse(req, {
          error: "node_draft_not_found",
          detail: serializeError(draftsResult.error),
        }, { status: 404 });
      }

      const { data: approval, error: approvalError } = await insertRow<
        ApprovalRequest
      >(
        deps.client,
        "haw_approval_requests",
        {
          kind: "node_draft_later",
          status: "pending",
          risk_level: "medium",
          summary: `Node draft review: ${draft.title}`,
          payload: {
            node_draft_id: draft.id,
            slug: draft.slug,
            title: draft.title,
            manual_codex_publish_required: true,
            app_visible_after_approval: false,
            adr: "ADR-002 Option C",
          },
          requested_by: auth.context.user.id,
        },
      );

      if (approvalError || !approval) {
        return jsonResponse(req, {
          error: "node_draft_approval_failed",
          detail: serializeError(approvalError),
        }, { status: 500 });
      }

      const { data: updatedDraft, error: updateError } = await updateRow<
        NodeDraft
      >(
        deps.client,
        "node_drafts",
        draft.id,
        {
          status: "pending_approval",
          approval_request_id: approval.id,
        },
      );

      if (updateError || !updatedDraft) {
        return jsonResponse(req, {
          error: "node_draft_approval_status_failed",
          detail: serializeError(updateError),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "node_draft.approval_requested",
        resourceType: "node_draft",
        resourceId: draft.id,
        riskLevel: "medium",
        metadata: { approval_request_id: approval.id, app_visible: false },
      });

      return jsonResponse(req, { draft: updatedDraft, approval });
    }

    return jsonResponse(req, { error: "unknown_node_action" }, {
      status: 400,
    });
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client ? createAdminNodesHandler({ client }) : serverNotConfiguredResponse,
  );
}
