export type OutputCompilerSurface =
  | "nudge"
  | "reflection"
  | "opening"
  | "push";

export type OutputCompilerStatus = "compiled" | "fallback";

export type OutputCompilerDeliveryRecommendation =
  | "push"
  | "in_app_card"
  | "archive_only";

export type OutputCompilerTrace = {
  compiler_version: "maat_output_compiler_v1";
  surface: OutputCompilerSurface;
  status: OutputCompilerStatus;
  renderer: string;
  model_version: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  fallback_quality: boolean;
  not_quality_proof: boolean;
  delivery_recommendation: OutputCompilerDeliveryRecommendation;
  case_key: string | null;
  offering: string | null;
  example_id: string | null;
  example_ids: string[];
  example_available: boolean;
  diagnosis: string | null;
  concrete_action: string | null;
  evidence_anchor_count: number;
  final_text: string;
  teaser_text: string | null;
  push_text: string | null;
  prompt_trace: {
    system_prompt_present: boolean;
    user_prompt_present: boolean;
    system_prompt_chars: number;
    user_prompt_chars: number;
    prompt_text_included: false;
  };
  validation: Record<string, unknown> | null;
  grade: Record<string, unknown> | null;
  repair_history: Array<Record<string, unknown>>;
};

export type CompiledOutputPackage = {
  package_version: "compiled_output_package_v1";
  surface: OutputCompilerSurface;
  final_text: string;
  teaser_text: string | null;
  push_text: string | null;
  archive_preview_text: string | null;
  cta_type: string | null;
  cta_ref: string | null;
  cta: CompiledOutputCta | null;
  destination: CompiledOutputDestination | null;
  render_model: string;
  fallback_used: boolean;
  fallback_quality: boolean;
  not_quality_proof: boolean;
  delivery_recommendation: OutputCompilerDeliveryRecommendation;
  compiler: OutputCompilerTrace;
};

export type CompiledOutputCta = {
  type: string;
  ref: string;
  label: string | null;
  reason: string | null;
  source: string | null;
};

export type CompiledOutputDestination = {
  type: string;
  ref: string;
  label: string | null;
  reason: string | null;
  source: string | null;
  confidence: number | null;
  score?: number | null;
  signals?: string[];
  motivation?: Record<string, unknown> | null;
  fallback: Record<string, unknown> | null;
};

export type CompiledPushTextSource =
  | "compiled_package.push_text"
  | "legacy_push_text"
  | "legacy_teaser_text"
  | "legacy_body_excerpt"
  | "blocked_fallback"
  | "compiled_package_missing_push_text"
  | "empty";

export type CompiledPushTextResolution = {
  text: string | null;
  source: CompiledPushTextSource;
  blocked: boolean;
  reason: string | null;
  hasCompiledPackage: boolean;
  packageVersion: string | null;
  compilerStatus: string | null;
  fallbackUsed: boolean | null;
  notQualityProof: boolean | null;
  deliveryRecommendation: OutputCompilerDeliveryRecommendation | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanExcerpt(value: unknown, maxChars: number): string {
  const text = clean(value);
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = lastSpace > 40 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trim()}...`;
}

function nestedPackage(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.compiled_output_package)) {
    return value.compiled_output_package;
  }
  if (isRecord(value.compiledOutputPackage)) return value.compiledOutputPackage;
  const outputControl = isRecord(value.output_control)
    ? value.output_control
    : isRecord(value.outputControl)
    ? value.outputControl
    : null;
  if (isRecord(outputControl?.compiled_output_package)) {
    return outputControl.compiled_output_package;
  }
  if (isRecord(outputControl?.compiledOutputPackage)) {
    return outputControl.compiledOutputPackage;
  }
  if (isRecord(value.payload)) return nestedPackage(value.payload);
  return null;
}

export function compiledOutputPackageFromPayload(
  payload: unknown,
): Record<string, unknown> | null {
  const outputPackage = nestedPackage(payload);
  if (
    outputPackage?.package_version === "compiled_output_package_v1" ||
    clean(outputPackage?.final_text) ||
    clean(outputPackage?.push_text)
  ) {
    return outputPackage;
  }
  return null;
}

export function resolveCompiledPackagePushText(params: {
  payload?: unknown;
  compiledPackage?: unknown;
  legacyPushText?: unknown;
  legacyTeaserText?: unknown;
  legacyBodyText?: unknown;
  requireCompiledPushText?: boolean;
  maxLegacyExcerptChars?: number;
}): CompiledPushTextResolution {
  const outputPackage = isRecord(params.compiledPackage)
    ? params.compiledPackage
    : compiledOutputPackageFromPayload(params.payload);
  const deliveryRecommendation = clean(outputPackage?.delivery_recommendation);
  const compiler = isRecord(outputPackage?.compiler)
    ? outputPackage.compiler
    : null;
  const compilerStatus = clean(compiler?.status) || null;
  const fallbackUsed = outputPackage
    ? outputPackage.fallback_used === true ||
      (compiler ? compiler.fallback_used === true : false)
    : null;
  const notQualityProof = outputPackage
    ? outputPackage.not_quality_proof === true ||
      (compiler ? compiler.not_quality_proof === true : false)
    : null;
  const packageVersion = clean(outputPackage?.package_version) || null;

  if (outputPackage) {
    if (
      fallbackUsed === true ||
      notQualityProof === true ||
      deliveryRecommendation === "archive_only"
    ) {
      return {
        text: null,
        source: "blocked_fallback",
        blocked: true,
        reason: "compiled_package_not_quality_proof",
        hasCompiledPackage: true,
        packageVersion,
        compilerStatus,
        fallbackUsed,
        notQualityProof,
        deliveryRecommendation: deliveryRecommendation === "push" ||
            deliveryRecommendation === "in_app_card" ||
            deliveryRecommendation === "archive_only"
          ? deliveryRecommendation
          : null,
      };
    }

    const pushText = clean(outputPackage.push_text);
    if (pushText) {
      return {
        text: pushText,
        source: "compiled_package.push_text",
        blocked: false,
        reason: null,
        hasCompiledPackage: true,
        packageVersion,
        compilerStatus,
        fallbackUsed,
        notQualityProof,
        deliveryRecommendation: deliveryRecommendation === "push" ||
            deliveryRecommendation === "in_app_card" ||
            deliveryRecommendation === "archive_only"
          ? deliveryRecommendation
          : null,
      };
    }

    if (params.requireCompiledPushText !== false) {
      return {
        text: null,
        source: "compiled_package_missing_push_text",
        blocked: true,
        reason: "compiled_package_missing_push_text",
        hasCompiledPackage: true,
        packageVersion,
        compilerStatus,
        fallbackUsed,
        notQualityProof,
        deliveryRecommendation: deliveryRecommendation === "push" ||
            deliveryRecommendation === "in_app_card" ||
            deliveryRecommendation === "archive_only"
          ? deliveryRecommendation
          : null,
      };
    }
  }

  const legacyPushText = clean(params.legacyPushText);
  if (legacyPushText) {
    return {
      text: legacyPushText,
      source: "legacy_push_text",
      blocked: false,
      reason: null,
      hasCompiledPackage: Boolean(outputPackage),
      packageVersion,
      compilerStatus,
      fallbackUsed,
      notQualityProof,
      deliveryRecommendation: null,
    };
  }

  const legacyTeaserText = clean(params.legacyTeaserText);
  if (legacyTeaserText) {
    return {
      text: legacyTeaserText,
      source: "legacy_teaser_text",
      blocked: false,
      reason: null,
      hasCompiledPackage: Boolean(outputPackage),
      packageVersion,
      compilerStatus,
      fallbackUsed,
      notQualityProof,
      deliveryRecommendation: null,
    };
  }

  const legacyBodyExcerpt = cleanExcerpt(
    params.legacyBodyText,
    params.maxLegacyExcerptChars ?? 120,
  );
  if (legacyBodyExcerpt) {
    return {
      text: legacyBodyExcerpt,
      source: "legacy_body_excerpt",
      blocked: false,
      reason: null,
      hasCompiledPackage: Boolean(outputPackage),
      packageVersion,
      compilerStatus,
      fallbackUsed,
      notQualityProof,
      deliveryRecommendation: null,
    };
  }

  return {
    text: null,
    source: "empty",
    blocked: false,
    reason: null,
    hasCompiledPackage: Boolean(outputPackage),
    packageVersion,
    compilerStatus,
    fallbackUsed,
    notQualityProof,
    deliveryRecommendation: null,
  };
}

export function compilerStatusFromRenderer(params: {
  renderer: string | null | undefined;
  fallbackReason?: string | null;
}): OutputCompilerStatus {
  const renderer = clean(params.renderer);
  const fallbackReason = clean(params.fallbackReason);
  return (renderer === "anthropic" || renderer === "deterministic_spectrum") &&
      !fallbackReason
    ? "compiled"
    : "fallback";
}

export function buildOutputCompilerTrace(params: {
  surface: OutputCompilerSurface;
  renderer: string;
  modelVersion: string;
  status?: OutputCompilerStatus;
  fallbackReason?: string | null;
  deliveryRecommendation?: OutputCompilerDeliveryRecommendation | null;
  caseKey?: string | null;
  offering?: string | null;
  exampleId?: string | null;
  exampleIds?: string[] | null;
  exampleAvailable?: boolean | null;
  diagnosis?: string | null;
  concreteAction?: string | null;
  evidenceAnchorCount?: number | null;
  finalText: string;
  teaserText?: string | null;
  pushText?: string | null;
  systemPrompt?: string | null;
  userPrompt?: string | null;
  validation?: Record<string, unknown> | null;
  grade?: Record<string, unknown> | null;
  repairHistory?: Array<Record<string, unknown>> | null;
}): OutputCompilerTrace {
  const renderer = clean(params.renderer) || "unknown";
  const fallbackReason = clean(params.fallbackReason) || null;
  const status = params.status ??
    compilerStatusFromRenderer({ renderer, fallbackReason });
  const fallbackUsed = status !== "compiled";
  const exampleIds = (params.exampleIds ?? [])
    .map((id) => clean(id))
    .filter(Boolean);
  const exampleId = clean(params.exampleId) || exampleIds[0] || null;
  const systemPrompt = params.systemPrompt ?? "";
  const userPrompt = params.userPrompt ?? "";
  return {
    compiler_version: "maat_output_compiler_v1",
    surface: params.surface,
    status,
    renderer,
    model_version: clean(params.modelVersion) || renderer,
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason,
    fallback_quality: fallbackUsed,
    not_quality_proof: fallbackUsed,
    delivery_recommendation: fallbackUsed
      ? "archive_only"
      : params.deliveryRecommendation ?? "in_app_card",
    case_key: clean(params.caseKey) || null,
    offering: clean(params.offering) || null,
    example_id: exampleId,
    example_ids: exampleIds,
    example_available: params.exampleAvailable ?? Boolean(exampleId),
    diagnosis: clean(params.diagnosis) || null,
    concrete_action: clean(params.concreteAction) || null,
    evidence_anchor_count: Math.max(0, Number(params.evidenceAnchorCount ?? 0)),
    final_text: params.finalText,
    teaser_text: params.teaserText ?? null,
    push_text: params.pushText ?? null,
    prompt_trace: {
      system_prompt_present: clean(systemPrompt).length > 0,
      user_prompt_present: clean(userPrompt).length > 0,
      system_prompt_chars: systemPrompt.length,
      user_prompt_chars: userPrompt.length,
      prompt_text_included: false,
    },
    validation: params.validation ?? null,
    grade: params.grade ?? null,
    repair_history: params.repairHistory ?? [],
  };
}

export function buildCompiledOutputPackage(params: {
  surface: OutputCompilerSurface;
  finalText: string;
  teaserText?: string | null;
  pushText?: string | null;
  archivePreviewText?: string | null;
  ctaType?: string | null;
  ctaRef?: string | null;
  ctaLabel?: string | null;
  ctaReason?: string | null;
  ctaSource?: string | null;
  destination?: CompiledOutputDestination | null;
  compiler: OutputCompilerTrace;
}): CompiledOutputPackage {
  const destination = params.compiler.fallback_used ||
      params.compiler.not_quality_proof ||
      params.compiler.delivery_recommendation === "archive_only"
    ? null
    : params.destination ?? (
      params.ctaType && params.ctaRef
        ? {
          type: params.ctaType,
          ref: params.ctaRef,
          label: params.ctaLabel ?? null,
          reason: params.ctaReason ?? null,
          source: params.ctaSource ?? null,
          confidence: null,
          fallback: null,
        }
        : null
    );
  const cta = destination
    ? {
      type: destination.type,
      ref: destination.ref,
      label: destination.label,
      reason: destination.reason,
      source: destination.source,
    }
    : null;
  return {
    package_version: "compiled_output_package_v1",
    surface: params.surface,
    final_text: params.finalText,
    teaser_text: params.teaserText ?? null,
    push_text: params.pushText ?? null,
    archive_preview_text: params.archivePreviewText ?? null,
    cta_type: cta?.type ?? null,
    cta_ref: cta?.ref ?? null,
    cta,
    destination,
    render_model: params.compiler.model_version,
    fallback_used: params.compiler.fallback_used,
    fallback_quality: params.compiler.fallback_quality,
    not_quality_proof: params.compiler.not_quality_proof,
    delivery_recommendation: params.compiler.delivery_recommendation,
    compiler: params.compiler,
  };
}
