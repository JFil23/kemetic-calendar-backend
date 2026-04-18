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

type ContentRow = { node_id: string; updated_at: string };

type BadgeRow = {
  title: string | null;
  details: string | null;
  tags: string[] | null;
  occurred_on: string;
  event_id: string | null;
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
};

function getClient(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
}

function recencyWeight(dateStr: string, now = new Date()) {
  const d = new Date(dateStr);
  const days = Math.max(0, (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
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
  return new Set((tags ?? []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean));
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
  return null;
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

  const combinedText = `${normalizeText(badge.title)} ${normalizeText(
    badge.details,
  )}`;
  if (!combinedText.trim()) return;

  nodeTerms.forEach((terms, slug) => {
    if (weightedSlugs.has(slug)) return;
    if (terms.some((term) => combinedText.includes(term))) {
      addScore(nodeScores, slug, 0.6 * recency);
      daySet.add(slug);
    }
  });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const sinceIso = since.toISOString();
    const sinceDay = sinceIso.substring(0, 10);

    const [{ data: links }, { data: events }, { data: content }, { data: nodesMap }, { data: badges }] = await Promise.all([
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
        .select("node_id,updated_at")
        .eq("user_id", user.id),
      client.from("nodes").select("id,slug,title,aliases"),
      client
        .from("journal_badges")
        .select("title,details,tags,occurred_on,event_id")
        .eq("user_id", user.id)
        .gte("occurred_on", sinceDay),
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
      if (slug && weight !== 0) addScore(nodeScores, slug, weight * recencyWeight(ev.created_at));
    });

    (content ?? []).forEach((c: ContentRow) => {
      const slug = idToSlug.get(c.node_id);
      if (slug) addScore(nodeScores, slug, 4 * recencyWeight(c.updated_at));
    });

    const plannerDayNodes = new Map<string, Set<string>>();
    (badges ?? []).forEach((badge: BadgeRow) => {
      scorePlannerBadge(badge, nodeScores, plannerDayNodes, nodeTerms);
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

    const { error: upsertErr } = await client.from("reflection_profiles").upsert({
      user_id: user.id,
      ...profilePayload,
    });
    if (upsertErr) {
      console.error("upsert profile error", upsertErr);
      return new Response(JSON.stringify({ error: upsertErr.message }), { status: 400 });
    }

    return new Response(JSON.stringify({ profile: profilePayload }), { status: 200 });
  } catch (e) {
    console.error("rebuild_personal_graph error", e);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
});
