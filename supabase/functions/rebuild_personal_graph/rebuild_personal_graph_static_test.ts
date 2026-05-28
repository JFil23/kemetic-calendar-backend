// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  MAAT_FLOW_COMPLETION_SOURCE_TABLE,
  MAAT_FLOW_COMPLETION_STATUS_WEIGHTS,
  MAAT_FLOW_NODE_WEIGHTS,
  MAAT_FLOW_SKIPPED_COMPLETION_NODE_WEIGHTS,
} from "./index.ts";

Deno.test("rebuild_personal_graph consumes Ma'at flow completion statuses", async () => {
  assertEquals(MAAT_FLOW_COMPLETION_SOURCE_TABLE, "user_event_completions");
  [
    "dawn-house-rite",
    "evening-threshold-rite",
    "track-the-sky",
    "the-weighing",
    "the-offering-table",
    "the-tending",
    "the-kept-word",
    "the-course",
    "the-moon-return",
    "the-wag",
    "the-decan-watch",
    "the-days-outside-the-year",
    "the-open-hand",
    "the-djed",
  ].forEach((flowKey) => {
    assertEquals(flowKey in MAAT_FLOW_NODE_WEIGHTS, true);
  });
  ["observed_from_inside", "names_spoken", "raised", "conversation_pending"]
    .forEach((status) => {
      assertEquals(status in MAAT_FLOW_COMPLETION_STATUS_WEIGHTS, true);
    });
  assertEquals(MAAT_FLOW_SKIPPED_COMPLETION_NODE_WEIGHTS.isfet, 0.9);
});

Deno.test("rebuild_personal_graph does not score raw Moon Return event backlog as skipped", async () => {
  assertEquals(MAAT_FLOW_COMPLETION_SOURCE_TABLE, "user_event_completions");
  assertEquals("the-moon-return" in MAAT_FLOW_NODE_WEIGHTS, true);
  assertEquals(MAAT_FLOW_SKIPPED_COMPLETION_NODE_WEIGHTS.maat, 0.35);
  assertEquals(MAAT_FLOW_SKIPPED_COMPLETION_NODE_WEIGHTS.isfet, 0.9);
});
