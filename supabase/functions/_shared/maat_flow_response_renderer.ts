import type {
  MaatFlowDecanPatternSynthesis,
  MaatResponseKind,
  SelectedLensSeed,
} from "./maat_flow_response_spectrum.ts";

export type DeterministicMaatFlowResponse = {
  responseKind: MaatResponseKind;
  title: string;
  body: string;
  badgeTitle: string;
  badgeBody: string;
  detailBody?: string;
  centralTension?: string;
  selectedSeed: SelectedLensSeed;
  confidence: "low" | "medium" | "high";
  fallbackReason?: string;
  source: "deterministic_spectrum";
  usedLlm: false;
};

export type RenderMaatFlowResponseOptions = {
  decanName?: string | null;
  decanTheme?: string | null;
  decanContextKey?: string | null;
};

export type MaatFlowRuntimeRenderMode = {
  allowLlmForMaatFlowResponse: boolean;
  useDeterministicMaatFlowRenderer: boolean;
};

function compactText(value: unknown) {
  return (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
}

function joinSentences(parts: Array<string | null | undefined>) {
  return parts.map(compactText).filter(Boolean).join(" ");
}

function selectedSeedForKind(
  pattern: MaatFlowDecanPatternSynthesis,
  responseKind: MaatResponseKind,
) {
  switch (responseKind) {
    case "reflection":
      return pattern.selectedSeeds.reflection;
    case "orientation":
      return pattern.selectedSeeds.orientation;
    case "alignment":
      return pattern.selectedSeeds.alignment;
  }
}

function titleFor(
  seed: SelectedLensSeed,
  options: RenderMaatFlowResponseOptions,
) {
  const decanName = compactText(options.decanName);
  return decanName ? `${decanName} ${seed.badgeTitle}` : seed.badgeTitle;
}

export function renderMaatFlowResponse(
  pattern: MaatFlowDecanPatternSynthesis,
  responseKind: MaatResponseKind,
  options: RenderMaatFlowResponseOptions = {},
): DeterministicMaatFlowResponse | null {
  const selectedSeed = selectedSeedForKind(pattern, responseKind);
  if (!selectedSeed) return null;

  const seedBody = compactText(selectedSeed.seed);
  const seedBadgeBody = compactText(selectedSeed.badgeBody);
  const centralTension = compactText(pattern.centralTension);
  const badgeBody = seedBadgeBody || seedBody;
  let body = seedBody;
  let detailBody: string | undefined;

  if (responseKind === "reflection") {
    detailBody = centralTension
      ? joinSentences([centralTension, seedBody])
      : seedBody;
    body = detailBody;
  }

  return {
    responseKind,
    title: titleFor(selectedSeed, options),
    body,
    badgeTitle: selectedSeed.badgeTitle,
    badgeBody,
    detailBody,
    centralTension: centralTension || undefined,
    selectedSeed,
    confidence: pattern.confidence,
    fallbackReason: pattern.fallbackReason,
    source: "deterministic_spectrum",
    usedLlm: false,
  };
}

export function resolveMaatFlowRuntimeRenderMode(params: {
  hasMaatFlowSpectrumResponse: boolean;
  allowLlmMaatRuntime: boolean;
  explicitAdminLlmRequested: boolean;
}): MaatFlowRuntimeRenderMode {
  const allowLlmForMaatFlowResponse = params.hasMaatFlowSpectrumResponse &&
    params.allowLlmMaatRuntime &&
    params.explicitAdminLlmRequested;
  return {
    allowLlmForMaatFlowResponse,
    useDeterministicMaatFlowRenderer: params.hasMaatFlowSpectrumResponse &&
      !allowLlmForMaatFlowResponse,
  };
}

export function maatFlowResponseRendererMetadata(
  response: DeterministicMaatFlowResponse,
) {
  return {
    renderer: "deterministic_spectrum",
    source: response.source,
    used_llm: response.usedLlm,
    llm_cost: 0,
    spectrum_flow_key: response.selectedSeed.flowKey,
    response_kind: response.responseKind,
    selected_tier: response.selectedSeed.tier,
    selected_seed: response.selectedSeed.seed,
    confidence: response.confidence,
    spectrum_fallback_reason: response.fallbackReason ?? null,
    badge_title: response.badgeTitle,
    badge_role: response.selectedSeed.badgeRole,
    preferred_surface: response.selectedSeed.preferredSurface,
  };
}
