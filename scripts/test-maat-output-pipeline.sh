#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

deno check \
  supabase/functions/admin_content_preview/index.ts \
  supabase/functions/admin_content_preview/admin_content_preview_test.ts \
  supabase/functions/_shared/maat_guidance.ts \
  supabase/functions/_shared/maat_guidance_test.ts \
  supabase/functions/_shared/maat_flow_response_renderer.ts \
  supabase/functions/_shared/maat_flow_response_renderer_test.ts \
  supabase/functions/_shared/maat_flow_response_spectrum.ts \
  supabase/functions/_shared/maat_flow_response_spectrum_test.ts \
  supabase/functions/_shared/output_control.ts \
  supabase/functions/_shared/output_control_test.ts \
  supabase/functions/_shared/output_compiler.ts \
  supabase/functions/_shared/output_compiler_test.ts \
  supabase/functions/_shared/maat_situation_interpreter.ts \
  supabase/functions/_shared/maat_situation_interpreter_test.ts \
  supabase/functions/ai_generate_reflection/index.ts

deno test --allow-env \
  supabase/functions/admin_content_preview/admin_content_preview_test.ts \
  supabase/functions/_shared/maat_guidance_test.ts \
  supabase/functions/_shared/maat_flow_response_renderer_test.ts \
  supabase/functions/_shared/maat_flow_response_spectrum_test.ts \
  supabase/functions/_shared/output_control_test.ts \
  supabase/functions/_shared/output_compiler_test.ts \
  supabase/functions/_shared/maat_situation_interpreter_test.ts \
  supabase/functions/ai_generate_reflection/maat_decision_test.ts

npm --prefix admin run build

if [[ "${FULL:-0}" == "1" ]]; then
  deno test --allow-env --allow-read supabase/functions/
fi
