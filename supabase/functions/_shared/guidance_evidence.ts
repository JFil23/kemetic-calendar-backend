import type { CanonicalCompletionTier } from "./maat_flow_response_spectrum.ts";

export type GuidanceEvidenceBadge = {
  title?: string | null;
  details?: string | null;
  tags?: string[] | null;
  occurred_on?: string | null;
  event_id?: string | null;
  flow_id?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type MaatCompletionCanonicalTier = CanonicalCompletionTier;

export type MaatFlowCompletionRow = {
  id: number;
  client_event_id: string | null;
  flow_id: number | null;
  completed_on: string;
  completed_at: string | null;
  source: string | null;
  metadata?: Record<string, unknown> | null;
};

export type MaatFlowCompletionEventRow = {
  id?: string | number | null;
  client_event_id: string | null;
  title: string | null;
  category?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  flow_local_id?: number | null;
  flow_tpl_key?: string | null;
  action_id?: string | null;
  behavior_payload?: Record<string, unknown> | null;
};

export type MaatFlowCompletionFlowRow = {
  id: number;
  name: string | null;
  active?: boolean | null;
  is_hidden?: boolean | null;
};

export type MaatFlowCompletionEvidenceBadge = GuidanceEvidenceBadge & {
  title: string;
  details: string;
  tags: string[];
  occurred_on: string;
  flow_id: number | null;
  event_id: string;
  source: "user_event_completions";
  completion_id: number;
  client_event_id: string | null;
  completed_at: string | null;
  raw_status: string;
  canonical_tier: MaatCompletionCanonicalTier;
  flow_key: string | null;
  flow_title: string | null;
  event_title: string | null;
};

export function normalizeGuidanceText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeEvidenceStatus(value: unknown) {
  return normalizeGuidanceText(value == null ? null : String(value))
    .toLowerCase();
}

export function canonicalTierForMaatCompletionStatus(
  status: string | null | undefined,
): MaatCompletionCanonicalTier {
  const normalized = normalizeEvidenceStatus(status);
  switch (normalized) {
    case "observed":
    case "done":
    case "complete":
    case "completed":
    case "observed_from_inside":
    case "names_spoken":
    case "raised":
    case "decision_pronounced":
    case "transmitted":
    case "stones_placed":
    case "cooled":
    case "spoken":
    case "record_complete":
    case "beer_poured":
    case "golden_one_present":
      return "observed";
    case "partial":
    case "partly":
    case "observed_partly":
    case "partly_observed":
    case "in_progress":
    case "conversation_pending":
      return "partial";
    case "skipped":
    case "skip":
      return "skipped_explicit";
    default:
      return "unobserved";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataRecord(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringFrom(value: unknown) {
  const text = normalizeGuidanceText(value == null ? null : String(value));
  return text || null;
}

function completionRawStatus(metadata: Record<string, unknown>) {
  return stringFrom(metadata.status) ??
    stringFrom(metadata.completion_status) ??
    "observed";
}

function completionFlowKey(params: {
  metadata: Record<string, unknown>;
  event?: MaatFlowCompletionEventRow | null;
}) {
  return stringFrom(params.metadata.flow_key) ??
    stringFrom(params.event?.behavior_payload?.flow_key) ??
    stringFrom(params.event?.flow_tpl_key);
}

function completionEventTitle(params: {
  metadata: Record<string, unknown>;
  event?: MaatFlowCompletionEventRow | null;
  isDisallowedTitle?: (title: string) => boolean;
}) {
  const metadataTitle = stringFrom(params.metadata.event_title);
  if (metadataTitle && !params.isDisallowedTitle?.(metadataTitle)) {
    return metadataTitle;
  }
  const eventTitle = stringFrom(params.event?.title);
  if (eventTitle && !params.isDisallowedTitle?.(eventTitle)) return eventTitle;
  return null;
}

function completionFlowTitle(params: {
  metadata: Record<string, unknown>;
  flow?: MaatFlowCompletionFlowRow | null;
  isDisallowedTitle?: (title: string) => boolean;
}) {
  const metadataTitle = stringFrom(params.metadata.flow_title);
  if (metadataTitle && !params.isDisallowedTitle?.(metadataTitle)) {
    return metadataTitle;
  }
  const flowTitle = stringFrom(params.flow?.name);
  if (flowTitle && !params.isDisallowedTitle?.(flowTitle)) return flowTitle;
  return null;
}

function titlePrefixForTier(tier: MaatCompletionCanonicalTier) {
  switch (tier) {
    case "observed":
      return "Observed flow";
    case "partial":
      return "Partly observed flow";
    case "skipped_explicit":
      return "Skipped flow";
    case "unobserved":
      return "Unobserved flow";
  }
}

function stateTagForTier(tier: MaatCompletionCanonicalTier) {
  switch (tier) {
    case "observed":
      return "state:observed";
    case "partial":
      return "state:partial";
    case "skipped_explicit":
      return "state:skipped";
    case "unobserved":
      return "state:unobserved";
  }
}

export function buildMaatFlowCompletionEvidenceBadges(params: {
  completions: MaatFlowCompletionRow[];
  eventByClientId?: Map<string, MaatFlowCompletionEventRow>;
  flowById?: Map<number, MaatFlowCompletionFlowRow>;
  isDisallowedTitle?: (title: string) => boolean;
}): MaatFlowCompletionEvidenceBadge[] {
  return params.completions.map((completion) => {
    const metadata = metadataRecord(completion.metadata);
    const clientEventId = stringFrom(completion.client_event_id);
    const event = clientEventId
      ? params.eventByClientId?.get(clientEventId)
      : null;
    const flow = typeof completion.flow_id === "number"
      ? params.flowById?.get(completion.flow_id)
      : null;
    const rawStatus = completionRawStatus(metadata);
    const canonicalTier = canonicalTierForMaatCompletionStatus(rawStatus);
    const flowKey = completionFlowKey({ metadata, event });
    const flowTitle = completionFlowTitle({
      metadata,
      flow,
      isDisallowedTitle: params.isDisallowedTitle,
    });
    const eventTitle = completionEventTitle({
      metadata,
      event,
      isDisallowedTitle: params.isDisallowedTitle,
    });
    const displayTitle = eventTitle ?? flowTitle ?? "Ma'at flow step";
    const completedOn = stringFrom(metadata.completed_on) ??
      completion.completed_on;
    const semanticMetadata = {
      ...metadata,
      status: rawStatus,
      flow_key: flowKey,
      flow_title: flowTitle,
      event_title: eventTitle,
      completed_on: completedOn,
      completed_at: completion.completed_at,
      canonical_tier: canonicalTier,
    };
    const tags = [
      "flow",
      "maat_flow",
      "practice",
      stateTagForTier(canonicalTier),
      `tier:${canonicalTier}`,
      `status:${rawStatus}`,
      flowKey ? `flow_key:${flowKey}` : "",
    ].filter(Boolean);
    return {
      title: `${titlePrefixForTier(canonicalTier)}: ${displayTitle}`,
      details: [
        `Status: ${rawStatus}.`,
        `Canonical tier: ${canonicalTier}.`,
        flowKey ? `Flow key: ${flowKey}.` : "",
        flowTitle ? `Flow title: ${flowTitle}.` : "",
        eventTitle ? `Event title: ${eventTitle}.` : "",
        `Completed on: ${completedOn}.`,
        completion.completed_at
          ? `Completed at: ${completion.completed_at}.`
          : "",
      ].filter(Boolean).join(" "),
      tags,
      occurred_on: completedOn,
      flow_id: completion.flow_id ?? null,
      event_id: clientEventId
        ? `flow-completion:${clientEventId}`
        : `flow-completion:${completion.id}`,
      source: "user_event_completions",
      completion_id: completion.id,
      client_event_id: clientEventId,
      completed_at: completion.completed_at,
      raw_status: rawStatus,
      canonical_tier: canonicalTier,
      flow_key: flowKey,
      flow_title: flowTitle,
      event_title: eventTitle,
      metadata: semanticMetadata,
    };
  });
}

export async function fetchMaatFlowCompletionEvidenceBadges(params: {
  // deno-lint-ignore no-explicit-any
  client: any;
  userId: string;
  start: string;
  end: string;
  isDisallowedTitle?: (title: string) => boolean;
  limit?: number;
}): Promise<MaatFlowCompletionEvidenceBadge[]> {
  const { data, error } = await params.client
    .from("user_event_completions")
    .select(
      "id, client_event_id, flow_id, completed_on, completed_at, source, metadata",
    )
    .eq("user_id", params.userId)
    .gte("completed_on", params.start)
    .lte("completed_on", params.end)
    .order("completed_on", { ascending: true })
    .limit(params.limit ?? 80);

  if (error) throw error;

  const completions = (data ?? []) as MaatFlowCompletionRow[];
  if (!completions.length) return [];

  const clientIds = [
    ...new Set(
      completions.map((row) => normalizeGuidanceText(row.client_event_id))
        .filter(Boolean),
    ),
  ];
  const flowIds = [
    ...new Set(
      completions.map((row) => row.flow_id).filter((
        id,
      ): id is number => typeof id === "number"),
    ),
  ];

  const eventByClientId = new Map<string, MaatFlowCompletionEventRow>();
  if (clientIds.length) {
    const { data: events, error: eventsError } = await params.client
      .from("user_events")
      .select(
        "id, client_event_id, title, category, starts_at, ends_at, flow_local_id, flow_tpl_key, action_id, behavior_payload",
      )
      .eq("user_id", params.userId)
      .in("client_event_id", clientIds)
      .limit(100);
    if (eventsError) throw eventsError;
    for (const event of (events ?? []) as MaatFlowCompletionEventRow[]) {
      const clientId = normalizeGuidanceText(event.client_event_id);
      if (clientId) eventByClientId.set(clientId, event);
    }
  }

  const flowById = new Map<number, MaatFlowCompletionFlowRow>();
  if (flowIds.length) {
    const { data: flows, error: flowsError } = await params.client
      .from("flows")
      .select("id, name, active, is_hidden")
      .eq("user_id", params.userId)
      .in("id", flowIds)
      .limit(100);
    if (flowsError) throw flowsError;
    for (const flow of (flows ?? []) as MaatFlowCompletionFlowRow[]) {
      flowById.set(flow.id, flow);
    }
  }

  return buildMaatFlowCompletionEvidenceBadges({
    completions,
    eventByClientId,
    flowById,
    isDisallowedTitle: params.isDisallowedTitle,
  });
}

function cleanedEvidenceCandidate(value: string) {
  return normalizeGuidanceText(value)
    .replace(/^(completed|in-progress|partial|skipped)?\s*to-do:\s*/i, "")
    .replace(/^(completed|partial|skipped)?\s*nutrition:\s*/i, "")
    .replace(/^task:\s*/i, "")
    .replace(/^journal:\s*/i, "")
    .trim();
}

export function guidanceEvidencePhrasesFromLines(
  evidenceLines: string[],
  limit = 3,
) {
  const seen = new Set<string>();
  const examples: string[] = [];

  for (const line of evidenceLines) {
    const parts = line.split(" - ").map(normalizeGuidanceText);
    const candidate = parts.find((part) =>
      part &&
      !/^\d{4}-\d{2}-\d{2}$/.test(part) &&
      !part.toLowerCase().startsWith("tags:")
    ) ?? "";
    const cleaned = cleanedEvidenceCandidate(candidate);
    if (!cleaned || cleaned.length < 3) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    examples.push(cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned);
    if (examples.length >= limit) break;
  }

  return examples;
}

export function guidanceEvidencePhrasesFromBadges(
  badges: GuidanceEvidenceBadge[],
  limit = 3,
) {
  const lines = badges.map((badge) => {
    const parts = [
      normalizeGuidanceText(badge.occurred_on),
      normalizeGuidanceText(badge.title),
      normalizeGuidanceText(badge.details),
      badge.tags?.length ? `tags: ${badge.tags.join(", ")}` : "",
    ].filter(Boolean);
    return parts.join(" - ");
  });
  return guidanceEvidencePhrasesFromLines(lines, limit);
}

export function joinGuidancePhrases(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values[0]}, ${values[1]}, and ${values[2]}`;
}
