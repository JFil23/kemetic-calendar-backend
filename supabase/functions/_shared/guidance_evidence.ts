export type GuidanceEvidenceBadge = {
  title?: string | null;
  details?: string | null;
  tags?: string[] | null;
  occurred_on?: string | null;
  event_id?: string | null;
};

export function normalizeGuidanceText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
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
