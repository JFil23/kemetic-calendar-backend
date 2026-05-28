// Edge Function: admin_agent_run
// Ops agent pipeline. Phase 4 enables Research and Copy; remaining agents stay echo-only.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

import {
  type AdminContext,
  clampText,
  corsHeaders,
  createServiceClient,
  type HandlerDeps,
  hasScope,
  insertRow,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  selectRows,
  serializeError,
  serverNotConfiguredResponse,
  updateRow,
  writeAudit,
} from "../_shared/admin.ts";

type LlmRequest = {
  agentSlug:
    | "research"
    | "copy"
    | "social"
    | "suggest_updates"
    | "product_qa"
    | "chief_operator";
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
};

type LlmResponse = {
  provider: string;
  modelUsed: string;
  content: string;
  tokensIn: number;
  tokensOut: number;
};

type LlmProvider = (request: LlmRequest) => Promise<LlmResponse>;

type AgentRunDeps = HandlerDeps & {
  llm?: LlmProvider;
  rpcClient?: (token: string) => HandlerDeps["client"];
  warRoomSummary?: (
    days: number,
    context: AdminContext,
  ) => Promise<Record<string, unknown>>;
};

type AgentDefinition = {
  slug: string;
  name: string;
  status: "inactive" | "manual" | "scheduled" | "disabled";
  default_model: string;
  required_scopes: string[] | null;
  risk_level: "low" | "medium" | "high" | "restricted";
};

type ArmoryPlaybook = {
  slug: string;
  agent_slug?: string | null;
  system_prompt_md: string;
  is_active: boolean;
};

type BudgetRow = {
  scope: "global" | "agent_slug";
  agent_slug?: string | null;
  period: "daily" | "weekly" | "monthly";
  limit_usd: number | string;
  is_active: boolean;
};

type LedgerRow = {
  agent_slug?: string | null;
  cost_usd: number | string;
  created_at: string;
};

type JobRow = {
  id: string;
  agent_slug: string;
  status: string;
  created_at: string;
};

type RunRow = {
  id: string;
  job_id: string;
  agent_slug: string;
  status: string;
  model: string;
  input: Record<string, unknown>;
  output_summary?: string | null;
  archive_entry_id?: string | null;
  created_at: string;
  completed_at?: string | null;
  duration_ms?: number | null;
};

type ArchiveEntry = {
  id: string;
  namespace: string;
  title: string;
  content_md: string;
  created_at: string;
};

type OutputRow = {
  id: string;
  run_id: string;
  output_type: string;
  archive_entry_id?: string | null;
};

type SuggestionRow = {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
};

type CodexTaskRow = {
  id: string;
  title: string;
  status: string;
  spec_md: string;
  prompt_md?: string | null;
  created_at: string;
};

type ApprovalRow = {
  id: string;
  kind: string;
  status: string;
  risk_level: string;
  summary: string;
  created_at: string;
};

type TreasuryLedgerRow = {
  agent_slug?: string | null;
  cost_usd: number | string;
  created_at: string;
};

const AGENT_SLUGS = new Set([
  "research",
  "social",
  "copy",
  "suggest_updates",
  "product_qa",
  "chief_operator",
]);

const REAL_AGENT_SLUGS = new Set([
  "research",
  "copy",
  "social",
  "suggest_updates",
  "product_qa",
  "chief_operator",
]);
const RESEARCH_SCOPES = new Set([
  "kemet_trends",
  "competitor",
  "app_research",
  "business",
  "technical",
]);
const RESEARCH_DEPTHS = new Set(["quick", "standard", "deep"]);
const COPY_SURFACES = new Set([
  "app_ui",
  "landing",
  "landing_page",
  "email",
  "app_store",
  "onboarding",
  "node_intro",
  "flow_description",
  "support",
  "support_response",
]);
const SOCIAL_PLATFORMS = new Set([
  "tiktok",
  "threads",
  "instagram",
  "carousel",
  "youtube_short",
]);
const SUGGEST_FOCUSES = new Set([
  "product",
  "content",
  "maat",
  "onboarding",
  "retention",
  "bugs",
]);
const SUGGEST_CATEGORIES = new Set([
  "copy_change",
  "new_node",
  "node_improvement",
  "flow_improvement",
  "maat_tune",
  "onboarding",
  "bug_suspect",
  "analytics_gap",
  "social_opportunity",
]);
const SUGGEST_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfPeriod(period: BudgetRow["period"]) {
  const now = new Date();
  if (period === "daily") {
    return new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ));
  }
  if (period === "weekly") {
    const day = now.getUTCDay();
    const diff = (day + 6) % 7;
    return new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - diff,
    ));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function budgetPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${
    String(now.getUTCMonth() + 1).padStart(2, "0")
  }`;
}

function namespaceForAgent(agentSlug: string) {
  if (agentSlug === "suggest_updates") return "suggestions";
  if (agentSlug === "product_qa") return "codex";
  if (agentSlug === "chief_operator") return "chief_report";
  return agentSlug;
}

function modelForAgent(agent: AgentDefinition) {
  if (agent.default_model && agent.default_model !== "echo-stub") {
    return agent.default_model;
  }
  return Deno.env.get("OPENAI_ADMIN_MODEL") ??
    Deno.env.get("OPENAI_MODEL") ??
    "gpt-4o-mini";
}

function calculateCostUsd(model: string, tokensIn: number, tokensOut: number) {
  const lower = model.toLowerCase();
  if (lower.includes("gpt-4o-mini")) {
    return (tokensIn * 0.00000015) + (tokensOut * 0.0000006);
  }
  if (lower.includes("gpt-4o")) {
    return (tokensIn * 0.0000025) + (tokensOut * 0.00001);
  }
  return (tokensIn + tokensOut) * 0.000001;
}

async function defaultLlmProvider(request: LlmRequest): Promise<LlmResponse> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("MISSING_OPENAI_KEY");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(95_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OPENAI_HTTP_${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return {
    provider: "openai",
    modelUsed: data?.model ?? request.model,
    content: data?.choices?.[0]?.message?.content ?? "",
    tokensIn: data?.usage?.prompt_tokens ?? 0,
    tokensOut: data?.usage?.completion_tokens ?? 0,
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (_error) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced) as Record<string, unknown>;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("LLM_JSON_PARSE_FAILED");
  }
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function urlList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof value === "string") {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

function extractSources(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      !!item && typeof item === "object"
    )
    .map((item) => ({
      title: clampText(item.title, 160) || "Source",
      url: clampText(item.url, 500),
      note: clampText(item.note, 500),
    }))
    .filter((item) => item.title || item.url || item.note)
    .slice(0, 12);
}

function buildResearchPrompt(input: Record<string, unknown>) {
  const topic = clampText(input.topic, 240);
  const scope = clampText(input.scope, 40);
  const depth = clampText(input.depth, 40);
  const urls = urlList(input.urls);
  const useWarRoomContext = input.use_war_room_context === true;

  if (!topic || !RESEARCH_SCOPES.has(scope) || !RESEARCH_DEPTHS.has(depth)) {
    throw new Error("INVALID_RESEARCH_INPUT");
  }

  return {
    topic,
    scope,
    depth,
    urls,
    useWarRoomContext,
    prompt: [
      "Create a research brief for the haw admin Archive.",
      "Return ONLY JSON with this shape:",
      `{"title":"","summary":"","key_findings":[""],"sources":[{"title":"","url":"","note":""}],"implications":[""],"risks":[""],"recommended_next_action":""}`,
      "",
      "Rules:",
      "- Be specific and concise.",
      "- Cite sources in the sources array for web or factual claims.",
      "- If source URLs are provided, use them as citation anchors and do not invent quotes.",
      "- If you are uncertain, say so in risks.",
      "- Do not include raw PII or user-level data.",
      useWarRoomContext
        ? "- The operator requested War Room context, but this prompt includes no raw user data."
        : "- Do not assume War Room context.",
      "",
      `Topic: ${topic}`,
      `Scope: ${scope}`,
      `Depth: ${depth}`,
      urls.length
        ? `Source URLs:\n${urls.map((url) => `- ${url}`).join("\n")}`
        : "Source URLs: none provided",
    ].join("\n"),
  };
}

function buildCopyPrompt(input: Record<string, unknown>) {
  const surface = clampText(input.surface, 60);
  const brief = clampText(input.brief, 4000);
  const tone = clampText(input.tone, 500) || "clear, calm, useful";
  const lengthLimit = Math.max(
    0,
    Math.min(5000, numberValue(input.length_limit)),
  );

  if (!COPY_SURFACES.has(surface) || !brief) {
    throw new Error("INVALID_COPY_INPUT");
  }

  return {
    surface,
    brief,
    tone,
    lengthLimit,
    prompt: [
      "Create copy variants for the haw admin Archive.",
      "Return ONLY JSON with this shape:",
      `{"title":"","variant_a":"","variant_b":"","variant_c":"","recommended_choice":"A","notes":""}`,
      "",
      "Rules:",
      "- Draft only; do not imply production content has changed.",
      "- Keep the language clear and grounded.",
      "- Respect the length limit if provided.",
      "",
      `Surface: ${surface}`,
      `Brief: ${brief}`,
      `Tone: ${tone}`,
      lengthLimit
        ? `Length limit: ${lengthLimit} characters`
        : "Length limit: none",
    ].join("\n"),
  };
}

function buildResearchMarkdown(parsed: Record<string, unknown>) {
  const title = clampText(parsed.title, 180) || "Research Brief";
  const summary = clampText(parsed.summary, 4000);
  const keyFindings = stringList(parsed.key_findings);
  const sources = extractSources(parsed.sources);
  const implications = stringList(parsed.implications);
  const risks = stringList(parsed.risks);
  const recommendedNextAction = clampText(
    parsed.recommended_next_action,
    2000,
  );

  if (!summary || keyFindings.length === 0 || sources.length === 0) {
    throw new Error("INVALID_RESEARCH_OUTPUT");
  }

  return {
    title,
    sources,
    contentMd: [
      `# ${title}`,
      "",
      "## Summary",
      summary,
      "",
      "## Key findings",
      ...keyFindings.map((item) => `- ${item}`),
      "",
      "## Sources",
      ...sources.map((source) =>
        `- ${source.url ? `[${source.title}](${source.url})` : source.title}${
          source.note ? ` - ${source.note}` : ""
        }`
      ),
      "",
      "## Implications for haw",
      ...(implications.length ? implications : ["- No implications provided."])
        .map((item) => item.startsWith("- ") ? item : `- ${item}`),
      "",
      "## Risks / uncertainties",
      ...(risks.length ? risks : ["- No risks provided."])
        .map((item) => item.startsWith("- ") ? item : `- ${item}`),
      "",
      "## Recommended next action",
      recommendedNextAction || "No next action provided.",
    ].join("\n"),
  };
}

function buildCopyMarkdown(parsed: Record<string, unknown>) {
  const title = clampText(parsed.title, 180) || "Copy Variants";
  const variantA = clampText(parsed.variant_a, 4000);
  const variantB = clampText(parsed.variant_b, 4000);
  const variantC = clampText(parsed.variant_c, 4000);
  const recommendedChoice = clampText(parsed.recommended_choice, 20) || "A";
  const notes = clampText(parsed.notes, 2000);

  if (!variantA || !variantB || !variantC) {
    throw new Error("INVALID_COPY_OUTPUT");
  }

  return {
    title,
    contentMd: [
      `# ${title}`,
      "",
      "## Variant A",
      variantA,
      "",
      "## Variant B",
      variantB,
      "",
      "## Variant C",
      variantC,
      "",
      "## Recommended choice",
      recommendedChoice,
      "",
      "## Notes",
      notes || "No notes provided.",
    ].join("\n"),
  };
}

function buildSocialPrompt(input: Record<string, unknown>) {
  const platform = clampText(input.platform, 40);
  const topic = clampText(input.topic ?? input.campaign, 500);
  const hook = clampText(input.hook, 500);
  const tone = clampText(input.tone, 500) || "clear, useful, and concise";
  const batchSize = Math.max(
    1,
    Math.min(5, Math.round(numberValue(input.batch_size) || 1)),
  );

  if (!SOCIAL_PLATFORMS.has(platform) || !topic) {
    throw new Error("INVALID_SOCIAL_INPUT");
  }

  return {
    platform,
    topic,
    hook,
    tone,
    batchSize,
    prompt: [
      "Create draft-only social content for the haw founder to review manually.",
      "Return ONLY JSON with this shape:",
      `{"title":"","drafts":[{"hook":"","caption_or_script":"","shot_list":[""],"hashtags":[""],"posting_notes":""}]}`,
      "",
      "Rules:",
      "- Do not say anything is posted, scheduled, or published.",
      "- No external posting APIs exist in this workflow.",
      "- Keep drafts practical and platform-aware.",
      "- Avoid copying competitor phrasing.",
      "",
      `Platform: ${platform}`,
      `Topic/campaign: ${topic}`,
      `Hook: ${hook || "none provided"}`,
      `Tone: ${tone}`,
      `Batch size: ${batchSize}`,
    ].join("\n"),
  };
}

function buildSocialMarkdown(parsed: Record<string, unknown>) {
  const title = clampText(parsed.title, 180) || "Social Drafts";
  const drafts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
  if (drafts.length === 0) throw new Error("INVALID_SOCIAL_OUTPUT");

  const lines = [`# ${title}`, "", "Draft-only. Not posted or scheduled."];
  drafts.slice(0, 5).forEach((draft, index) => {
    const row = draft as Record<string, unknown>;
    lines.push(
      "",
      `## Draft ${index + 1}`,
      "",
      "### Hook",
      clampText(row.hook, 1000) || "No hook provided.",
      "",
      "### Caption / script",
      clampText(row.caption_or_script, 4000) || "No script provided.",
      "",
      "### Shot list",
      ...(stringList(row.shot_list).length
        ? stringList(row.shot_list).map((item) => `- ${item}`)
        : ["- No shot list provided."]),
      "",
      "### Hashtags",
      stringList(row.hashtags).join(" ") || "No hashtags provided.",
      "",
      "### Posting notes",
      clampText(row.posting_notes, 1200) || "No posting notes provided.",
    );
  });

  return { title, contentMd: lines.join("\n") };
}

function buildSuggestPrompt(
  input: Record<string, unknown>,
  warRoom: Record<string, unknown>,
) {
  const lookbackDays = Math.max(
    7,
    Math.min(90, Math.round(numberValue(input.lookback_days) || 7)),
  );
  const focus = clampText(input.focus, 40) || "product";
  if (!SUGGEST_FOCUSES.has(focus)) throw new Error("INVALID_SUGGEST_INPUT");

  return {
    lookbackDays,
    focus,
    warRoom,
    prompt: [
      "Read the aggregate War Room JSON and propose useful admin suggestions.",
      "Return ONLY JSON with this shape:",
      `{"title":"","summary":"","suggestions":[{"title":"","category":"copy_change","priority":"medium","evidence":"","recommended_action":"","expected_impact":"","related_metric":""}]}`,
      "",
      "Allowed categories:",
      Array.from(SUGGEST_CATEGORIES).join(", "),
      "",
      "Rules:",
      "- Use aggregate-safe evidence only.",
      "- Do not request raw user data.",
      "- Do not propose direct production mutation.",
      "- Keep the list to 3-6 high-signal suggestions.",
      "",
      `Focus: ${focus}`,
      `Lookback days: ${lookbackDays}`,
      `War Room JSON:\n${JSON.stringify(warRoom).slice(0, 12000)}`,
    ].join("\n"),
  };
}

function normalizeSuggestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      !!item && typeof item === "object"
    )
    .map((item) => {
      const category = clampText(item.category, 60);
      const priority = clampText(item.priority, 20) || "medium";
      return {
        title: clampText(item.title, 180),
        category: SUGGEST_CATEGORIES.has(category) ? category : "analytics_gap",
        priority: SUGGEST_PRIORITIES.has(priority) ? priority : "medium",
        evidence: clampText(item.evidence, 2000),
        recommended_action: clampText(item.recommended_action, 2000),
        expected_impact: clampText(item.expected_impact, 1000),
        related_metric: clampText(item.related_metric, 160),
      };
    })
    .filter((item) => item.title && item.recommended_action)
    .slice(0, 8);
}

function buildSuggestMarkdown(parsed: Record<string, unknown>) {
  const title = clampText(parsed.title, 180) || "Suggested Updates";
  const summary = clampText(parsed.summary, 3000) ||
    "Suggestions generated from War Room aggregate data.";
  const suggestions = normalizeSuggestions(parsed.suggestions);
  if (suggestions.length === 0) throw new Error("INVALID_SUGGEST_OUTPUT");

  return {
    title,
    suggestions,
    contentMd: [
      `# ${title}`,
      "",
      "## Summary",
      summary,
      "",
      "## Suggestions",
      ...suggestions.flatMap((suggestion) => [
        `### ${suggestion.title}`,
        `- Category: ${suggestion.category}`,
        `- Priority: ${suggestion.priority}`,
        `- Evidence: ${suggestion.evidence || "No evidence provided."}`,
        `- Recommended action: ${suggestion.recommended_action}`,
        `- Expected impact: ${suggestion.expected_impact || "Not specified."}`,
        `- Related metric: ${suggestion.related_metric || "Not specified."}`,
        "",
      ]),
    ].join("\n"),
  };
}

function buildProductQaPrompt(input: Record<string, unknown>) {
  const report = clampText(input.report ?? input.description, 6000);
  const likelyArea = clampText(input.likely_area, 500);
  const links = urlList(input.links);
  if (!report) throw new Error("INVALID_PRODUCT_QA_INPUT");

  return {
    report,
    likelyArea,
    links,
    prompt: [
      "Convert this product observation into a Codex-ready task spec.",
      "Return ONLY JSON with this shape:",
      `{"title":"","summary":"","context":"","repro_observed":"","expected_behavior":"","likely_files":[""],"suggested_approach":"","acceptance_criteria":[""],"security_privacy":"","out_of_scope":[""],"codex_prompt":""}`,
      "",
      "Rules:",
      "- No auto-PR language.",
      "- Include security/privacy considerations.",
      "- Keep acceptance criteria testable.",
      "",
      `Observation:\n${report}`,
      likelyArea ? `Likely area: ${likelyArea}` : "Likely area: not provided",
      links.length
        ? `Links:\n${links.map((url) => `- ${url}`).join("\n")}`
        : "Links: none",
    ].join("\n"),
  };
}

function buildProductQaMarkdown(parsed: Record<string, unknown>) {
  const title = clampText(parsed.title, 180) || "Codex Task Draft";
  const acceptanceCriteria = stringList(parsed.acceptance_criteria);
  const outOfScope = stringList(parsed.out_of_scope);
  const likelyFiles = stringList(parsed.likely_files);
  const codexPrompt = clampText(parsed.codex_prompt, 8000);

  if (!clampText(parsed.summary, 2000) || !codexPrompt) {
    throw new Error("INVALID_PRODUCT_QA_OUTPUT");
  }

  const specMd = [
    `# ${title}`,
    "",
    "## Summary",
    clampText(parsed.summary, 2000),
    "",
    "## Context",
    clampText(parsed.context, 3000) || "No context provided.",
    "",
    "## Repro / observed behavior",
    clampText(parsed.repro_observed, 3000) || "No repro provided.",
    "",
    "## Expected behavior",
    clampText(parsed.expected_behavior, 3000) ||
    "No expected behavior provided.",
    "",
    "## Likely files/modules",
    ...(likelyFiles.length ? likelyFiles : ["Not specified."]).map((item) =>
      `- ${item}`
    ),
    "",
    "## Suggested approach",
    clampText(parsed.suggested_approach, 3000) || "No approach provided.",
    "",
    "## Acceptance criteria",
    ...(acceptanceCriteria.length
      ? acceptanceCriteria
      : ["Acceptance criteria not specified."]).map((item) => `- ${item}`),
    "",
    "## Security / privacy considerations",
    clampText(parsed.security_privacy, 3000) ||
    "No additional considerations provided.",
    "",
    "## Out of scope",
    ...(outOfScope.length ? outOfScope : ["Not specified."]).map((item) =>
      `- ${item}`
    ),
    "",
    "## Copy-paste Codex prompt",
    "",
    "```text",
    codexPrompt,
    "```",
  ].join("\n");

  return { title, specMd, codexPrompt };
}

function buildChiefPrompt(
  input: Record<string, unknown>,
  context: Record<string, unknown>,
) {
  const lookbackDays = Math.max(
    7,
    Math.min(90, Math.round(numberValue(input.lookback_days) || 7)),
  );
  return {
    lookbackDays,
    context,
    prompt: [
      "Create a weekly Chief Operator report for the haw founder.",
      "Return ONLY JSON with this shape:",
      `{"title":"","wins":[""],"risks":[""],"what_changed":[""],"top_metrics":[""],"needs_approval":[""],"top_3_actions":[""],"what_to_ignore":[""],"recommended_codex_task":""}`,
      "",
      "Rules:",
      "- Recommend; do not approve anything.",
      "- Use aggregate-safe metrics.",
      "- Keep top_3_actions to exactly three items if possible.",
      "",
      `Lookback days: ${lookbackDays}`,
      `Operating context JSON:\n${JSON.stringify(context).slice(0, 14000)}`,
    ].join("\n"),
  };
}

function buildChiefMarkdown(parsed: Record<string, unknown>) {
  const title = clampText(parsed.title, 180) || "Chief Operator Weekly Report";
  const sections = [
    ["Wins", stringList(parsed.wins)],
    ["Risks", stringList(parsed.risks)],
    ["What changed", stringList(parsed.what_changed)],
    ["Top metrics", stringList(parsed.top_metrics)],
    ["What needs approval", stringList(parsed.needs_approval)],
    ["Top 3 actions", stringList(parsed.top_3_actions).slice(0, 3)],
    ["What to ignore", stringList(parsed.what_to_ignore)],
  ] as const;
  const recommendedCodexTask = clampText(parsed.recommended_codex_task, 3000);
  if (sections.every(([, items]) => items.length === 0)) {
    throw new Error("INVALID_CHIEF_OUTPUT");
  }

  return {
    title,
    contentMd: [
      `# ${title}`,
      "",
      ...sections.flatMap(([heading, items]) => [
        `## ${heading}`,
        ...(items.length ? items : ["No items."]).map((item) => `- ${item}`),
        "",
      ]),
      "## Recommended Codex task",
      recommendedCodexTask || "No Codex task recommended.",
    ].join("\n"),
  };
}

function echoMarkdown(agent: AgentDefinition, input: Record<string, unknown>) {
  const message = clampText(input.message, 500) || "Echo test run";
  return [
    `# Echo Run: ${agent.name}`,
    "",
    "## Summary",
    "Phase 3 echo pipeline completed. No external model or API was called.",
    "",
    "## Input",
    message,
    "",
    "## Output",
    "This is a stub output for validating jobs, runs, Archive, Treasury, and audit logging.",
  ].join("\n");
}

function filterRuns(runs: RunRow[], req: Request) {
  const url = new URL(req.url);
  const agentSlug = (url.searchParams.get("agent_slug") ?? "").trim();
  return runs
    .filter((run) => !agentSlug || run.agent_slug === agentSlug)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 50);
}

function attachArchiveOutputs(runs: RunRow[], outputs: OutputRow[]) {
  const outputByRun = new Map(
    outputs
      .filter((output) => output.archive_entry_id)
      .map((output) => [output.run_id, output.archive_entry_id ?? null]),
  );
  return runs.map((run) => ({
    ...run,
    archive_entry_id: outputByRun.get(run.id) ?? null,
  }));
}

async function enforceBudget(
  deps: HandlerDeps,
  agentSlug: string,
  estimatedCostUsd: number,
) {
  const [budgetResult, ledgerResult] = await Promise.all([
    selectRows<BudgetRow>(
      deps.client,
      "haw_treasury_budgets",
      "scope,agent_slug,period,limit_usd,is_active",
    ),
    selectRows<LedgerRow>(
      deps.client,
      "haw_treasury_ledger",
      "agent_slug,cost_usd,created_at",
    ),
  ]);

  if (budgetResult.error || ledgerResult.error) {
    return {
      allowed: false,
      error: budgetResult.error ?? ledgerResult.error,
      budget: null,
    };
  }

  const ledger = ledgerResult.data ?? [];
  for (const budget of budgetResult.data ?? []) {
    if (!budget.is_active) continue;
    if (budget.scope === "agent_slug" && budget.agent_slug !== agentSlug) {
      continue;
    }

    const since = startOfPeriod(budget.period);
    const spent = ledger
      .filter((row) => Date.parse(row.created_at) >= since.getTime())
      .filter((row) =>
        budget.scope === "global" || row.agent_slug === agentSlug
      )
      .reduce((sum, row) => sum + numberValue(row.cost_usd), 0);
    const limit = numberValue(budget.limit_usd);

    if (spent + estimatedCostUsd > limit) {
      return {
        allowed: false,
        error: null,
        budget: {
          scope: budget.scope,
          agent_slug: budget.agent_slug,
          period: budget.period,
          limit_usd: limit,
          spent_usd: Number(spent.toFixed(6)),
          estimated_cost_usd: estimatedCostUsd,
        },
      };
    }
  }

  return { allowed: true, error: null, budget: null };
}

async function loadActivePlaybook(deps: HandlerDeps, slug: string) {
  const result = await selectRows<ArmoryPlaybook>(
    deps.client,
    "haw_armory_playbooks",
    "slug,agent_slug,system_prompt_md,is_active",
  );
  if (result.error) return { data: null, error: result.error };

  const playbook =
    (result.data ?? []).find((row) => row.slug === slug && row.is_active) ??
      null;
  return { data: playbook, error: null };
}

function playbookSlugForAgent(agentSlug: string) {
  if (agentSlug === "research") return "research-v1";
  if (agentSlug === "copy") return "copy-v1";
  if (agentSlug === "social") return "social-draft-only-v1";
  if (agentSlug === "suggest_updates") return "suggest-updates-v1";
  if (agentSlug === "product_qa") return "codex-task-v1";
  if (agentSlug === "chief_operator") return "chief-operator-v1";
  return null;
}

async function getWarRoomSummary(
  deps: AgentRunDeps,
  context: AdminContext,
  days: number,
) {
  if (deps.warRoomSummary) return await deps.warRoomSummary(days, context);

  const rpcClient = deps.rpcClient?.(context.token) ?? deps.client;
  if (!rpcClient.rpc) throw new Error("WAR_ROOM_RPC_NOT_AVAILABLE");

  const { data, error } = await rpcClient.rpc("admin_war_room_summary", {
    p_days: days,
  });
  if (error) {
    throw new Error(`WAR_ROOM_SUMMARY_FAILED: ${serializeError(error)}`);
  }
  if (!data || typeof data !== "object") return {};
  return data as Record<string, unknown>;
}

async function getChiefContext(
  deps: AgentRunDeps,
  context: AdminContext,
  days: number,
) {
  const [warRoom, approvals, suggestions, runs, ledger] = await Promise.all([
    getWarRoomSummary(deps, context, days),
    selectRows<ApprovalRow>(
      deps.client,
      "haw_approval_requests",
      "id,kind,status,risk_level,summary,created_at",
    ),
    selectRows<SuggestionRow>(
      deps.client,
      "suggestions",
      "id,title,category,priority,status,created_at",
    ),
    selectRows<RunRow>(
      deps.client,
      "ops_runs",
      "id,job_id,agent_slug,status,model,input,output_summary,created_at,completed_at,duration_ms",
    ),
    selectRows<TreasuryLedgerRow>(
      deps.client,
      "haw_treasury_ledger",
      "agent_slug,cost_usd,created_at",
    ),
  ]);

  for (const result of [approvals, suggestions, runs, ledger]) {
    if (result.error) {
      throw new Error(`CHIEF_CONTEXT_FAILED: ${serializeError(result.error)}`);
    }
  }

  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const recentLedger = (ledger.data ?? []).filter((row) =>
    Date.parse(row.created_at) >= since
  );
  const treasuryCostUsd = recentLedger.reduce(
    (sum, row) => sum + numberValue(row.cost_usd),
    0,
  );

  return {
    war_room: warRoom,
    pending_approvals: (approvals.data ?? []).filter((row) =>
      row.status === "pending"
    ).slice(0, 20),
    open_suggestions: (suggestions.data ?? []).filter((row) =>
      ["new", "triaged", "approved"].includes(row.status)
    ).slice(0, 30),
    recent_runs: (runs.data ?? [])
      .filter((row) => Date.parse(row.created_at) >= since)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 30),
    treasury: {
      cost_usd: Number(treasuryCostUsd.toFixed(6)),
      run_count: recentLedger.length,
    },
  };
}

async function buildRealAgentOutput(
  deps: AgentRunDeps,
  agent: AgentDefinition,
  input: Record<string, unknown>,
  context: AdminContext,
) {
  const playbookSlug = playbookSlugForAgent(agent.slug);
  if (!playbookSlug) throw new Error("REAL_AGENT_NOT_SUPPORTED");

  const playbook = await loadActivePlaybook(deps, playbookSlug);
  if (playbook.error) {
    throw new Error(`PLAYBOOK_LOOKUP_FAILED: ${playbook.error}`);
  }
  if (!playbook.data) throw new Error("ACTIVE_PLAYBOOK_NOT_FOUND");

  const model = modelForAgent(agent);
  const llm = deps.llm ?? defaultLlmProvider;

  if (agent.slug === "research") {
    const researchInput = buildResearchPrompt(input);
    const llmResponse = await llm({
      agentSlug: "research",
      model,
      systemPrompt: playbook.data.system_prompt_md,
      userPrompt: researchInput.prompt,
      temperature: researchInput.depth === "deep" ? 0.35 : 0.25,
      maxTokens: researchInput.depth === "deep" ? 2200 : 1500,
    });
    const parsed = parseJsonObject(llmResponse.content);
    const markdown = buildResearchMarkdown(parsed);

    return {
      namespace: "research",
      title: markdown.title,
      contentMd: markdown.contentMd,
      tags: ["research", researchInput.scope, researchInput.depth],
      sourceType: "agent_research",
      outputSummary: `Research brief created: ${markdown.title}`,
      payload: {
        agent: "research",
        input: researchInput,
        sources: markdown.sources,
        parsed,
      },
      llmResponse,
    };
  }

  if (agent.slug === "copy") {
    const copyInput = buildCopyPrompt(input);
    const llmResponse = await llm({
      agentSlug: "copy",
      model,
      systemPrompt: playbook.data.system_prompt_md,
      userPrompt: copyInput.prompt,
      temperature: 0.55,
      maxTokens: 1600,
    });
    const parsed = parseJsonObject(llmResponse.content);
    const markdown = buildCopyMarkdown(parsed);

    return {
      namespace: "copy",
      title: markdown.title,
      contentMd: markdown.contentMd,
      tags: ["copy", copyInput.surface],
      sourceType: "agent_copy",
      outputSummary: `Copy variants created: ${markdown.title}`,
      payload: {
        agent: "copy",
        input: copyInput,
        parsed,
      },
      llmResponse,
    };
  }

  if (agent.slug === "social") {
    const socialInput = buildSocialPrompt(input);
    const llmResponse = await llm({
      agentSlug: "social",
      model,
      systemPrompt: playbook.data.system_prompt_md,
      userPrompt: socialInput.prompt,
      temperature: 0.65,
      maxTokens: 1800,
    });
    const parsed = parseJsonObject(llmResponse.content);
    const markdown = buildSocialMarkdown(parsed);

    return {
      namespace: "social",
      title: markdown.title,
      contentMd: markdown.contentMd,
      tags: ["social", socialInput.platform],
      sourceType: "agent_social",
      outputSummary: `Social drafts created: ${markdown.title}`,
      payload: {
        agent: "social",
        input: socialInput,
        parsed,
        draft_only: true,
      },
      llmResponse,
    };
  }

  if (agent.slug === "suggest_updates") {
    const lookbackDays = Math.max(
      7,
      Math.min(90, Math.round(numberValue(input.lookback_days) || 7)),
    );
    const warRoom = await getWarRoomSummary(deps, context, lookbackDays);
    const suggestInput = buildSuggestPrompt(input, warRoom);
    const llmResponse = await llm({
      agentSlug: "suggest_updates",
      model,
      systemPrompt: playbook.data.system_prompt_md,
      userPrompt: suggestInput.prompt,
      temperature: 0.3,
      maxTokens: 2200,
    });
    const parsed = parseJsonObject(llmResponse.content);
    const markdown = buildSuggestMarkdown(parsed);

    return {
      namespace: "suggestions",
      title: markdown.title,
      contentMd: markdown.contentMd,
      tags: [
        "suggestions",
        suggestInput.focus,
        `${suggestInput.lookbackDays}d`,
      ],
      sourceType: "agent_suggest_updates",
      outputSummary: `${markdown.suggestions.length} suggestions created.`,
      payload: {
        agent: "suggest_updates",
        input: suggestInput,
        suggestions: markdown.suggestions,
        parsed,
      },
      sideEffects: { suggestions: markdown.suggestions },
      llmResponse,
    };
  }

  if (agent.slug === "product_qa") {
    const qaInput = buildProductQaPrompt(input);
    const llmResponse = await llm({
      agentSlug: "product_qa",
      model,
      systemPrompt: playbook.data.system_prompt_md,
      userPrompt: qaInput.prompt,
      temperature: 0.25,
      maxTokens: 2200,
    });
    const parsed = parseJsonObject(llmResponse.content);
    const markdown = buildProductQaMarkdown(parsed);

    return {
      namespace: "codex",
      title: markdown.title,
      contentMd: markdown.specMd,
      tags: ["codex", "product_qa"],
      sourceType: "agent_product_qa",
      outputSummary: `Codex task draft created: ${markdown.title}`,
      payload: {
        agent: "product_qa",
        input: qaInput,
        parsed,
      },
      sideEffects: {
        codexTask: {
          title: markdown.title,
          specMd: markdown.specMd,
          promptMd: markdown.codexPrompt,
        },
      },
      llmResponse,
    };
  }

  if (agent.slug === "chief_operator") {
    const lookbackDays = Math.max(
      7,
      Math.min(90, Math.round(numberValue(input.lookback_days) || 7)),
    );
    const chiefContext = await getChiefContext(deps, context, lookbackDays);
    const chiefInput = buildChiefPrompt(input, chiefContext);
    const llmResponse = await llm({
      agentSlug: "chief_operator",
      model,
      systemPrompt: playbook.data.system_prompt_md,
      userPrompt: chiefInput.prompt,
      temperature: 0.3,
      maxTokens: 2200,
    });
    const parsed = parseJsonObject(llmResponse.content);
    const markdown = buildChiefMarkdown(parsed);

    return {
      namespace: "chief_report",
      title: markdown.title,
      contentMd: markdown.contentMd,
      tags: ["chief_operator", `${chiefInput.lookbackDays}d`],
      sourceType: "agent_chief_operator",
      outputSummary: `Chief report created: ${markdown.title}`,
      payload: {
        agent: "chief_operator",
        input: chiefInput,
        parsed,
        war_room_snapshot: chiefContext.war_room,
      },
      llmResponse,
    };
  }

  throw new Error("REAL_AGENT_NOT_SUPPORTED");
}

function estimatedCostForAgent(
  agentSlug: string,
  body: Record<string, unknown> | null,
) {
  const explicit = body?.estimated_cost_usd;
  if (explicit !== undefined) return Math.max(0, numberValue(explicit));
  if (agentSlug === "research") return 0.02;
  if (agentSlug === "copy") return 0.01;
  if (agentSlug === "social") return 0.012;
  if (agentSlug === "suggest_updates") return 0.02;
  if (agentSlug === "product_qa") return 0.015;
  if (agentSlug === "chief_operator") return 0.025;
  return 0.0001;
}

export function createAdminAgentRunHandler(deps: AgentRunDeps) {
  return async function adminAgentRunHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const agentSlug = (url.searchParams.get("agent_slug") ?? "").trim();
      const auth = await requireAdmin(req, deps, {
        scope: "ops.read",
        deniedAction: "agent_run.denied",
        resourceType: "ops_run",
      });
      if (auth.ok === false) return auth.response;

      const { data, error } = await selectRows<RunRow>(
        deps.client,
        "ops_runs",
        "id,job_id,agent_slug,status,model,input,output_summary,created_at,completed_at,duration_ms",
      );

      if (error) {
        return jsonResponse(req, {
          error: "agent_runs_list_failed",
          detail: serializeError(error),
        }, { status: 500 });
      }

      const outputs = await selectRows<OutputRow>(
        deps.client,
        "ops_run_outputs",
        "id,run_id,output_type,archive_entry_id",
      );

      if (outputs.error) {
        return jsonResponse(req, {
          error: "agent_outputs_list_failed",
          detail: serializeError(outputs.error),
        }, { status: 500 });
      }

      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "agent_run.view",
        resourceType: "ops_run",
        riskLevel: "low",
      });

      const responseBody: Record<string, unknown> = {
        runs: filterRuns(
          attachArchiveOutputs(data ?? [], outputs.data ?? []),
          req,
        ),
      };

      if (agentSlug === "suggest_updates") {
        const suggestions = await selectRows<SuggestionRow>(
          deps.client,
          "suggestions",
          "id,title,category,priority,status,created_at",
        );
        if (suggestions.error) {
          return jsonResponse(req, {
            error: "suggestions_list_failed",
            detail: serializeError(suggestions.error),
          }, { status: 500 });
        }
        responseBody.suggestions = (suggestions.data ?? [])
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .slice(0, 100);
      }

      if (agentSlug === "product_qa") {
        const codexTasks = await selectRows<CodexTaskRow>(
          deps.client,
          "codex_tasks",
          "id,title,status,spec_md,prompt_md,created_at",
        );
        if (codexTasks.error) {
          return jsonResponse(req, {
            error: "codex_tasks_list_failed",
            detail: serializeError(codexTasks.error),
          }, { status: 500 });
        }
        responseBody.codex_tasks = (codexTasks.data ?? [])
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .slice(0, 50);
      }

      if (agentSlug === "chief_operator") {
        const reports = await selectRows<ArchiveEntry>(
          deps.client,
          "haw_archive_entries",
          "id,namespace,title,content_md,created_at",
        );
        if (reports.error) {
          return jsonResponse(req, {
            error: "chief_reports_list_failed",
            detail: serializeError(reports.error),
          }, { status: 500 });
        }
        responseBody.latest_report = (reports.data ?? [])
          .filter((entry) => entry.namespace === "chief_report")
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .at(0) ?? null;
      }

      return jsonResponse(req, responseBody);
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "method_not_allowed" }, {
        status: 405,
      });
    }

    const auth = await requireAdmin(req, deps, {
      scope: "ops.run",
      deniedAction: "agent_run.denied",
      resourceType: "ops_run",
    });
    if (auth.ok === false) return auth.response;

    const body = await readJsonBody(req) as Record<string, unknown> | null;
    const agentSlug = clampText(body?.agent_slug, 60);
    const mode = clampText(body?.mode, 20);
    const input = typeof body?.input === "object" && body.input
      ? body.input as Record<string, unknown>
      : {};
    const estimatedCostUsd = estimatedCostForAgent(agentSlug, body);
    const isRealRun = REAL_AGENT_SLUGS.has(agentSlug) && mode !== "echo";

    if (!AGENT_SLUGS.has(agentSlug)) {
      return jsonResponse(req, { error: "invalid_agent_slug" }, {
        status: 400,
      });
    }

    const definitions = await selectRows<AgentDefinition>(
      deps.client,
      "ops_agent_definitions",
      "slug,name,status,default_model,required_scopes,risk_level",
    );
    if (definitions.error) {
      return jsonResponse(req, {
        error: "agent_definition_lookup_failed",
        detail: serializeError(definitions.error),
      }, { status: 500 });
    }

    const agent = (definitions.data ?? []).find((row) =>
      row.slug === agentSlug
    );
    if (!agent || agent.status === "disabled" || agent.status === "inactive") {
      return jsonResponse(req, { error: "agent_not_available" }, {
        status: 409,
      });
    }

    for (const scope of agent.required_scopes ?? []) {
      if (!hasScope(auth.context.staff, scope)) {
        await writeAudit(req, deps, {
          actorUserId: auth.context.user.id,
          actorRole: auth.context.staff.role,
          action: "agent_run.denied",
          resourceType: "ops_run",
          riskLevel: "medium",
          metadata: {
            reason: "missing_agent_scope",
            scope,
            agent_slug: agentSlug,
          },
        });
        return jsonResponse(req, {
          error: "missing_agent_scope",
          scope,
        }, { status: 403 });
      }
    }

    const budget = await enforceBudget(deps, agentSlug, estimatedCostUsd);
    if (budget.error) {
      return jsonResponse(req, {
        error: "budget_check_failed",
        detail: serializeError(budget.error),
      }, { status: 500 });
    }
    if (!budget.allowed) {
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "agent_run.budget_blocked",
        resourceType: "ops_run",
        riskLevel: "medium",
        metadata: { agent_slug: agentSlug, budget: budget.budget },
      });
      return jsonResponse(req, {
        error: "budget_exceeded",
        budget: budget.budget,
      }, { status: 402 });
    }

    const started = performance.now();
    const jobResult = await insertRow<JobRow>(deps.client, "ops_jobs", {
      agent_slug: agentSlug,
      status: "queued",
      requested_by: auth.context.user.id,
      input,
    });

    if (jobResult.error || !jobResult.data) {
      return jsonResponse(req, {
        error: "job_create_failed",
        detail: serializeError(jobResult.error),
      }, { status: 500 });
    }

    const runResult = await insertRow<RunRow>(deps.client, "ops_runs", {
      job_id: jobResult.data.id,
      agent_slug: agentSlug,
      status: "running",
      model: isRealRun
        ? modelForAgent(agent)
        : agent.default_model || "echo-stub",
      created_by: auth.context.user.id,
      input,
    });

    if (runResult.error || !runResult.data) {
      return jsonResponse(req, {
        error: "run_create_failed",
        detail: serializeError(runResult.error),
      }, { status: 500 });
    }

    let agentOutput: {
      namespace: string;
      title: string;
      contentMd: string;
      tags: string[];
      sourceType: string;
      outputSummary: string;
      payload: Record<string, unknown>;
      sideEffects?: {
        suggestions?: Array<{
          title: string;
          category: string;
          priority: string;
          evidence: string;
          recommended_action: string;
          expected_impact: string;
          related_metric: string;
        }>;
        codexTask?: {
          title: string;
          specMd: string;
          promptMd: string;
        };
      };
      llmResponse: LlmResponse;
    };

    try {
      if (isRealRun) {
        agentOutput = await buildRealAgentOutput(
          deps,
          agent,
          input,
          auth.context,
        );
      } else {
        const contentMd = echoMarkdown(agent, input);
        agentOutput = {
          namespace: namespaceForAgent(agentSlug),
          title: `Echo test: ${agent.name}`,
          contentMd,
          tags: ["echo", "phase3", agentSlug],
          sourceType: "ops_echo",
          outputSummary: "Echo pipeline completed.",
          payload: { echo: true, input },
          llmResponse: {
            provider: "stub",
            modelUsed: agent.default_model || "echo-stub",
            content: contentMd,
            tokensIn: 0,
            tokensOut: 0,
          },
        };
      }
    } catch (error) {
      const failedAt = new Date().toISOString();
      await updateRow<RunRow>(deps.client, "ops_runs", runResult.data.id, {
        status: "failed",
        error: serializeError(error),
        completed_at: failedAt,
      });
      await updateRow<JobRow>(deps.client, "ops_jobs", jobResult.data.id, {
        status: "failed",
        error: serializeError(error),
        started_at: failedAt,
        completed_at: failedAt,
      });
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "agent_run.failed",
        resourceType: "ops_run",
        resourceId: runResult.data.id,
        riskLevel: agent.risk_level,
        metadata: {
          agent_slug: agentSlug,
          error: serializeError(error),
          real_run: isRealRun,
        },
      });
      return jsonResponse(req, {
        error: "agent_run_failed",
        detail: serializeError(error),
      }, { status: 500 });
    }

    const archiveResult = await insertRow<ArchiveEntry>(
      deps.client,
      "haw_archive_entries",
      {
        namespace: agentOutput.namespace,
        title: agentOutput.title,
        content_md: agentOutput.contentMd,
        tags: agentOutput.tags,
        source_run_id: runResult.data.id,
        source_type: agentOutput.sourceType,
        created_by: auth.context.user.id,
      },
    );

    if (archiveResult.error || !archiveResult.data) {
      return jsonResponse(req, {
        error: "archive_output_failed",
        detail: serializeError(archiveResult.error),
      }, { status: 500 });
    }

    if (agentOutput.sideEffects?.suggestions?.length) {
      const createdSuggestions: SuggestionRow[] = [];
      for (const suggestion of agentOutput.sideEffects.suggestions) {
        const suggestionResult = await insertRow<SuggestionRow>(
          deps.client,
          "suggestions",
          {
            title: suggestion.title,
            category: suggestion.category,
            priority: suggestion.priority,
            evidence: {
              summary: suggestion.evidence,
              source: "war_room_aggregate",
            },
            recommended_action: suggestion.recommended_action,
            expected_impact: suggestion.expected_impact,
            related_metric: suggestion.related_metric,
            linked_archive_entry_id: archiveResult.data.id,
            source_run_id: runResult.data.id,
            status: "new",
            created_by: auth.context.user.id,
          },
        );
        if (suggestionResult.error || !suggestionResult.data) {
          return jsonResponse(req, {
            error: "suggestion_create_failed",
            detail: serializeError(suggestionResult.error),
          }, { status: 500 });
        }
        createdSuggestions.push(suggestionResult.data);
      }
      agentOutput.payload.side_effects = {
        ...(agentOutput.payload.side_effects as Record<string, unknown> ?? {}),
        suggestions: createdSuggestions,
      };
    }

    if (agentOutput.sideEffects?.codexTask) {
      const task = agentOutput.sideEffects.codexTask;
      const taskResult = await insertRow<CodexTaskRow>(
        deps.client,
        "codex_tasks",
        {
          title: task.title,
          status: "draft",
          spec_md: task.specMd,
          prompt_md: task.promptMd,
          source_run_id: runResult.data.id,
          created_by: auth.context.user.id,
        },
      );
      if (taskResult.error || !taskResult.data) {
        return jsonResponse(req, {
          error: "codex_task_create_failed",
          detail: serializeError(taskResult.error),
        }, { status: 500 });
      }
      agentOutput.payload.side_effects = {
        ...(agentOutput.payload.side_effects as Record<string, unknown> ?? {}),
        codex_task: taskResult.data,
      };
    }

    const outputResult = await insertRow<OutputRow>(
      deps.client,
      "ops_run_outputs",
      {
        run_id: runResult.data.id,
        output_type: "archive_entry",
        content_md: agentOutput.contentMd,
        payload: agentOutput.payload,
        archive_entry_id: archiveResult.data.id,
      },
    );

    if (outputResult.error || !outputResult.data) {
      return jsonResponse(req, {
        error: "run_output_failed",
        detail: serializeError(outputResult.error),
      }, { status: 500 });
    }

    const durationMs = Math.round(performance.now() - started);
    const tokenCostUsd = calculateCostUsd(
      agentOutput.llmResponse.modelUsed,
      agentOutput.llmResponse.tokensIn,
      agentOutput.llmResponse.tokensOut,
    );
    const actualCostUsd = tokenCostUsd > 0 ? tokenCostUsd : estimatedCostUsd;
    await insertRow(deps.client, "haw_treasury_ledger", {
      run_id: runResult.data.id,
      agent_slug: agentSlug,
      provider: agentOutput.llmResponse.provider,
      model: agentOutput.llmResponse.modelUsed,
      tokens_in: agentOutput.llmResponse.tokensIn,
      tokens_out: agentOutput.llmResponse.tokensOut,
      cost_usd: actualCostUsd,
      duration_ms: durationMs,
      budget_period: budgetPeriod(),
    });

    const completedRun = await updateRow<RunRow>(
      deps.client,
      "ops_runs",
      runResult.data.id,
      {
        status: "completed",
        output_summary: agentOutput.outputSummary,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      },
    );
    await updateRow<JobRow>(deps.client, "ops_jobs", jobResult.data.id, {
      status: "completed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    await writeAudit(req, deps, {
      actorUserId: auth.context.user.id,
      actorRole: auth.context.staff.role,
      action: "agent_run.completed",
      resourceType: "ops_run",
      resourceId: runResult.data.id,
      riskLevel: agent.risk_level,
      metadata: {
        agent_slug: agentSlug,
        archive_entry_id: archiveResult.data.id,
        cost_usd: actualCostUsd,
        provider: agentOutput.llmResponse.provider,
        model: agentOutput.llmResponse.modelUsed,
        tokens_in: agentOutput.llmResponse.tokensIn,
        tokens_out: agentOutput.llmResponse.tokensOut,
        real_run: isRealRun,
      },
    });

    return jsonResponse(req, {
      job: jobResult.data,
      run: completedRun.data ?? runResult.data,
      output: outputResult.data,
      archive_entry: archiveResult.data,
      treasury: {
        provider: agentOutput.llmResponse.provider,
        model: agentOutput.llmResponse.modelUsed,
        cost_usd: actualCostUsd,
        tokens_in: agentOutput.llmResponse.tokensIn,
        tokens_out: agentOutput.llmResponse.tokensOut,
      },
    }, { status: 201 });
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client
      ? createAdminAgentRunHandler({
        client,
        rpcClient: (token: string) =>
          createClient(SUPABASE_URL, SERVICE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          }) as unknown as HandlerDeps["client"],
      })
      : serverNotConfiguredResponse,
  );
}
