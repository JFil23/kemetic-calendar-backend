// deno-lint-ignore-file no-import-prefix

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type LinkRow = {
  target_type: string;
  target_id: string;
  created_at: string;
};

type EventRow = {
  event_type: string;
  node_id: string | null;
  created_at: string;
};

type ContentRow = {
  node_id: string;
  updated_at: string;
  plain_text: string | null;
};

type BadgeRow = {
  title: string | null;
  details: string | null;
  tags: string[] | null;
  occurred_on: string;
  event_id: string | null;
};

type CompletionRow = {
  completed_at: string;
  completed_on: string | null;
  metadata: Record<string, unknown> | null;
};

type NodeRow = {
  id: string;
  slug: string;
  title: string | null;
  aliases: string[] | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const EVENT_WEIGHTS: Record<string, number> = {
  node_opened: 1,
  node_link_tapped: 1,
  node_insight_saved: 4,
  journal_linked_to_node: 2,
  reflection_linked_to_node: 2,
  node_linked_to_journal: 2,
  node_linked_to_reflection: 2,
  flow_completed: 3,
  reflection_saved: 1,
  reflection_opened: 0.5,
  reflection_rated: 1,
  flow_skipped: -1,
  flow_pending: 0.4,
};

const PLANNER_BADGE_WEIGHTS: Record<string, Record<string, number>> = {
  "todo:done": {
    ptah: 2.2,
    maat: 1.8,
    djehuty: 0.9,
  },
  "todo:partial": {
    ptah: 1.1,
    maat: 0.8,
    djehuty: 0.4,
  },
  "todo:skipped": {
    isfet: 2.0,
  },
  "todo:pending": {
    ptah: 0.9,
    djehuty: 0.5,
    isfet: 0.6,
  },
  "nutrition:done": {
    renenutet: 2.4,
    ka: 1.8,
    maat: 0.8,
  },
  "nutrition:partial": {
    renenutet: 1.2,
    ka: 0.9,
    maat: 0.4,
  },
  "nutrition:skipped": {
    isfet: 1.6,
  },
  "nutrition:pending": {
    renenutet: 1.0,
    ka: 0.7,
    isfet: 0.6,
  },
};

export const MAAT_FLOW_COMPLETION_SOURCE_TABLE = "user_event_completions";

export const MAAT_FLOW_NODE_WEIGHTS: Record<string, Record<string, number>> = {
  "dawn-house-rite": {
    maat: 1.0,
    ra: 0.7,
  },
  "evening-threshold-rite": {
    maat: 1.0,
    ra: 0.5,
    ausar: 0.4,
  },
  "track-the-sky": {
    maat: 1.0,
    nut: 0.8,
    ra: 0.55,
  },
  "the-weighing": {
    maat: 1.0,
    djehuty: 0.9,
  },
  "the-offering-table": {
    maat: 1.0,
    nile: 0.85,
    ka: 0.55,
    renenutet: 0.45,
  },
  "the-tending": {
    maat: 1.0,
    heru: 0.75,
    aset: 0.75,
  },
  "the-kept-word": {
    maat: 1.0,
    ptah: 0.7,
    djehuty: 0.6,
  },
  "the-course": {
    maat: 1.0,
    ra: 0.7,
    khepri: 0.65,
    decans: 0.55,
  },
  "the-moon-return": {
    maat: 1.0,
    heru: 0.75,
    djehuty: 0.55,
  },
  "the-wag": {
    maat: 1.0,
    ausar: 0.8,
    anpu: 0.55,
    ren: 0.65,
  },
  "the-decan-watch": {
    maat: 1.0,
    nut: 0.8,
    ra: 0.55,
    decans: 0.7,
  },
  "the-days-outside-the-year": {
    maat: 1.0,
    epagomenal_days: 0.8,
    ausar: 0.55,
    heru: 0.45,
    set: 0.45,
    aset: 0.55,
    nebet_het: 0.55,
  },
  "the-open-hand": {
    maat: 1.0,
    hapy: 0.75,
    nile: 0.65,
  },
  "the-djed": {
    maat: 1.0,
    djed: 0.8,
    ausar: 0.65,
    ptah: 0.55,
  },
};

export const MAAT_FLOW_COMPLETION_STATUS_WEIGHTS: Record<string, number> = {
  observed: 2.4,
  observed_partly: 1.2,
  observed_from_inside: 1.5,
  names_spoken: 1.7,
  raised: 2.4,
  conversation_pending: 0.45,
};

export const MAAT_FLOW_SKIPPED_COMPLETION_NODE_WEIGHTS = {
  maat: 0.35,
  isfet: 0.9,
};

function getClient(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
}

function recencyWeight(dateStr: string, now = new Date()) {
  const d = new Date(dateStr);
  const days = Math.max(
    0,
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 14) return 1.0;
  if (days <= 60) return 0.5;
  return 0.2;
}

function addScore(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function tensionPairs(topNodeSlugs: string[]) {
  const pairs: string[][] = [];
  const has = (slug: string) => topNodeSlugs.includes(slug);
  if (has("maat") && has("isfet")) pairs.push(["maat", "isfet"]);
  if (has("ptah") && has("isfet")) pairs.push(["ptah", "isfet"]);
  if (has("ra") && has("serpent")) pairs.push(["ra", "serpent"]);
  if (has("ausar") && has("isfet")) pairs.push(["ausar", "isfet"]);
  return pairs;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function normalizeTags(tags: string[] | null | undefined) {
  return new Set(
    (tags ?? []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(item).toLowerCase())
    .filter(Boolean);
}

function normalizeCompletionStatus(value: unknown) {
  const raw = stringValue(value).toLowerCase().replace(/\s+/g, "_");
  if (raw === "observed") return "observed";
  if (raw === "observed_partly" || raw === "partly_observed") {
    return "observed_partly";
  }
  if (raw === "observed_from_inside" || raw === "observed_inside") {
    return "observed_from_inside";
  }
  if (raw === "partly") return "observed_partly";
  if (raw === "skipped") return "skipped";
  if (raw === "names_spoken") return "names_spoken";
  if (raw === "raised") return "raised";
  if (raw === "conversation_pending") return "conversation_pending";
  return null;
}

function plannerBadgeKind(tags: Set<string>, eventId: string | null) {
  if (tags.has("kind:todo") || (eventId ?? "").startsWith("planner-todo:")) {
    return "todo";
  }
  if (
    tags.has("kind:nutrition") ||
    (eventId ?? "").startsWith("planner-nutrition:")
  ) {
    return "nutrition";
  }
  return null;
}

function plannerBadgeState(tags: Set<string>) {
  if (tags.has("state:done")) return "done";
  if (tags.has("state:partial") || tags.has("state:in_progress")) {
    return "partial";
  }
  if (tags.has("state:skipped")) return "skipped";
  if (tags.has("state:pending")) return "pending";
  return null;
}

function scoreMaatFlowCompletion(
  completion: CompletionRow,
  nodeScores: Map<string, number>,
  completionDayNodes: Map<string, Set<string>>,
) {
  const metadata = isRecord(completion.metadata) ? completion.metadata : {};
  const flowKey = stringValue(metadata.flow_key).toLowerCase();
  const graph = isRecord(metadata.knowledge_graph)
    ? metadata.knowledge_graph
    : {};
  const graphVersion = stringValue(graph.version);
  const isMaatCompletion = graphVersion === "maat_flow_completion_v1" ||
    flowKey in MAAT_FLOW_NODE_WEIGHTS;
  if (!isMaatCompletion) return;

  const status = normalizeCompletionStatus(metadata.status);
  if (!status) return;

  const recency = recencyWeight(completion.completed_at);
  const day = (completion.completed_on || completion.completed_at).substring(
    0,
    10,
  );
  if (!completionDayNodes.has(day)) completionDayNodes.set(day, new Set());
  const daySet = completionDayNodes.get(day)!;

  if (status === "skipped") {
    Object.entries(MAAT_FLOW_SKIPPED_COMPLETION_NODE_WEIGHTS).forEach(
      ([slug, weight]) => {
        addScore(nodeScores, slug, weight * recency);
        daySet.add(slug);
      },
    );
    return;
  }

  const baseWeight = MAAT_FLOW_COMPLETION_STATUS_WEIGHTS[status] ?? 0;
  if (baseWeight <= 0) return;

  const weightedNodes: Record<string, number> = {
    ...(MAAT_FLOW_NODE_WEIGHTS[flowKey] ?? {}),
  };
  for (const slug of stringArrayValue(graph.node_slugs)) {
    weightedNodes[slug] = Math.max(weightedNodes[slug] ?? 0, 0.7);
  }

  Object.entries(weightedNodes).forEach(([slug, nodeWeight]) => {
    addScore(nodeScores, slug, baseWeight * nodeWeight * recency);
    daySet.add(slug);
  });
}

function buildNodeTerms(nodes: NodeRow[]) {
  const terms = new Map<string, string[]>();
  nodes.forEach((node) => {
    const values = new Set<string>();
    values.add(node.slug.toLowerCase());
    const title = normalizeText(node.title).trim();
    if (title) values.add(title);
    (node.aliases ?? []).forEach((alias) => {
      const normalized = normalizeText(alias).trim();
      if (normalized) values.add(normalized);
    });
    terms.set(
      node.slug,
      Array.from(values).filter((term) => term.length >= 3),
    );
  });
  return terms;
}

function scorePlannerBadge(
  badge: BadgeRow,
  nodeScores: Map<string, number>,
  plannerDayNodes: Map<string, Set<string>>,
  nodeTerms: Map<string, string[]>,
) {
  const tags = normalizeTags(badge.tags);
  if (!tags.has("planner")) return;

  const kind = plannerBadgeKind(tags, badge.event_id);
  const state = plannerBadgeState(tags);
  if (!kind || !state) return;

  const recency = recencyWeight(badge.occurred_on);
  const weightedSlugs = new Set<string>();
  const weightKey = `${kind}:${state}`;
  const weights = PLANNER_BADGE_WEIGHTS[weightKey] ?? {};
  Object.entries(weights).forEach(([slug, weight]) => {
    addScore(nodeScores, slug, weight * recency);
    weightedSlugs.add(slug);
  });

  const day = badge.occurred_on.substring(0, 10);
  if (!plannerDayNodes.has(day)) plannerDayNodes.set(day, new Set());
  const daySet = plannerDayNodes.get(day)!;
  weightedSlugs.forEach((slug) => daySet.add(slug));

  const combinedText = `${normalizeText(badge.title)} ${
    normalizeText(
      badge.details,
    )
  }`;
  if (!combinedText.trim()) return;

  nodeTerms.forEach((terms, slug) => {
    if (weightedSlugs.has(slug)) return;
    if (terms.some((term) => combinedText.includes(term))) {
      addScore(nodeScores, slug, 0.6 * recency);
      daySet.add(slug);
    }
  });
}

export async function handleRebuildPersonalGraphRequest(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const windowDays = Number(body?.date_window_days ?? 90);
    const client = getClient(req);
    const {
      data: { user },
      error: userErr,
    } = await client.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const sinceIso = since.toISOString();
    const sinceDay = sinceIso.substring(0, 10);

    const [
      { data: links },
      { data: events },
      { data: content },
      { data: nodesMap },
      { data: badges },
      { data: completions },
    ] = await Promise.all([
      client
        .from("insight_links")
        .select("target_type,target_id,created_at")
        .eq("user_id", user.id)
        .gte("created_at", sinceIso),
      client
        .from("user_choice_events")
        .select("event_type,node_id,created_at")
        .eq("user_id", user.id)
        .gte("created_at", sinceIso),
      client
        .from("node_user_content")
        .select("node_id,updated_at,plain_text")
        .eq("user_id", user.id),
      client.from("nodes").select("id,slug,title,aliases"),
      client
        .from("journal_badges")
        .select("title,details,tags,occurred_on,event_id")
        .eq("user_id", user.id)
        .gte("occurred_on", sinceDay),
      client
        .from(MAAT_FLOW_COMPLETION_SOURCE_TABLE)
        .select("completed_at,completed_on,metadata")
        .eq("user_id", user.id)
        .gte("completed_at", sinceIso),
    ]);

    const idToSlug = new Map<string, string>();
    const nodes = (nodesMap ?? []) as NodeRow[];
    nodes.forEach((n) => idToSlug.set(n.id, n.slug));
    const nodeTerms = buildNodeTerms(nodes);

    const nodeScores = new Map<string, number>();

    (links ?? []).forEach((l: LinkRow) => {
      if (l.target_type === "node") {
        const slug = idToSlug.get(l.target_id);
        if (slug) addScore(nodeScores, slug, 5 * recencyWeight(l.created_at));
      }
    });

    (events ?? []).forEach((ev: EventRow) => {
      const weight = EVENT_WEIGHTS[ev.event_type] ?? 0;
      const slug = ev.node_id ? idToSlug.get(ev.node_id) : null;
      if (slug && weight !== 0) {
        addScore(nodeScores, slug, weight * recencyWeight(ev.created_at));
      }
    });

    (content ?? []).forEach((c: ContentRow) => {
      if (!(c.plain_text ?? "").trim()) return;
      const slug = idToSlug.get(c.node_id);
      if (slug) addScore(nodeScores, slug, 4 * recencyWeight(c.updated_at));
    });

    const plannerDayNodes = new Map<string, Set<string>>();
    (badges ?? []).forEach((badge: BadgeRow) => {
      scorePlannerBadge(badge, nodeScores, plannerDayNodes, nodeTerms);
    });

    const completionDayNodes = new Map<string, Set<string>>();
    (completions ?? []).forEach((completion: CompletionRow) => {
      scoreMaatFlowCompletion(completion, nodeScores, completionDayNodes);
    });

    // Edge scores: based on co-occurrence of node links within same day
    const edgeScores = new Map<string, number>();
    const byDay = new Map<string, Set<string>>();
    (links ?? []).forEach((l: LinkRow) => {
      if (l.target_type !== "node") return;
      const slug = idToSlug.get(l.target_id);
      if (!slug) return;
      const day = l.created_at.substring(0, 10);
      if (!byDay.has(day)) byDay.set(day, new Set());
      byDay.get(day)!.add(slug);
    });
    plannerDayNodes.forEach((slugs, day) => {
      if (!byDay.has(day)) byDay.set(day, new Set());
      const bucket = byDay.get(day)!;
      slugs.forEach((slug) => bucket.add(slug));
    });
    completionDayNodes.forEach((slugs, day) => {
      if (!byDay.has(day)) byDay.set(day, new Set());
      const bucket = byDay.get(day)!;
      slugs.forEach((slug) => bucket.add(slug));
    });
    byDay.forEach((slugs, day) => {
      const arr = Array.from(slugs);
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const key = `${arr[i]}->${arr[j]}`;
          addScore(edgeScores, key, 5 * recencyWeight(day));
        }
      }
    });

    const sortedNodes = Array.from(nodeScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([slug, score]) => ({ slug, score }));
    const sortedEdges = Array.from(edgeScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([edge, score]) => {
        const [source, target] = edge.split("->");
        return { source, target, score };
      });

    const tensions = tensionPairs(sortedNodes.map((n) => n.slug));
    const maatScore = nodeScores.get("maat") ?? null;
    const isfetScore = nodeScores.get("isfet") ?? null;

    const profilePayload = {
      top_nodes: sortedNodes,
      top_edges: sortedEdges,
      dominant_patterns: sortedNodes.map((n) => n.slug),
      tension_pairs: tensions,
      maat_score: maatScore,
      isfet_risk_score: isfetScore,
      last_computed_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await client.from("reflection_profiles")
      .upsert({
        user_id: user.id,
        ...profilePayload,
      });
    if (upsertErr) {
      console.error("upsert profile error", upsertErr);
      return new Response(JSON.stringify({ error: upsertErr.message }), {
        status: 400,
      });
    }

    return new Response(JSON.stringify({ profile: profilePayload }), {
      status: 200,
    });
  } catch (e) {
    console.error("rebuild_personal_graph error", e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
    });
  }
}

if (import.meta.main) {
  serve(handleRebuildPersonalGraphRequest);
}
