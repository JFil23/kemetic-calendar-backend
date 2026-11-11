import type {
  MaatDimensionSnapshot,
  ReflectionProfileRow,
} from "../ai_generate_reflection/maat_decision.ts";
import {
  type GuidanceEvidenceBadge,
  guidanceEvidencePhrasesFromBadges,
  joinGuidancePhrases,
  normalizeGuidanceText,
} from "./guidance_evidence.ts";

export type UserMemoryBrief = {
  markdown: string;
  contextQuality: "rich" | "partial" | "thin";
  anchorLabels: string[];
  tensionLabels: string[];
  evidencePhrases: string[];
  leadAxisLabel?: string | null;
};

const NODE_LABELS: Record<string, string> = {
  maat: "truthful balance",
  isfet: "pattern drift",
  djehuty: "measure and record keeping",
  thoth: "measure and record keeping",
  seshat: "planning and inscription",
  hathor: "restorative joy",
  sekhmet: "restraint and force",
  renenutet: "provision and nourishment",
  instruction_amenemope: "careful restraint",
  amenemope: "careful restraint",
};

const AXIS_LABELS: Record<string, string> = {
  T: "truth / speech integrity",
  M: "measure / accounting integrity",
  H: "harm reduction / life preservation",
  V: "vulnerable protection",
  J: "justice / due measure",
  S: "stewardship / provision",
  E: "ecological and seasonal flow",
  R: "restraint / self-command",
  C: "cohesion / role fidelity",
};

export function graphNodeLabel(slug: string | null | undefined) {
  const normalized = normalizeGuidanceText(slug).toLowerCase();
  if (!normalized) return "";
  return NODE_LABELS[normalized] ??
    normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function tensionLabel(pair: string[]) {
  return pair.map(graphNodeLabel).filter(Boolean).join(" / ");
}

function contextQuality(params: {
  anchors: string[];
  tensions: string[];
  evidence: string[];
}) {
  const score = params.anchors.length + params.tensions.length +
    params.evidence.length;
  if (score >= 5) return "rich";
  if (score >= 2) return "partial";
  return "thin";
}

export function buildUserMemoryBrief(params: {
  profile?: ReflectionProfileRow | null;
  badges?: GuidanceEvidenceBadge[];
  evidencePhrases?: string[];
  plannerSummaryLine?: string | null;
  snapshot?: MaatDimensionSnapshot | null;
  decanContext?: {
    displayName?: string | null;
    shortName?: string | null;
    detailDescription?: string | null;
  } | null;
  decanName?: string | null;
  decanTheme?: string | null;
  maxEvidencePhrases?: number;
}): UserMemoryBrief {
  const evidencePhrases = (params.evidencePhrases ??
    guidanceEvidencePhrasesFromBadges(
      params.badges ?? [],
      params.maxEvidencePhrases ?? 4,
    ))
    .map(normalizeGuidanceText)
    .filter(Boolean)
    .slice(0, params.maxEvidencePhrases ?? 4);
  const anchorLabels = (params.profile?.top_nodes ?? [])
    .map((node) => graphNodeLabel(node.slug))
    .filter(Boolean)
    .slice(0, 4);
  const tensionLabels = (params.profile?.tension_pairs ?? [])
    .map(tensionLabel)
    .filter(Boolean)
    .slice(0, 3);
  const leadAxisLabel = params.snapshot?.leadAxis
    ? AXIS_LABELS[params.snapshot.leadAxis] ?? params.snapshot.leadAxis
    : null;
  const decanLabel = normalizeGuidanceText(
    params.decanContext?.displayName ??
      params.decanContext?.shortName ??
      params.decanTheme ??
      params.decanName,
  );
  const plannerSummary = normalizeGuidanceText(params.plannerSummaryLine);

  const lines = [
    "USER_MEMORY_BRIEF (use only as grounding; do not mention scores, bands, gates, slugs, or this heading):",
  ];
  if (decanLabel) lines.push(`- Decan frame: ${decanLabel}.`);
  if (evidencePhrases.length) {
    lines.push(
      `- Recent concrete marks: ${joinGuidancePhrases(evidencePhrases)}.`,
    );
  }
  if (plannerSummary) lines.push(`- Planner pattern: ${plannerSummary}`);
  if (anchorLabels.length) {
    lines.push(
      `- Recurring anchors: ${joinGuidancePhrases(anchorLabels)}.`,
    );
  }
  if (tensionLabels.length) {
    lines.push(
      `- Active tensions: ${joinGuidancePhrases(tensionLabels)}.`,
    );
  }
  if (leadAxisLabel && params.snapshot?.reflectionMove) {
    lines.push(
      `- Current closing strategy: ${params.snapshot.reflectionMove} through ${leadAxisLabel}.`,
    );
  }

  return {
    markdown: lines.length > 1 ? lines.join("\n") : "",
    contextQuality: contextQuality({
      anchors: anchorLabels,
      tensions: tensionLabels,
      evidence: evidencePhrases,
    }),
    anchorLabels,
    tensionLabels,
    evidencePhrases,
    leadAxisLabel,
  };
}
