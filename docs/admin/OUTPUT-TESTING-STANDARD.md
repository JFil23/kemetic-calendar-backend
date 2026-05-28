# Ma'at Output Testing Standard

This standard exists because passing unit tests is not enough for output quality. A test must prove the user-visible path, not only a helper contract.

## Required Gates

1. Renderer replacement
   - A nudge preview with `require_llm: true` must fail unless the LLM-rendered body replaces deterministic text.
   - The generated text must not equal the deterministic fallback formula.
   - The preview must include `push_preview.render_diagnostics.status = "llm"`.

2. Fail-loud fallback
   - Missing key, Anthropic error, empty text, validation failure, or disabled renderer must return a non-200 response when `require_llm: true`.
   - The response must include `diagnostics.renderer.fallback_reason`.
   - Admin must not silently show fallback prose as if it were a successful render.

3. Validation fallback
   - If the LLM returns dignity violations, banned phrases, or embedded CTA text, the preview must fail in `require_llm` mode.
   - The validation errors must be preserved in diagnostics.

4. Reflection renderer proof
   - A reflection preview with `require_llm: true` must fail unless reflection diagnostics show `renderer = "anthropic"` and no fallback reason.
   - `local-generator-v2` is allowed only when not requiring LLM, and it must be visibly marked as fallback.

5. Admin visibility
   - The admin UI must surface renderer status, fallback reason, case key, selected offering, example id, diagnosis, and concrete action.
   - A screenshot of a preview without visible renderer diagnostics is not considered a valid test artifact.

6. Output quality gates
   - Situation interpreter tests prove correct case/offering selection.
   - Output-control tests prove schema, dignity, grounding, and banned phrase checks.
   - Admin preview tests prove the actual preview path honors those contracts.

## Minimum Local Command

Run:

```bash
bash scripts/test-maat-output-pipeline.sh
```

This is the minimum gate before trusting an admin preview change.

## Live Manual Gate

After deploy:

1. Open Content Lab.
2. Leave `Require LLM render` enabled.
3. Generate a nudge and reflection.
4. If either preview succeeds, the diagnostics panel must show `status: llm`.
5. If either preview fails, the notice must include the concrete fallback reason.
6. Do not evaluate copy quality from a fallback render.

The rule is simple: fallback output can be useful for uptime, but it is not proof of the Ma'at language system.
