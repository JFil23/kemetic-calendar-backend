# Real Usage Output Proof

Use this protocol for the 7-day output dogfood pass. Do not convert smoke rows
or synthetic rows into permanent eval cases.

## Daily Run

```bash
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
MAAT_OUTPUT_DOGFOOD_DAYS=7 \
MAAT_OUTPUT_DOGFOOD_LIMIT=200 \
MAAT_OUTPUT_DOGFOOD_ANNOTATIONS=supabase/dev/maat_output_dogfood_annotations.json \
MAAT_OUTPUT_DOGFOOD_OUTPUT_DIR=supabase/dev/dogfood_reports \
deno run --allow-env --allow-net --allow-read --allow-write \
  supabase/functions/_shared/maat_output_dogfood.ts
```

## Review Rule

Mark weak real outputs in the annotations file:

- `reviewSource: "real_usage"` for actual app usage only.
- `dominantFailure` for the main reason the output failed.
- `disposition: "eval_case"` when the failure should become a permanent case.
- `convertedEvalCaseId` only after the case is committed in
  `maat_output_eval_cases.ts`.

The weekly metric is `eval_draft_conversion_rate`: real reviewed failures with a
committed eval case divided by all real reviewed failures that should become
eval cases.

## Acceptance Target

- 25 or more real outputs reviewed.
- 10 or more real failure-derived eval cases committed.
- 0 invented-evidence failures.
- 0 shame-language failures.
- Archive-only routing confirmed on real low-worthiness outputs.
- High-worthiness fast dismisses reviewed.
- Repair deltas checked for cadence loss.
