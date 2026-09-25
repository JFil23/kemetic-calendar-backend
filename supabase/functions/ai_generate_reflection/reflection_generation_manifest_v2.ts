import type {
  ControlledGeneratedTextPlan,
  ControlledOutputGrade,
} from "../_shared/output_control.ts";
import type { CompiledOutputPackage } from "../_shared/output_compiler.ts";
import type { MaatDestinationResolution } from "../_shared/maat_destination_resolver.ts";

export const REFLECTION_GENERATION_MANIFEST_V2 =
  "reflection_generation_manifest_v2" as const;

type JsonRecord = Record<string, unknown>;

export type ReflectionGenerationManifestV2Storage = {
  sourceSnapshot: {
    decan_reflection_id: string | null;
  };
  metadata: {
    manifest: {
      version: typeof REFLECTION_GENERATION_MANIFEST_V2;
      render: JsonRecord;
      graph: JsonRecord;
      truth: JsonRecord;
    };
  };
};

export type ReflectionGenerationManifestV2Input = {
  reflectionId: string | null;
  leadAxis: string | null;
  plan: ControlledGeneratedTextPlan;
  grade: ControlledOutputGrade;
  repair: JsonRecord | null;
  renderer: JsonRecord;
  destination: MaatDestinationResolution;
  compiledOutputPackage: CompiledOutputPackage;
};

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function nullableRecord(value: unknown): JsonRecord | null {
  const candidate = record(value);
  return Object.keys(candidate).length > 0 ? candidate : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactDestination(
  destination: MaatDestinationResolution,
): JsonRecord {
  const compact: JsonRecord = {
    type: destination.destinationType,
    ref: destination.destinationRef,
    label: destination.destinationLabel,
  };
  if (
    destination.fallback &&
    destination.fallback.ctaType !== "none" &&
    destination.fallback.ctaRef
  ) {
    compact.fallback = {
      type: destination.fallback.ctaType,
      ref: destination.fallback.ctaRef,
      label: destination.fallback.ctaLabel,
    };
  }
  return compact;
}

function canonicalNode(compiledOutputPackage: CompiledOutputPackage) {
  const outputPackage = record(compiledOutputPackage);
  const nestedCanonicalNode = record(outputPackage.canonical_node);
  return {
    node_ref: stringValue(
      nestedCanonicalNode.node_ref ?? outputPackage.node_ref,
    ),
    node_title: stringValue(
      nestedCanonicalNode.node_title ?? outputPackage.node_title,
    ),
  };
}

export function buildReflectionGenerationManifestV2Storage(
  input: ReflectionGenerationManifestV2Input,
): ReflectionGenerationManifestV2Storage {
  const deterministicResponse = record(input.renderer.deterministic_response);
  const selectedSeed = record(
    deterministicResponse.selectedSeed ?? deterministicResponse.selected_seed,
  );
  const repair = record(input.repair);

  return {
    sourceSnapshot: {
      decan_reflection_id: input.reflectionId,
    },
    metadata: {
      manifest: {
        version: REFLECTION_GENERATION_MANIFEST_V2,
        render: {
          renderer: stringValue(input.renderer.renderer),
          used_llm: booleanValue(input.renderer.used_llm),
          llm_cost: numberValue(input.renderer.llm_cost),
          spectrum_flow_key: stringValue(input.renderer.spectrum_flow_key),
          response_kind: stringValue(
            input.renderer.response_kind ??
              deterministicResponse.responseKind ??
              deterministicResponse.response_kind,
          ),
          selected_tier: stringValue(
            input.renderer.selected_tier ?? selectedSeed.tier,
          ),
          selected_seed: stringValue(
            input.renderer.selected_seed ?? selectedSeed.seed,
          ),
          badge_title: stringValue(
            input.renderer.badge_title ?? deterministicResponse.badgeTitle ??
              deterministicResponse.badge_title,
          ),
          badge_body: stringValue(
            input.renderer.badge_body ?? deterministicResponse.badgeBody ??
              deterministicResponse.badge_body,
          ),
          detail_body: stringValue(
            input.renderer.detail_body ?? deterministicResponse.detailBody ??
              deterministicResponse.detail_body ?? deterministicResponse.body,
          ),
          central_tension: stringValue(
            input.renderer.central_tension ??
              deterministicResponse.centralTension ??
              deterministicResponse.central_tension,
          ),
          anthropic_attempted: booleanValue(
            input.renderer.anthropic_attempted,
          ),
        },
        graph: {
          lead_axis: input.leadAxis,
          destination: compactDestination(input.destination),
          canonical_node: canonicalNode(input.compiledOutputPackage),
        },
        truth: {
          surface: input.plan.kind,
          speech_act: input.plan.speechAct,
          delivery_channel: input.grade.deliveryRecommendation,
          grade: {
            pass: input.grade.pass,
            guidance_worthiness_score: input.grade.guidanceWorthinessScore,
            delivery_recommendation: input.grade.deliveryRecommendation,
            repair_mode: input.grade.repairMode,
            failure_reasons: input.grade.failureReasons,
            action_clarity_score: input.grade.actionClarityScore,
          },
          repair: {
            attempted: booleanValue(repair.attempted) ?? false,
            applied: booleanValue(repair.applied) ?? false,
            mode: stringValue(repair.repair_mode) ?? input.grade.repairMode,
            reason: stringValue(repair.repair_reason) ??
              input.grade.failureReasons[0] ?? null,
            grade_delta: nullableRecord(repair.grade_delta),
            pre_repair_text: stringValue(repair.pre_repair_text),
            post_repair_text: stringValue(repair.post_repair_text),
          },
        },
      },
    },
  };
}
