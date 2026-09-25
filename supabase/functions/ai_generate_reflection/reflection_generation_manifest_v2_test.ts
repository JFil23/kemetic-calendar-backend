import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildReflectionGenerationManifestV2Storage,
  REFLECTION_GENERATION_MANIFEST_V2,
  type ReflectionGenerationManifestV2Input,
} from "./reflection_generation_manifest_v2.ts";

const plan = {
  kind: "decan_reflection",
  speechAct: "witness",
} as ReflectionGenerationManifestV2Input["plan"];

const grade = {
  pass: true,
  guidanceWorthinessScore: 4.8,
  deliveryRecommendation: "archive_only",
  repairMode: "cadence_repair",
  failureReasons: ["ceremonial_cadence_below_threshold"],
  actionClarityScore: 5,
} as ReflectionGenerationManifestV2Input["grade"];

const renderer = {
  renderer: "deterministic_spectrum",
  used_llm: false,
  llm_cost: 0,
  spectrum_flow_key: "the-weighing",
  anthropic_attempted: false,
  deterministic_response: {
    responseKind: "reflection",
    selectedSeed: {
      tier: "observed",
      seed: "The record was brought to the scale.",
    },
    badgeTitle: "The balance held",
    badgeBody: "The record was brought to the scale.",
    detailBody: "The record names one clear return.",
    centralTension: "Measure and movement",
  },
};

const destination = {
  destinationType: "flow_template",
  destinationRef: "the-tending",
  destinationLabel: "Open suggested flow",
  fallback: {
    ctaType: "node",
    ctaRef: "instruction_amenemope",
    ctaLabel: "Read the guiding node",
  },
} as ReflectionGenerationManifestV2Input["destination"];

const compiledOutputPackage = {
  node_ref: "maat",
  node_title: "Ma’at",
} as unknown as ReflectionGenerationManifestV2Input["compiledOutputPackage"];

const repair = {
  attempted: true,
  applied: true,
  repair_mode: "cadence_repair",
  repair_reason: "ceremonial_cadence_below_threshold",
  grade_delta: { ceremonial_cadence_score: 1 },
  pre_repair_text: "Before repair.",
  post_repair_text: "The record names one clear return.",
};

function buildV2(
  overrides: Partial<ReflectionGenerationManifestV2Input> = {},
) {
  return buildReflectionGenerationManifestV2Storage({
    reflectionId: "reflection-paired-fixture",
    leadAxis: "truth",
    plan,
    grade,
    repair,
    renderer,
    destination,
    compiledOutputPackage,
    ...overrides,
  });
}

Deno.test("ordinary decan writer emits the exact Manifest v2 reader shape", () => {
  const storage = buildV2();
  const manifest = storage.metadata.manifest;

  assertEquals(storage.sourceSnapshot, {
    decan_reflection_id: "reflection-paired-fixture",
  });
  assertEquals(Object.keys(storage.metadata), ["manifest"]);
  assertEquals(manifest.version, REFLECTION_GENERATION_MANIFEST_V2);
  assertEquals(manifest.render, {
    renderer: "deterministic_spectrum",
    used_llm: false,
    llm_cost: 0,
    spectrum_flow_key: "the-weighing",
    response_kind: "reflection",
    selected_tier: "observed",
    selected_seed: "The record was brought to the scale.",
    badge_title: "The balance held",
    badge_body: "The record was brought to the scale.",
    detail_body: "The record names one clear return.",
    central_tension: "Measure and movement",
    anthropic_attempted: false,
  });
  assertEquals(manifest.graph, {
    lead_axis: "truth",
    destination: {
      type: "flow_template",
      ref: "the-tending",
      label: "Open suggested flow",
      fallback: {
        type: "node",
        ref: "instruction_amenemope",
        label: "Read the guiding node",
      },
    },
    canonical_node: {
      node_ref: "maat",
      node_title: "Ma’at",
    },
  });
});

Deno.test("Manifest v2 truth is equivalent to the paired v1 projection", () => {
  const truth = buildV2().metadata.manifest.truth as Record<string, unknown>;
  const v1Projection = {
    surface: plan.kind,
    speech_act: plan.speechAct,
    delivery_channel: grade.deliveryRecommendation,
    grade: {
      pass: grade.pass,
      guidance_worthiness_score: grade.guidanceWorthinessScore,
      delivery_recommendation: grade.deliveryRecommendation,
      repair_mode: grade.repairMode,
      failure_reasons: grade.failureReasons,
      action_clarity_score: grade.actionClarityScore,
    },
    repair: {
      attempted: repair.attempted,
      applied: repair.applied,
      mode: repair.repair_mode,
      reason: repair.repair_reason,
      grade_delta: repair.grade_delta,
      pre_repair_text: repair.pre_repair_text,
      post_repair_text: repair.post_repair_text,
    },
  };

  assertEquals(truth, v1Projection);
});

Deno.test("Manifest v2 keeps no-repair truth semantics without bulky trees", () => {
  const storage = buildV2({ repair: null });
  const manifest = storage.metadata.manifest;
  const serialized = JSON.stringify(storage);

  assert(!serialized.includes("output_control"));
  assert(!serialized.includes("shaping_fingerprint"));
  assertEquals(manifest.truth.repair, {
    attempted: false,
    applied: false,
    mode: "cadence_repair",
    reason: "ceremonial_cadence_below_threshold",
    grade_delta: null,
    pre_repair_text: null,
    post_repair_text: null,
  });
});

Deno.test("Manifest v2 preserves compact destination and null canonical-node semantics", () => {
  const storage = buildV2({
    destination: {
      ...destination,
      destinationType: "none",
      destinationRef: null,
      destinationLabel: null,
      fallback: null,
    },
    compiledOutputPackage: {} as ReflectionGenerationManifestV2Input[
      "compiledOutputPackage"
    ],
  });

  assertEquals(storage.metadata.manifest.graph.destination, {
    type: "none",
    ref: null,
    label: null,
  });
  assertEquals(storage.metadata.manifest.graph.canonical_node, {
    node_ref: null,
    node_title: null,
  });
});

Deno.test("Manifest v2 is materially smaller than the paired v1 persistence", () => {
  const outputControl = {
    policy_version: "maat_output_control_v1",
    plan: {
      ...plan,
      evidenceAnchors: Array.from({ length: 8 }, (_, index) => ({
        id: `evidence-${index}`,
        text: "A representative evidence phrase retained by legacy v1.",
      })),
      rhetoricalMoves: Array.from(
        { length: 12 },
        (_, index) => `legacy-rhetorical-move-${index}`,
      ),
    },
    validation: { ok: true, errors: [], warnings: [] },
    grade,
    repair,
    renderer,
    compiled_output_package: compiledOutputPackage,
  };
  const v1SourceSnapshot = {
    decan_name: "Representative decan",
    decan_theme: "Measure and return",
    decan_reflection_id: "reflection-paired-fixture",
    memory_brief: {
      evidence_phrases: Array.from(
        { length: 8 },
        () => "A representative memory phrase duplicated in v1.",
      ),
    },
    output_control: outputControl,
  };
  const v1Metadata = {
    policy_version: "decan_maat_dm_v1",
    decision_matrix: {
      anchor_nodes: ["maat", "instruction_amenemope"],
    },
    output_control: outputControl,
  };
  const v2 = buildV2();
  const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const sizes = {
    v1_source_snapshot: bytes(v1SourceSnapshot),
    v2_source_snapshot: bytes(v2.sourceSnapshot),
    v1_metadata: bytes(v1Metadata),
    v2_metadata: bytes(v2.metadata),
    v1_combined: bytes(v1SourceSnapshot) + bytes(v1Metadata),
    v2_combined: bytes(v2.sourceSnapshot) + bytes(v2.metadata),
  };
  const reductionPercent = Math.round(
    (1 - sizes.v2_combined / sizes.v1_combined) * 10_000,
  ) / 100;

  console.log(JSON.stringify({ sizes, reduction_percent: reductionPercent }));
  assert(sizes.v2_source_snapshot < sizes.v1_source_snapshot);
  assert(sizes.v2_metadata < sizes.v1_metadata);
  assert(sizes.v2_combined < sizes.v1_combined);
});
