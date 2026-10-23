import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyWindow,
  createConcurrencyGate,
  dayGroups,
  DETAIL_CONCURRENCY,
  inWindow,
  runWithConcurrency,
  visiblePeople,
  type LedgerHistory,
} from "./ledger-model.ts";

const now = new Date("2026-10-10T18:00:00-07:00");

function person(
  id: string,
  name: string,
  joined: string,
  history: Array<[string, string]>,
): LedgerHistory {
  return {
    id,
    name,
    handle: name.toLowerCase().replace(/\s+/g, "."),
    email: `${id}@example.com`,
    joined,
    timezone: "America/Los_Angeles",
    history: history.map(([occurredAt, label], index) => ({
      id: `${id}-${index}`,
      occurredAt,
      label,
      detail: "",
      category: "App",
    })),
  };
}

describe("visiblePeople", () => {
  const people = [
    applyWindow(
      person("a", "Amara", "2026-09-01", [
        ["2026-10-10T10:00:00-07:00", "Opened ḥꜣw"],
      ]),
      30,
      now,
    ),
    applyWindow(person("b", "Ayo", "2026-10-07", []), 30, now),
    applyWindow(
      person("c", "Malik", "2026-09-28", [
        ["2026-10-01T10:00:00-07:00", "Opened ḥꜣw"],
      ]),
      30,
      now,
    ),
  ];

  it("filters active and quiet people", () => {
    assert.equal(
      visiblePeople(people, { query: "", filter: "active", sort: "recent" })
        .length,
      2,
    );
    assert.equal(
      visiblePeople(people, { query: "", filter: "quiet", sort: "recent" })[0]
        ?.id,
      "b",
    );
  });

  it("searches name email handle and id", () => {
    assert.equal(
      visiblePeople(people, {
        query: "malik",
        filter: "all",
        sort: "recent",
      })[0]?.id,
      "c",
    );
    assert.equal(
      visiblePeople(people, { query: "a@", filter: "all", sort: "recent" })[0]
        ?.id,
      "a",
    );
  });

  it("sorts inactive people last for recent", () => {
    const ids = visiblePeople(people, {
      query: "",
      filter: "all",
      sort: "recent",
    }).map((row) => row.id);
    assert.deepEqual(ids, ["a", "c", "b"]);
  });
});

describe("dayGroups", () => {
  it("groups newest day first", () => {
    const groups = dayGroups(
      [
        {
          id: "1",
          occurredAt: "2026-10-09T12:00:00-07:00",
          label: "Older",
          detail: "",
          category: "App",
        },
        {
          id: "2",
          occurredAt: "2026-10-10T12:00:00-07:00",
          label: "Newer",
          detail: "",
          category: "App",
        },
        {
          id: "3",
          occurredAt: "2026-10-10T08:00:00-07:00",
          label: "Morning",
          detail: "",
          category: "App",
        },
      ],
      "America/Los_Angeles",
    );
    assert.equal(groups[0]?.key, "2026-10-10");
    assert.equal(groups[0]?.events[0]?.label, "Newer");
    assert.equal(groups[1]?.key, "2026-10-09");
  });
});

describe("runWithConcurrency", () => {
  it("keeps at most four workers active", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, index) => index);
    await runWithConcurrency(
      items,
      DETAIL_CONCURRENCY,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      },
      () => true,
    );
    assert.ok(peak <= DETAIL_CONCURRENCY);
    assert.ok(peak >= 1);
  });
});


describe("ledger request and date boundaries", () => {
  it("shares four request slots across independently queued callers and cancels closed nodes", async () => {
    const gate = createConcurrencyGate(DETAIL_CONCURRENCY);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const run = async (id: number) => {
      if (!await gate.acquire(() => id !== 6)) return;
      active += 1;
      peak = Math.max(peak, active);
      started.push(id);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
      } finally {
        active -= 1;
        gate.release();
      }
    };
    await Promise.all(Array.from({ length: 12 }, (_, id) => run(id)));
    assert.equal(peak, 4);
    assert.equal(gate.active(), 0);
    assert.equal(started.length, 11);
    assert.ok(!started.includes(6));
  });

  it("groups UTC events on opposite sides of local midnight into different days", () => {
    const events = [
      { id: "before", occurredAt: "2026-10-10T06:59:00Z", label: "Before midnight", detail: "", category: "App" },
      { id: "after", occurredAt: "2026-10-10T07:01:00Z", label: "After midnight", detail: "", category: "App" },
    ];
    const groups = dayGroups(events, "America/Los_Angeles");
    assert.deepEqual(groups.map((group) => group.key), ["2026-10-10", "2026-10-09"]);
    assert.equal(groups[0].events[0].id, "after");
  });

  it("keeps exact 7, 30, and 90 day boundaries and excludes future events", () => {
    for (const days of [7, 30, 90]) {
      const boundary = now.getTime() - days * 86400000;
      assert.ok(inWindow(new Date(boundary).toISOString(), days, now));
      assert.ok(!inWindow(new Date(boundary - 1).toISOString(), days, now));
      assert.ok(!inWindow(new Date(now.getTime() + 1).toISOString(), days, now));
    }
  });
});
