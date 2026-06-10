import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  canonicalLibraryNodePayload,
  resolveCanonicalLibraryNode,
} from "./canonical_library_node.ts";

Deno.test("canonical library node prefers primary node destination", () => {
  const node = resolveCanonicalLibraryNode({
    destination: {
      type: "node",
      ref: "thoth",
      fallback: { ctaType: "node", ctaRef: "maat" },
    },
    payload: { node_ref: "renenutet" },
    anchorNodes: ["ptah"],
    leadAxis: "S",
  });

  assertEquals(node?.node_ref, "djehuty");
  assertEquals(node?.node_deep_link, "/nodes/djehuty");
  assertEquals(node?.node_title, "Djehuty");
  assertEquals(node?.node_source, "destination.primary");
});

Deno.test("canonical library node falls back through destination, payload, anchors, then lead axis", () => {
  assertEquals(
    resolveCanonicalLibraryNode({
      destination: {
        type: "flow_template",
        ref: "the-tending",
        fallback: { ctaType: "node", ctaRef: "instruction_amenemope" },
      },
      payload: { node_ref: "maat" },
      anchorNodes: ["renenutet"],
      leadAxis: "M",
    })?.node_source,
    "destination.fallback",
  );

  assertEquals(
    resolveCanonicalLibraryNode({
      destination: { type: "flow_template", ref: "the-tending" },
      payload: { node_ref: "maat" },
      anchorNodes: ["renenutet"],
      leadAxis: "M",
    })?.node_source,
    "payload.node_ref",
  );

  assertEquals(
    resolveCanonicalLibraryNode({
      destination: { type: "flow_template", ref: "the-tending" },
      anchorNodes: ["isfet", "renenutet"],
      leadAxis: "M",
    })?.node_source,
    "graph.anchor",
  );

  assertEquals(
    resolveCanonicalLibraryNode({
      destination: { type: "flow_template", ref: "the-tending" },
      anchorNodes: ["not_a_library_node"],
      leadAxis: "M",
    })?.node_ref,
    "djehuty",
  );
});

Deno.test("canonical library node payload keeps stable keys when unresolved", () => {
  assertEquals(canonicalLibraryNodePayload(null), {
    node_ref: null,
    node_deep_link: null,
    node_title: null,
    node_source: null,
  });
});
