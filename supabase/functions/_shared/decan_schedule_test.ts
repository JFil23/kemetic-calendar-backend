// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeWindowSendAt } from "./decan_schedule.ts";

Deno.test("decan reflection due time is Day 10 at 18:00 Los Angeles", () => {
  assertEquals(
    computeWindowSendAt("2026-10-05", "America/Los_Angeles"),
    "2026-10-06T01:00:00.000Z",
  );
});

Deno.test("decan reflection due time is Day 10 at 18:00 New York", () => {
  assertEquals(
    computeWindowSendAt("2026-10-05", "America/New_York"),
    "2026-10-05T22:00:00.000Z",
  );
});

Deno.test("decan reflection due time is Day 10 at 18:00 Chicago", () => {
  assertEquals(
    computeWindowSendAt("2026-10-05", "America/Chicago"),
    "2026-10-05T23:00:00.000Z",
  );
});

Deno.test("decan reflection due time preserves local 18:00 across DST", () => {
  assertEquals(
    computeWindowSendAt("2026-03-08", "America/Los_Angeles"),
    "2026-03-09T01:00:00.000Z",
  );
  assertEquals(
    computeWindowSendAt("2026-11-01", "America/Los_Angeles"),
    "2026-11-02T02:00:00.000Z",
  );
});
