import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildCompiledOutputPackage,
  buildOutputCompilerTrace,
  compilerStatusFromRenderer,
  resolveCompiledPackagePushText,
} from "./output_compiler.ts";

Deno.test("compiler status treats Anthropic without fallback reason as compiled", () => {
  assertEquals(
    compilerStatusFromRenderer({
      renderer: "anthropic",
      fallbackReason: null,
    }),
    "compiled",
  );
  assertEquals(
    compilerStatusFromRenderer({
      renderer: "anthropic",
      fallbackReason: "llm_validation_failed",
    }),
    "fallback",
  );
  assertEquals(
    compilerStatusFromRenderer({
      renderer: "local-generator-v2",
      fallbackReason: null,
    }),
    "fallback",
  );
});

Deno.test("compiled output package preserves fallback archive-only discipline", () => {
  const compiler = buildOutputCompilerTrace({
    surface: "nudge",
    renderer: "deterministic",
    modelVersion: "deterministic",
    fallbackReason: "missing_anthropic_key",
    caseKey: "provision.single_open_check",
    offering: "commit_today",
    finalText: "One support mark remains open.",
    teaserText: "One support mark remains open.",
    pushText: "One support mark remains open.",
  });
  const outputPackage = buildCompiledOutputPackage({
    surface: "nudge",
    finalText: compiler.final_text,
    teaserText: compiler.teaser_text,
    pushText: compiler.push_text,
    ctaType: "flow_template",
    ctaRef: "the-offering-table",
    compiler,
  });

  assertEquals(outputPackage.compiler.status, "fallback");
  assertEquals(outputPackage.fallback_used, true);
  assertEquals(outputPackage.not_quality_proof, true);
  assertEquals(outputPackage.delivery_recommendation, "archive_only");
  assertEquals(outputPackage.cta_type, null);
  assertEquals(outputPackage.cta_ref, null);
  assertEquals(outputPackage.cta, null);
  assertEquals(outputPackage.destination, null);
});

Deno.test("compiled output package stores model, trace, and hidden prompt presence", () => {
  const compiler = buildOutputCompilerTrace({
    surface: "reflection",
    renderer: "anthropic",
    modelVersion: "claude-reflection",
    caseKey: "provision.overloaded_schedule",
    offering: "prune",
    exampleIds: ["provision_overloaded_prune"],
    finalText: "The list grew larger than the practice could keep.",
    systemPrompt: "System prompt",
    userPrompt: "User prompt with evidence",
    validation: { ok: true },
    grade: { pass: true },
  });

  assertEquals(compiler.status, "compiled");
  assertEquals(compiler.fallback_used, false);
  assertEquals(compiler.example_id, "provision_overloaded_prune");
  assertEquals(compiler.prompt_trace.system_prompt_present, true);
  assertEquals(compiler.prompt_trace.user_prompt_present, true);
  assertEquals(compiler.prompt_trace.prompt_text_included, false);
});

Deno.test("compiled output package stores full active destination contract", () => {
  const compiler = buildOutputCompilerTrace({
    surface: "reflection",
    renderer: "anthropic",
    modelVersion: "claude-reflection",
    status: "compiled",
    finalText: "Hathor calls for care returned inward.",
  });

  const outputPackage = buildCompiledOutputPackage({
    surface: "reflection",
    finalText: compiler.final_text,
    ctaType: "flow_template",
    ctaRef: "the-tending",
    ctaLabel: "Open suggested flow",
    ctaReason: "reflection_judgment:reciprocity",
    ctaSource: "reflection_judgment",
    destination: {
      type: "flow_template",
      ref: "the-tending",
      label: "Open suggested flow",
      reason: "reflection_judgment:reciprocity",
      source: "reflection_judgment",
      confidence: 0.9,
      fallback: {
        ctaType: "node",
        ctaRef: "instruction_amenemope",
        ctaLabel: "Read the guiding node",
      },
    },
    compiler,
  });

  assertEquals(outputPackage.cta_type, "flow_template");
  assertEquals(outputPackage.cta_ref, "the-tending");
  assertEquals(outputPackage.cta?.source, "reflection_judgment");
  assertEquals(
    outputPackage.destination?.reason,
    "reflection_judgment:reciprocity",
  );
  assertEquals(
    outputPackage.destination?.fallback?.ctaRef,
    "instruction_amenemope",
  );
});

Deno.test("compiled package push text beats legacy push, teaser, and body fields", () => {
  const result = resolveCompiledPackagePushText({
    payload: {
      compiled_output_package: {
        package_version: "compiled_output_package_v1",
        push_text: "Compiled push text.",
        final_text: "Compiled final text.",
        fallback_used: false,
        not_quality_proof: false,
        delivery_recommendation: "push",
      },
    },
    legacyPushText: "Legacy push text.",
    legacyTeaserText: "Legacy teaser.",
    legacyBodyText: "Legacy body.",
  });

  assertEquals(result.text, "Compiled push text.");
  assertEquals(result.source, "compiled_package.push_text");
  assertEquals(result.blocked, false);
});

Deno.test("compiled package without push text blocks quality-controlled push derivation", () => {
  const result = resolveCompiledPackagePushText({
    payload: {
      compiled_output_package: {
        package_version: "compiled_output_package_v1",
        final_text: "Compiled final text.",
        fallback_used: false,
        not_quality_proof: false,
      },
    },
    legacyTeaserText: "Legacy teaser.",
    legacyBodyText: "Legacy body.",
  });

  assertEquals(result.text, null);
  assertEquals(result.source, "compiled_package_missing_push_text");
  assertEquals(result.blocked, true);
  assertEquals(result.reason, "compiled_package_missing_push_text");
});

Deno.test("fallback compiled package blocks push even when legacy text exists", () => {
  const result = resolveCompiledPackagePushText({
    payload: {
      compiled_output_package: {
        package_version: "compiled_output_package_v1",
        push_text: "Fallback push text.",
        final_text: "Fallback final text.",
        fallback_used: true,
        not_quality_proof: true,
        delivery_recommendation: "archive_only",
      },
    },
    legacyPushText: "Legacy push text.",
  });

  assertEquals(result.text, null);
  assertEquals(result.source, "blocked_fallback");
  assertEquals(result.blocked, true);
  assertEquals(result.reason, "compiled_package_not_quality_proof");
});

Deno.test("legacy push fallback remains available when no compiled package exists", () => {
  const teaser = resolveCompiledPackagePushText({
    legacyTeaserText: "Legacy teaser text.",
    legacyBodyText: "Legacy body text that should not be needed.",
  });
  assertEquals(teaser.text, "Legacy teaser text.");
  assertEquals(teaser.source, "legacy_teaser_text");

  const body = resolveCompiledPackagePushText({
    legacyBodyText:
      "Legacy body text can still produce a short excerpt for non-compiler notifications.",
    maxLegacyExcerptChars: 30,
  });
  assertEquals(body.text, "Legacy body text can still pro...");
  assertEquals(body.source, "legacy_body_excerpt");
});
