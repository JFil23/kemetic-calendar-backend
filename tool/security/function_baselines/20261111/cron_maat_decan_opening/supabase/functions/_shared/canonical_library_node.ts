export type CanonicalLibraryNodeSource =
  | "destination.primary"
  | "destination.fallback"
  | "payload.node_ref"
  | "graph.anchor"
  | "lead_axis";

export type CanonicalLibraryNode = {
  node_ref: string;
  node_deep_link: string;
  node_title: string;
  node_source: CanonicalLibraryNodeSource;
};

type ResolveCanonicalLibraryNodeParams = {
  destination?: unknown;
  payload?: Record<string, unknown> | null;
  anchorNodes?: unknown;
  leadAxis?: unknown;
};

const LIBRARY_NODE_TITLES: Record<string, string> = {
  cosmic_order: "Cosmic Order",
  human_emergence: "Human Emergence",
  ancient_african_tree: "Ancient African Tree",
  green_sahara: "Green Sahara",
  rise_of_kush_and_kemet: "Rise of Kush and Kemet",
  serpent: "Serpent",
  hawk: "Hawk (Heru)",
  jackal: "Jackal (Anpu)",
  nile: "Nile (Hapy)",
  ptah: "Ptah",
  djehuty: "Djehuty",
  shu: "Shu",
  maat: "Ma'at",
  declarations_of_innocence: "Declarations of Innocence",
  ausar: "Ausar",
  aset: "Aset",
  heru: "Heru",
  ra: "Ra",
  ka: "Ka",
  ba: "Ba",
  akh: "Akh",
  ren: "Ren (Name)",
  ib: "Ib (Heart)",
  sheut: "Sheut (Shadow)",
  imhotep: "Imhotep",
  sopdet: "Sopdet (Sirius)",
  coffin_texts: "Coffin Texts",
  papyrus_chester_beatty_iv: "Papyrus Chester Beatty IV",
  kemet: "Kemet (Black Land)",
  pyramid_texts: "Pyramid Texts",
  hathor: "Hathor",
  dendera: "Dendera",
  sah: "Sah (Orion)",
  abydos: "Abydos",
  decans: "Decans",
  duat: "Duat",
  renenutet: "Renenutet",
  haw: "Haw",
  house_of_life: "House of Life",
  instruction_ptahhotep: "Instruction of Ptahhotep",
  sekhmet: "Sekhmet",
  rekh_wer: "Rekh-Wer",
  set: "Set",
  esna_temple: "Esna Temple",
  shai: "Shai",
  offering_formula: "Offering Formula",
  shemu: "Shemu",
  amduat: "Amduat",
  khepri: "Khepri",
  hotep: "Hotep",
  instruction_amenemope: "Instruction of Amenemope",
  eye_of_ra: "Eye of Ra",
  tomb_inscriptions: "Tomb Inscriptions",
  middle_kingdom_funerary: "Middle Kingdom Funerary Tradition",
  nut: "Nut",
  horizon: "Akhet",
  natron: "Natron",
  nebet_het: "Nebet-Het",
  khnum: "Khnum",
  memphite_theology: "Memphite Theology",
  book_of_the_dead: "Book of Coming Forth by Day",
  palermo_stone: "Palermo Stone",
  wadi_el_jarf_papyri: "Wadi el-Jarf Papyri",
  false_door: "False Door",
  architrave: "Architrave",
  wp_rnpt: "Wp Rnpt",
  akhet: "Akhet Season",
  peret: "Peret",
  epagomenal_days: "Epagomenal Days",
  regnal_year: "Regnal Year",
};

const LIBRARY_NODE_ALIASES: Record<string, string> = {
  amenemope: "instruction_amenemope",
  anpu: "jackal",
  anubis: "jackal",
  asar: "ausar",
  horus: "heru",
  hapy: "nile",
  isis: "aset",
  osiris: "ausar",
  thoth: "djehuty",
  wep_renpet: "wp_rnpt",
};

const LEAD_AXIS_NODE_CANDIDATES: Record<string, string[]> = {
  T: ["maat", "djehuty"],
  M: ["djehuty", "maat"],
  H: ["ka", "sekhmet"],
  V: ["instruction_amenemope", "renenutet"],
  J: ["maat", "instruction_amenemope"],
  S: ["renenutet", "nile"],
  E: ["nile", "renenutet"],
  R: ["instruction_amenemope", "sekhmet"],
  C: ["ptah", "maat"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(record[key]);
    if (value) return value;
  }
  return "";
}

function normalizedNodeRef(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";
  const slug = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return LIBRARY_NODE_ALIASES[slug] ?? slug;
}

function isNodeDestinationType(value: unknown) {
  switch (cleanText(value).toLowerCase()) {
    case "node":
    case "library_node":
    case "node_library":
      return true;
    default:
      return false;
  }
}

function canonicalFromRef(
  ref: unknown,
  source: CanonicalLibraryNodeSource,
): CanonicalLibraryNode | null {
  const nodeRef = normalizedNodeRef(ref);
  if (!nodeRef || nodeRef === "isfet") return null;
  const title = LIBRARY_NODE_TITLES[nodeRef];
  if (!title) return null;
  return {
    node_ref: nodeRef,
    node_deep_link: `/nodes/${encodeURIComponent(nodeRef)}`,
    node_title: title,
    node_source: source,
  };
}

function destinationPrimaryNode(destination: Record<string, unknown>) {
  const type = readText(destination, [
    "type",
    "destinationType",
    "destination_type",
    "ctaType",
    "cta_type",
  ]);
  if (!isNodeDestinationType(type)) return null;
  return canonicalFromRef(
    readText(destination, [
      "ref",
      "destinationRef",
      "destination_ref",
      "ctaRef",
      "cta_ref",
    ]),
    "destination.primary",
  );
}

function destinationFallbackNode(destination: Record<string, unknown>) {
  const fallback = isRecord(destination.fallback) ? destination.fallback : null;
  if (!fallback) return null;
  const type = readText(fallback, [
    "type",
    "ctaType",
    "cta_type",
    "destinationType",
    "destination_type",
  ]);
  if (!isNodeDestinationType(type)) return null;
  return canonicalFromRef(
    readText(fallback, [
      "ref",
      "ctaRef",
      "cta_ref",
      "destinationRef",
      "destination_ref",
    ]),
    "destination.fallback",
  );
}

function graphAnchorNode(anchorNodes: unknown) {
  if (!Array.isArray(anchorNodes)) return null;
  for (const anchor of anchorNodes) {
    const ref = isRecord(anchor)
      ? readText(anchor, ["slug", "ref", "id", "node_ref", "nodeRef"])
      : anchor;
    const node = canonicalFromRef(ref, "graph.anchor");
    if (node) return node;
  }
  return null;
}

function leadAxisNode(leadAxis: unknown) {
  const axis = cleanText(leadAxis).toUpperCase();
  for (const ref of LEAD_AXIS_NODE_CANDIDATES[axis] ?? []) {
    const node = canonicalFromRef(ref, "lead_axis");
    if (node) return node;
  }
  return null;
}

export function resolveCanonicalLibraryNode(
  params: ResolveCanonicalLibraryNodeParams,
): CanonicalLibraryNode | null {
  const destination = isRecord(params.destination) ? params.destination : null;
  if (destination) {
    const primaryNode = destinationPrimaryNode(destination);
    if (primaryNode) return primaryNode;
    const fallbackNode = destinationFallbackNode(destination);
    if (fallbackNode) return fallbackNode;
  }

  const payloadNode = canonicalFromRef(
    params.payload?.node_ref,
    "payload.node_ref",
  );
  if (payloadNode) return payloadNode;

  const anchorNode = graphAnchorNode(params.anchorNodes);
  if (anchorNode) return anchorNode;

  return leadAxisNode(params.leadAxis);
}

export function canonicalLibraryNodePayload(
  node: CanonicalLibraryNode | null,
) {
  return {
    node_ref: node?.node_ref ?? null,
    node_deep_link: node?.node_deep_link ?? null,
    node_title: node?.node_title ?? null,
    node_source: node?.node_source ?? null,
  };
}
