export type RequestedTimeWindow = {
  startTime: string;
  endTime: string;
  source: "range" | "single";
};

export type FlowFormat =
  | "MEAL_PLAN"
  | "REGIMEN"
  | "PROJECT_PLAN"
  | "FINANCE_PLAN"
  | "SYNTHESIS"
  | "STANDARD";

export type SourceHandlingMode =
  | "NONE"
  | "PRESERVE_STRUCTURE"
  | "SYNTHESIZE_FROM_SOURCE";

export type SourceDayHint = {
  dayIndex: number;
  title?: string;
  details?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
};

export type RecurringSourceRoutineHint = {
  cadence: "morning" | "evening" | "daily";
  startDayIndex: number;
  endDayIndex: number;
  title: string;
  details: string;
  startTime?: string;
  endTime?: string;
};

export type SourceBackedOverview = {
  title: string;
  summary: string;
};

export type SparsePromptDomain =
  | "skincare"
  | "medu_neter"
  | "martial_arts"
  | "fitness"
  | "study"
  | "project"
  | "finance"
  | "meal"
  | "music"
  | "practice"
  | "general";

export type SparsePromptRoutineNote = {
  day_index: number;
  title: string;
  details: string;
  all_day: boolean;
  start_time: string;
  end_time: string;
  location?: string | null;
};

export type StructuredSourceFlowNote = {
  day_index: number;
  title: string;
  details: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  location?: string | null;
};

export type YoutubeChannelVideoResource = {
  title: string;
  url: string;
  videoId?: string | null;
};

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const DAY_MARKER_RE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[-*•]\s*)?(?:\*\*)?\s*day\s+(\d{1,3})\s*[:\-–—]\s*(.+?)(?:\*\*)?\s*(?=\n|$)/gi;
const RECURRING_ROUTINE_MARKER_RE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[-*•]\s*)?(?:\*\*)?\s*((?:every\s+(morning|evening|night|day))|(?:daily\s+routine))\b([^\n]*)(?:\*\*)?\s*(?=\n|$)/gi;
const YOUTUBE_URL_RE =
  /\b(?:https?:\/\/|www\.)?(?:m\.)?(?:youtube\.com|youtu\.be)\/[^\s<>()]+/gi;
const YOUTUBE_URL_LIKE_RE =
  /(?:https?:\/\/|www\.)?(?:m\.)?(?:youtube\.com|youtu\.be)\//i;
const YOUTUBE_CHANNEL_URL_RE =
  /\b(?:https?:\/\/|www\.)?(?:m\.)?youtube\.com\/(?:@[\w.-]+|channel\/[A-Za-z0-9_-]+|c\/[^\s<>()]+|user\/[^\s<>()]+)(?:[^\s<>()]*)?/i;
const GLOBAL_AFTER_WATCHING_SENTENCE_RE =
  /\bafter\s+watching,?\s+(?:ask\s+)?(?:the\s+)?(?:kids?\s+to\s+)?(?:say\s+or\s+write|write\s+or\s+say|say|write)\s+(?:one\s+)?sentence\s*:\s*["“]([^"”\n]+)["”]/i;
const GLOBAL_AFTER_WATCHING_LINE_RE =
  /\bafter\s+watching,?\s+(?:ask\s+)?(?:the\s+)?(?:kids?\s+to\s+)?(?:say\s+or\s+write|write\s+or\s+say|say|write)\s+(?:one\s+)?sentence\s*:\s*([^\n]+)/i;
const GLOBAL_LESSON_REFLECTION_SENTENCE_RE =
  /\bafter\s+each\s+(?:lesson|video|day),?\s+(?:ask\s+)?(?:the\s+)?(?:kids?\s+to\s+)?(?:answer|say|write|say\s+or\s+write|write\s+or\s+say)\s+(?:one\s+)?(?:short\s+)?reflection\s*:\s*["“]([^"”\n]+)["”]/i;
const GLOBAL_LESSON_REFLECTION_LINE_RE =
  /\bafter\s+each\s+(?:lesson|video|day),?\s+(?:ask\s+)?(?:the\s+)?(?:kids?\s+to\s+)?(?:answer|say|write|say\s+or\s+write|write\s+or\s+say)\s+(?:one\s+)?(?:short\s+)?reflection\s*:\s*([^\n]+)/i;
const MEAL_FLOW_KEYWORD_RE =
  /\b(meal(?:\s*plan)?|meals|nutrition|diet|recipes?|menu|meal prep|food|foods|breakfast|lunch|dinner|snack|ingredients)\b/i;
const MEAL_FOOD_SIGNAL_RE =
  /\b(protein|fiber|healthy fats?|carbs?|vegetables|fruits?|hydration|omega-3|micronutrient|kefir|yogurt|eggs|salmon|sardines|beef|bison|avocado|oats|rice|quinoa|chia|flax)\b/i;
const MEAL_PLAN_INTENT_RE =
  /\b(meal\s*plan|meal\s*prep|plan(?:ning)?\s+meals?|nutrition\s+(?:flow|plan|program|routine)|diet\s+(?:plan|flow|program)|menu|recipes?|(?:breakfast|lunch|dinner|snack)s?\s+(?:plan|flow|menu|recipes?)|(?:plan|schedule|make|create|build|generate)\s+(?:breakfast|lunch|dinner|snack)s?)\b/i;
const NON_MEAL_REGIMEN_CORE_RE =
  /\b(skin\s*care|skincare|skin\s+routine|product\s+stack|cleanser|moisturizer|sunscreen|adapalene|azelaic|salicylic|retinoid|under-eye|vaseline|barrier|pigment|puffiness|jawline|posture|workout|kung\s*fu|wushu|shaolin|wing\s*chun|martial\s+arts?|karate|taekwondo|muay\s*thai|kickboxing|boxing|judo|jiu\s*jitsu|bjj|decan\s+routine|night\s+routine)\b/i;
const THREE_MEAL_DAILY_RE =
  /\b(?:3|three)\s+(?:daily\s+)?meals?\b|\bmeal\s*1\b[\s\S]{0,160}\bmeal\s*2\b[\s\S]{0,160}\bmeal\s*3\b|\bbreakfast\b[\s\S]{0,200}\blunch\b[\s\S]{0,200}\bdinner\b/i;
const LIMITED_MEAL_SCOPE_RE =
  /\b(?:one|1|two|2)\s+meals?\b|\b(?:breakfast|lunch|dinner|snack)s?\s+only\b|\bdinners?\s+only\b|\blunches?\s+only\b|\bbreakfasts?\s+only\b/i;
const PROJECT_FLOW_KEYWORD_RE =
  /\b(build|install|repair|fix|replace|assemble|renovate|remodel|rewire|wire|electrical|plumbing|paint|diy|home project|house project|room project|garage project|car|vehicle|engine|transmission|brakes?|diagnose|diagnostic|inspection|troubleshoot|maintenance|part(?:s)?|materials?|tools?|supplies|measure(?:ment)?|quote|estimate|contractor|contractors|greenhouse|shed|garden bed|closet greenhouse)\b/i;
const PROJECT_FLOW_STRUCTURE_RE =
  /\b(materials?|tools?|parts?|supplies|what to do|steps?|measure|diagnose|inspect|call|compare|gather|buy|install|test|verify|checklist|prep|layout|cut list|shopping list|quote comparison)\b/i;
const SPARSE_PROJECT_OBJECT_RE =
  /\b(?:side\s+project|home\s+project|house\s+project|room\s+project|project|app|website|prototype|mvp|business|home|garage|car|vehicle|greenhouse|shed|garden|repair|install|renovate)\b/i;
const FINANCE_FLOW_KEYWORD_RE =
  /\b(budget|budgeting|loan|lender|mortgage|apr|interest rate|payment|payments|income|expense|expenses|spending|cash flow|bills?|subscriptions?|debt|debts|savings?|save money|credit|credit score|bank|banking|refinance|quote|quotes|estimate|estimates|insurance|tax(?:es)?|application|approval|pre-approval|down payment|payoff|repayment)\b/i;
const FINANCE_FLOW_STRUCTURE_RE =
  /\b(statement|pay stub|bank statement|credit report|monthly payment|debt-to-income|rate sheet|application|approval|pre-approval|call the bank|compare rates|gather documents|budget categories|monthly budget|line items|interest cost|loan terms|underwriting)\b/i;
const REGIMEN_FLOW_KEYWORD_RE =
  /\b(workout|training|routine|habit|practice|study|studying|learn|learning|improve|improvement|discipline|character|personal growth|self improvement|spirituality|spiritual practice|prayer|skill|skills|master|mastery|rehab|therapy exercises?|conditioning|meal plan|nutrition|mobility|stretch|meditation|skin care|skincare|hair care|recovery|fitness|kung\s*fu|wushu|shaolin|wing\s*chun|martial\s+arts?|karate|taekwondo|muay\s*thai|kickboxing|boxing|judo|jiu\s*jitsu|bjj|journal practice|shoulder|back|chest|legs?|glutes?|arms?|biceps?|triceps?|core|abs?|hip|hips|knee|knees|ankle|ankles|neck)\b/i;
const SKINCARE_PROMPT_RE =
  /\b(?:skin\s*care|skincare|skin\s+routine|face\s+routine|acne|dark marks?|hyperpigmentation|moisturizer|cleanser|sunscreen|retinoid|retinol|adapalene|azelaic|salicylic|under-eye|puffiness)\b/i;
const MARTIAL_ARTS_PROMPT_RE =
  /\b(?:kung\s*fu|wushu|shaolin|wing\s*chun|tai\s*chi|taiji|martial\s+arts?|karate|taekwondo|muay\s*thai|kickboxing|boxing|judo|jiu\s*jitsu|bjj)\b/i;
const KUNG_FU_PROMPT_RE =
  /\b(?:kung\s*fu|wushu|shaolin|wing\s*chun|tai\s*chi|taiji)\b/i;
const FITNESS_PROMPT_RE =
  /\b(?:workout|fitness|training|gym|strength|cardio|running|run|mobility|flexibility|stretch|stretching|conditioning|lift|lifting|yoga|pilates|bodyweight|circulation|blood\s*flow|blood|lower\s+body|legs?|hips?|hamstrings?|calves?|ankles?|core|abs?|abdominal|stomach|belly|gut|waist|definition|defined|six[-\s]?pack|body\s*composition|fat\s*loss)\b/i;
const STUDY_PROMPT_RE =
  /\b(?:study|studying|learn|learning|calculus|math|physics|chemistry|biology|history|language|exam|quiz|homework|flashcards?|derivatives?|algebra|vocabulary)\b/i;
const MEDU_NETER_PROMPT_RE =
  /\b(?:medu\s+neter|mdw\s*n(?:t|ṯ)r|metu\s+neter|hieroglyphs?|hieroglyphics?|kemetic\s+(?:writing|language|script)|egyptian\s+(?:writing|hieroglyphs?|language))\b/i;
const PRACTICE_PROMPT_RE =
  /\b(?:practice|guit[ae]r|guidar|bass|piano|keys?|drums?|voice|singing|song|riff|chords?|solo|strumming|drawing|writing|coding|programming|meditation|journaling)\b/i;
const MUSIC_PROMPT_RE =
  /\b(?:guit[ae]r|guidar|bass|piano|keys?|drums?|voice|singing|song|riff|chords?|solo|strumming|tab|tabs?|tuning|bpm|metronome)\b/i;
const NAMED_SONG_PROMPT_RE =
  /\b(?:learn|play|practice|cover|perform)\b[\s\S]{0,80}\b(?:by|from)\b[\s\S]{0,80}\b(?:on|with|for)?\s*(?:electric\s+)?(?:guit[ae]r|guidar|bass|piano|keys?|drums?|voice|singing)?\b/i;
const SYNTHESIS_SOURCE_KEYWORD_RE =
  /\b(journal|journal entries|brain dump|stream of consciousness|book|chapter|essay|transcript|conversation|chat|voice memo|personal notes|reflection)\b/i;
const TRANSFORM_CUE_RE =
  /(turn|make|convert|transform|create|build|organize|map|distill|shape)\b[\s\S]{0,60}\b(flow|schedule|plan|roadmap|program)\b/i;
const CONVERSATION_DUMP_RE =
  /(?:^|\n)\s*(?:user|assistant|me|them|speaker\s*\d+|q|a)\s*:/im;
const YOUTUBE_REQUEST_RE =
  /\b(?:with|include|add|use|find|give\s+me|need|want|show)\b[\s\S]{0,36}\b(?:real|relevant|actual|direct)?[\s\S]{0,18}\b(?:youtube|yt)\b[\s\S]{0,18}\b(?:links?|videos?)\b|\b(?:youtube|yt)\b[\s\S]{0,18}\b(?:links?|videos?)\b/i;
const YOUTUBE_CHANNEL_FLOW_REQUEST_RE =
  /\b(?:visit|use|from|pull\s+from|arrange|order)\b[\s\S]{0,120}\byoutube\s+channel\b|\byoutube\s+channel\b[\s\S]{0,180}\b(?:flow|one\s+video\s+per\s+day|watch|links?|videos?|shorts?)\b/i;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const GENERIC_LOCATION_VALUE_RE =
  /^(?:study materials open|training space ready|open your budget\/docs workspace|project workspace and current deliverable visible|quiet place with your practice cue visible|desk clear and the required document open|kitchen or prep space ready|the place where this task normally happens)$/i;
const GENERIC_LOCATION_CUE_RE =
  /\b(?:workspace|materials?|document|deliverable|cue|prep space|training space)\b[\s\S]{0,40}\b(?:open|ready|visible|clear)\b/i;
const TRAILING_GLOBAL_SOURCE_SECTION_RE =
  /(?:^|\n)\s*(?:---\s*\n+)?\s*#{1,2}\s+(?:diet\s+rules?|daily\s+non-negotiables|under-eye\/bloating\s+rules?|what\s+i\s+would\s+not\s+do\s+yet|product\s+buy\s+list|the\s+exact\s+bad\s+combinations|what\s+success\s+should\s+look\s+like)\b/i;
const LEADING_SOURCE_SHORTCUT_LINE_RE =
  /^\s*(?:(?:repeat|same\s+as|see|use|follow)\s+(?:day\s+\d{1,3}|the\s+previous\s+day|the\s+prior\s+day)|morning\s+routine\s+as\s+usual)\.?\s*(?:\n+|$)/i;
const INTERNAL_VISIBLE_DAY_ZERO_RE = /\bday\s*0\b/i;
const EXPLICIT_VISIBLE_REPEAT_DAY_RE =
  /\b(?:repeat|copy|redo|reuse|follow|use|do|see|refer(?:\s+back)?\s+to|same(?:\s+(?:routine|plan|session|steps?|instructions?))?\s+(?:as|from))\b[\s\S]{0,140}\bday\s*(\d{1,3})\b/i;
const RELATIVE_VISIBLE_REPEAT_RE =
  /\b(?:repeat|copy|redo|reuse|follow|use|do|see|refer(?:\s+back)?\s+to|same(?:\s+(?:routine|plan|session|steps?|instructions?))?\s+(?:as|from))\b[\s\S]{0,100}\b(?:above|previous|prior|last|yesterday(?:'s)?)\b/i;
const SAME_AS_ABOVE_RE = /\b(?:same\s+as\s+above|as\s+above|see\s+above)\b/i;
const MORNING_ROUTINE_AS_USUAL_RE = /\bmorning\s+routine\s+as\s+usual\b/i;
const VISIBLE_NUMBERED_INSTRUCTION_LINE_RE =
  /^\s*(?:\d{1,2}[\.)]|step\s+\d{1,2}\s*[:.)\-–—])\s+/gim;
const VISIBLE_REPEAT_CLEANUP_PATTERNS = [
  /\b(?:repeat|copy|redo|reuse|follow|use|do|see|refer(?:\s+back)?\s+to|same(?:\s+(?:routine|plan|session|steps?|instructions?))?\s+(?:as|from))\b[^.!?\n]*(?:day\s*\d{1,3}|above|previous|prior|last|yesterday(?:'s)?)[^.!?\n]*[.!?]?\s*/gi,
  /\b(?:same\s+as\s+above|as\s+above|see\s+above)\b[.!?]?\s*/gi,
  /\bmorning\s+routine\s+as\s+usual\b[.!?]?\s*/gi,
  /\b(?:ensure|remember|make\s+sure)\b[^.!?\n]*\bas\s+instructed\b[^.!?\n]*[.!?]?\s*/gi,
];
const SOURCE_HINT_EXPLICIT_REPEAT_DAY_RE =
  /^\s*(?:repeat|copy|redo|reuse|follow|use|do|see|same(?:\s+(?:routine|plan|session|steps?|instructions?))?\s+(?:as|from))\b[\s\S]{0,100}\bday\s*(\d{1,3})\b/i;
const DETAIL_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "then",
  "only",
  "your",
  "this",
  "that",
  "routine",
  "night",
  "morning",
  "apply",
  "use",
]);

const GENERIC_ALWAYS_BAD_ACTION_PLACEHOLDER_PATTERNS: Array<
  [RegExp, string]
> = [
  [
    /\bdynamic\s+stretching\b/i,
    "names a category instead of the actual warm-up movements",
  ],
  [
    /\bbasic\s+stances\b/i,
    "says basic stances instead of naming the stance work",
  ],
  [
    /\bspecific\s+(?:(?:[a-z]+)\s+){0,3}(?:techniques?|drills?|exercises?|movements?|activities?|practices?|tasks?|steps?)\b/i,
    "says specific work without naming the work",
  ],
  [
    /\b(?:relevant|appropriate|various)\s+(?:techniques?|drills?|exercises?|movements?|activities?|practices?|tasks?|steps?|materials?|resources?)\b/i,
    "uses a placeholder category instead of concrete examples",
  ],
  [
    /\bas\s+instructed\b/i,
    "points to unstated instructions",
  ],
];

const CONCRETE_SPECIFICITY_SIGNAL_RE =
  /\b(?:\d+\s*(?:minutes?|seconds?|hours?|sets?|reps?|rounds?|passes?|pages?|sentences?|emails?|calls?|items?|meals?|cups?|grams?|ounces?|steps?)|ankle circles?|knee circles?|hip circles?|leg swings?|cossack squats?|deep squat|brisk walk|march(?:ing)? in place|jumping jacks?|inchworms?|arm circles?|cat-?cow|bird dogs?|dead bugs?|glute bridges?|bodyweight squats?|reverse lunges?|plank walkouts?|mountain climbers?|hollow holds?|side planks?|horse stance|bow stance|empty stance|drop stance|straight punch|front kick|snap kick|crescent kicks?|squats?|lunges?|push-?ups?|planks?|eggs?|salmon|oats|rice|beans?|lentils?|tofu|chicken|yogurt|broccoli|kiwi|berries|cleanser|moisturizer|sunscreen|adapalene|azelaic|journal prompt|breath count|script|draft|outline|spreadsheet|budget|invoice|email|file|prototype|checklist|metric|photo|measurement|decision)\b/i;
const WARM_UP_SPECIFICITY_SIGNAL_RE =
  /\b(?:ankle circles?|knee circles?|hip circles?|leg swings?|cossack squats?|deep squat|brisk walk|march(?:ing)? in place|jumping jacks?|inchworms?|arm circles?|shoulder circles?|wrist circles?|cat-?cow|bird dogs?|dead bugs?|glute bridges?|bodyweight squats?|reverse lunges?|plank walkouts?|mountain climbers?|high knees?|butt kicks?)\b/i;
const MUSIC_CHORD_SPECIFICITY_SIGNAL_RE =
  /\b(?:[A-G](?:#|b)?(?:maj7|maj|min7|min|m7|m|sus2|sus4|dim|aug|add9|7|9|11|13)?)(?:\s*(?:-|->|→|to|into|back\s+to|\/|,|and)\s*(?:[A-G](?:#|b)?(?:maj7|maj|min7|min|m7|m|sus2|sus4|dim|aug|add9|7|9|11|13)?)){1,}\b/i;
const MUSIC_RIFF_SPECIFICITY_SIGNAL_RE =
  /\b(?:\d+(?:-\d+){1,}|fret|frets|string|strings|tab|double-stop|bend|slide|hammer-on|pull-off|vibrato|e\||B\||G\||D\||A\||E\||[0-9]:[0-5][0-9])\b/i;
const MUSIC_RHYTHM_SPECIFICITY_SIGNAL_RE =
  /\b(?:downstroke|upstroke|down-up|DUDU|eighth-note|sixteenth-note|swing|shuffle|muted|palm-muted|accent|backbeat|syncopation|straight eighths?)\b/i;
const MUSIC_STRUCTURE_SPECIFICITY_SIGNAL_RE =
  /\b(?:intro|verse|chorus|bridge|solo|outro)\b[\s\S]{0,90}(?:->|→|then|into|after|back to)[\s\S]{0,90}\b(?:intro|verse|chorus|bridge|solo|outro)\b/i;
const MUSIC_TUNING_SPECIFICITY_SIGNAL_RE =
  /\b(?:E\s*[- ]\s*A\s*[- ]\s*D\s*[- ]\s*G\s*[- ]\s*B\s*[- ]\s*E|EADGBE|lowest\s+to\s+highest|low\s+E|high\s+E)\b/i;
const MUSIC_MAP_SPECIFICITY_SIGNAL_RE =
  /\b(?:tuning|tempo|BPM|key|chords?|section|intro|verse|bridge|chorus|outro|timestamp|timecode|landmarks?)\b/i;
const EGYPTIAN_HIEROGLYPH_RE = /[\u{13000}-\u{1342F}]/u;
const REFERENTIAL_SET_PLACEHOLDER_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(?:first|next|top|initial|starter)\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\s+(?:hieroglyphs?|glyphs?|symbols?|signs?|verbs?|vocabulary|words?|phrases?|sentences?|terms?|examples?|problems?|questions?|cases?|topics?|themes?|facts?|rules?|forms?|chords?|riffs?|sections?|stretches?|exercises?|movements?|techniques?|drills?|concepts?|principles?|patterns?|figures?|people|texts?|sources?)\b/i,
    "references a numbered set without naming the items",
  ],
  [
    /\b(?:basic|common|important|key|core|main|foundational|starter|essential|relevant|appropriate)\s+(?:hieroglyphs?|glyphs?|symbols?|signs?|verbs?|vocabulary|words?|phrases?|sentences?|terms?|examples?|problems?|questions?|cases?|topics?|themes?|facts?|rules?|forms?|chords?|riffs?|sections?|stretches?|exercises?|movements?|techniques?|drills?|concepts?|principles?|patterns?|figures?|people|texts?|sources?|resources?|materials?|historical\s+figures?|cultural\s+figures?)\b/i,
    "references a set without naming the items",
  ],
  [
    /\b(?:the|your)\s+(?:glyph|sign|verb|word|phrase|term|chord|stretch|exercise|movement|technique|concept|principle|section|topic|example|problem|resource|material)\s+(?:set|list|group)\b/i,
    "references an item set without showing the set",
  ],
  [
    /\b(?:use|find|consult|look\s+up|search\s+for|watch|read|listen\s+to)\s+(?:a|an|some|any|the)?\s*(?:audio|online|outside|external|reference|tutorial|video|learning)?\s*(?:resources?|materials?|videos?|tutorials?|reference\s+books?|articles?|guides?)\b/i,
    "points to unnamed resources instead of giving usable material",
  ],
];

const GENERIC_CONDITIONAL_ACTION_PLACEHOLDER_PATTERNS: Array<
  [RegExp, string, RegExp]
> = [
  [
    /\b(?:healthy|balanced|nutritious)\s+(?:meals?|foods?|snacks?|diet)\b/i,
    "food guidance needs named foods or prep steps",
    /\b(?:eggs?|spinach|oats?|salmon|sardines|chicken|turkey|beef|lentils?|beans?|tofu|yogurt|berries|kiwi|orange|broccoli|rice|sweet potatoes?|avocado|nuts?|olive oil|prep|cook|pack|slice|bake|grill|portion)\b/i,
  ],
  [
    /\b(?:self-care|spiritual|mindfulness|character development|personal growth)\s+(?:activities|exercises|practices|tasks)\b/i,
    "inner-work guidance needs a concrete practice, script, or prompt",
    /\b(?:breath|breathing|journal prompt|write|script|say|ask|gratitude|prayer|mantra|visualize|pause|listen|apologize|follow-up question|scenario|trigger|evidence)\b/i,
  ],
  [
    /\b(?:work on|focus on|make progress on|spend time on)\s+(?:your|the)\s+(?:project|goal|habit|routine|skill|priorities|career|business)\b/i,
    "goal guidance needs a concrete artifact, decision, message, or metric",
    /\b(?:draft|outline|file|spreadsheet|budget|invoice|email|message|call|prototype|wireframe|landing page|repo|commit|pull request|document|deck|slide|checklist|metric|measurement|decision|preview link|calendar block)\b/i,
  ],
  [
    /\b(?:review|study|practice)\s+(?:the\s+)?(?:basics|materials?|content|concepts?|skills?)\b/i,
    "learning guidance needs named recall, examples, prompts, or outputs",
    /\b(?:recall|self-quiz|teach back|worked example|toy example|define|compare|solve|correct|mistake|flashcard|write|explain|question|output)\b/i,
  ],
  [
    /\b(?:do|perform|complete|choose)\s+(?:some|a few|several|a set of)?\s*(?:exercises?|drills?|activities?|tasks?)\b/i,
    "action guidance needs the actual exercise, drill, activity, or task",
    CONCRETE_SPECIFICITY_SIGNAL_RE,
  ],
  [
    /\b(?:warm\s*up|warm-up)\b/i,
    "warm-up guidance needs named movements",
    WARM_UP_SPECIFICITY_SIGNAL_RE,
  ],
  [
    /\b(?:intro|main|lead|solo)\s+riff\b/i,
    "riff guidance needs fret, string, tab, timestamp, or technique anchors",
    MUSIC_RIFF_SPECIFICITY_SIGNAL_RE,
  ],
  [
    /\b(?:verse|chorus|bridge|song)?\s*chords?\b|\bchord\s+progression\b/i,
    "song chord guidance needs the actual chord names",
    MUSIC_CHORD_SPECIFICITY_SIGNAL_RE,
  ],
  [
    /\bstrumming\s+patterns?\b/i,
    "rhythm guidance needs a named strum, accent, mute, or subdivision",
    MUSIC_RHYTHM_SPECIFICITY_SIGNAL_RE,
  ],
  [
    /\bsong\s+structure\b/i,
    "song-structure guidance needs the actual section order",
    MUSIC_STRUCTURE_SPECIFICITY_SIGNAL_RE,
  ],
  [
    /\bstandard\s+tuning\b/i,
    "standard tuning needs string names for novice users",
    MUSIC_TUNING_SPECIFICITY_SIGNAL_RE,
  ],
  [
    /\b(?:one-page\s+)?song\s+(?:map|chart)\b|\bone-page\s+(?:music\s+)?(?:map|chart)\b|\b(?:map|chart)\b(?=[\s\S]{0,80}\b(?:song|verse|chorus|bridge|riff|chords?|strumming?))/i,
    "song map guidance needs the map contents",
    MUSIC_MAP_SPECIFICITY_SIGNAL_RE,
  ],
];

function normalizeWhitespace(text: string): string {
  return (text ?? "").replace(/\r/g, "").trim();
}

function hasConcreteNamedItemEvidence(text: string): boolean {
  if (EGYPTIAN_HIEROGLYPH_RE.test(text)) return true;
  if (MUSIC_CHORD_SPECIFICITY_SIGNAL_RE.test(text)) return true;
  if (MUSIC_RIFF_SPECIFICITY_SIGNAL_RE.test(text)) return true;
  if (MUSIC_STRUCTURE_SPECIFICITY_SIGNAL_RE.test(text)) return true;
  if (WARM_UP_SPECIFICITY_SIGNAL_RE.test(text)) return true;
  if (/\bhttps?:\/\//i.test(text)) return true;
  if (
    /\b(?:ser|estar|tener|hacer|ir|venir|hablar|comer|vivir|yo|tu|tú|usted|nosotros|ellos)\b/i
      .test(text)
  ) {
    return true;
  }
  if (
    /\b(?:voltage|current|resistance|ohm'?s law|kirchhoff|capacitor|inductor|diode|transistor|circuit)\b/i
      .test(text)
  ) {
    return true;
  }
  if (
    /\b(?:plank|squat|lunge|push-up|dead bug|bird dog|glute bridge|cat-cow|leg swing|hip circle|horse stance|bow stance)\b/i
      .test(text)
  ) {
    return true;
  }

  const colonTail = text.match(/[:：]\s*([^.!?\n]{12,260})/);
  if (
    colonTail?.[1] &&
    /(?:[,;=]|\band\b|->|→)/i.test(colonTail[1]) &&
    /\b[\p{L}\d][\p{L}\d'’-]{1,}\b/u.test(colonTail[1])
  ) {
    return true;
  }

  return /\b(?:these|the following)\b[\s\S]{0,80}(?:[,;=]|:|are)\b/i.test(
    text,
  );
}

function sentenceAroundMatch(text: string, matchIndex: number): string {
  const safeIndex = Math.max(0, Math.min(matchIndex, text.length));
  const before = text.slice(0, safeIndex);
  const after = text.slice(safeIndex);
  const start = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("?"),
    before.lastIndexOf("!"),
    before.lastIndexOf("\n"),
  );
  const endCandidates = [
    after.indexOf("."),
    after.indexOf("?"),
    after.indexOf("!"),
  ]
    .filter((value) => value >= 0);
  const endOffset = endCandidates.length > 0 ? Math.min(...endCandidates) : -1;
  const end = endOffset >= 0 ? safeIndex + endOffset + 1 : text.length;
  return text.slice(start + 1, end).trim();
}

function isReflectiveQuestionContext(
  text: string,
  matchIndex: number,
): boolean {
  const sentence = sentenceAroundMatch(text, matchIndex);
  return /\?/.test(sentence) ||
    /\b(?:think\s+about|reflection|reflect|prompt|answer)\s*:/i.test(
      sentence,
    ) ||
    /\bafter\s+watching\b/i.test(sentence);
}

function findReferentialCompletenessIssue(text: string): string | null {
  for (const [pattern, reason] of REFERENTIAL_SET_PLACEHOLDER_PATTERNS) {
    const match = text.match(pattern);
    if (
      match &&
      !hasConcreteNamedItemEvidence(text) &&
      !isReflectiveQuestionContext(text, match.index ?? 0)
    ) {
      return `${reason}: "${match[0]}"`;
    }
  }
  return null;
}

export function buildConcreteActionDefaultsRule(): string {
  return `CONCRETE_ACTION_DEFAULTS_RULE:
- A note is not useful if it only names a category. Whenever you write a category such as warm-up, stretch, exercise, drill, technique, meal, spiritual practice, self-care activity, habit, project work, study, research, or reflection, immediately name the actual movements, foods, scripts, files, artifacts, prompts, decisions, metrics, or examples the user should use.
- Sparse prompts still deserve domain-standard defaults. For exercise, name movements plus sets/reps/time. For diet, name meals/foods plus prep. For spirituality or character work, name the practice, words/prompt, situation, and evidence. For hobbies, name the drill/material/output. For habits and goals, name the trigger, smallest action, recovery path, and metric. For side projects or work goals, name the artifact, file, message, decision, or verification step.
- For music, name chords, tuning, tempo, section order, riff/fret or timestamp anchors, rhythm feel, tone settings, or the exact recorded pass to check.
- For writing systems, scripts, language drills, and symbolic systems, do not reference a set such as "first ten signs", "common verbs", "basic symbols", or "key terms" unless the same note names the actual signs, verbs, symbols, or terms.
- For study, history, hobbies, technical learning, and broad personal goals, never stop at "key concepts", "main topics", "important figures", "basic vocabulary", "first examples", or unnamed "resources". Name the concepts, topics, people, vocabulary, examples, or resources in the event itself.
- Do not write placeholders like "dynamic stretching", "basic exercises", "specific techniques", "healthy meal", "self-care activities", "work on your project", "review the basics", "intro riff", "verse chords", "chord progression", "song structure", "strumming pattern", or "as instructed" unless the same sentence immediately replaces the placeholder with concrete examples and done criteria.`;
}

export function buildNoviceClarityRule(): string {
  return `NOVICE_CLARITY_RULE:
- Assume the user is a capable beginner unless they explicitly ask for advanced, terse, expert, or professional-level instructions.
- When a note introduces a technical term, setup convention, artifact, or shorthand, define it in plain language or give the exact contents the user should see. Examples: "standard tuning" should include E-A-D-G-B-E; a "song map" should say what lines to write on the page; a "circuit" should name the exercises; a "budget review" should name the numbers or documents.
- Do not overload the user with a glossary. Add only the one sentence or phrase needed to make that day's action doable without separate research.
- Keep the expert content, but translate the first encounter with domain shorthand into beginner-readable instructions.`;
}

export function buildEventDetailDensityRule(): string {
  return `EVENT_DETAIL_DENSITY_RULE:
- Keep each visible event centered on one primary job. A strong event usually has one main action, one or two supporting sub-actions, and one short done/adjustment sentence.
- If useful work would require more than three concrete actions, spread it across another note or another day instead of packing the details field.
- Do not dumb the work down. Keep the expert guidance, but choose the smallest complete chunk the user can act on now.
- For learning flows, handle one concept or skill chunk per event: a foothold, one worked example or recall prompt, and one check. Do not combine a mini-lecture, reading assignment, quiz, lab, project, and reflection in the same event.`;
}

function sparsePromptTopicTitle(
  description: string | null | undefined,
): string {
  const cleaned = normalizeWhitespace(description ?? "")
    .replace(/\b\d+\s*(?:day|week|month)s?\b/gi, " ")
    .replace(
      /\b(?:turn|make|create|build|generate|give|help|me|my|this|into|a|an|the|flow|plan|routine|program|schedule|for|to|learn|learning|study|studying|practice|practicing|improve|improving)\b/gi,
      " ",
    )
    .replace(/[^\w\s&/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const topic = cleaned || "Starter";
  const smallWords = new Set(["and", "or", "of", "for", "in", "on", "at"]);
  return topic
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function overviewDayCount(
  description: string | null | undefined,
  sourceText: string | null | undefined,
  dateRangeDays?: number,
): number {
  if (
    typeof dateRangeDays === "number" &&
    Number.isFinite(dateRangeDays) &&
    dateRangeDays > 0
  ) {
    return Math.floor(dateRangeDays);
  }

  const text = normalizeWhitespace(
    [description ?? "", sourceText ?? ""].filter(Boolean).join("\n"),
  );
  const explicit = text.match(/\b(\d{1,3})\s*[- ]?days?\b/i);
  if (explicit?.[1]) {
    const days = parseInt(explicit[1], 10);
    if (Number.isFinite(days) && days > 0) return days;
  }

  return 10;
}

function dayFlowLabel(dayCount: number): string {
  return `${dayCount}-Day`;
}

function dayFlowLabelLower(dayCount: number): string {
  return `${dayCount}-day`;
}

function looksLikeSpanishConjugationPrompt(text: string): boolean {
  return /\b(?:spanish|espanol|espa[ñn]ol)\b/i.test(text) &&
    /\b(?:conjugat(?:e|ion|ions|ing)?|verb\s+(?:endings?|forms?)|verbs?)\b/i
      .test(text);
}

function looksLikeLowerBodyCirculationFlexibilityPrompt(text: string): boolean {
  return /\b(?:lower\s+body|legs?|hips?|hamstrings?|calves?|ankles?)\b/i
    .test(text) &&
    /\b(?:blood|blood\s*flow|circulation|flexibility|mobility|stretch(?:ing)?|range\s+of\s+motion)\b/i
      .test(text);
}

function looksLikeCoreDefinitionPrompt(text: string): boolean {
  return /\b(?:core|abs?|abdominal|stomach|belly|gut|waist|six[-\s]?pack)\b/i
    .test(text) &&
    /\b(?:definition|defined|flatten|flat|tighten|tone|body\s*composition|fat\s*loss)\b/i
      .test(text);
}

function looksLikeNamedSongInstrumentPrompt(text: string): boolean {
  return MUSIC_PROMPT_RE.test(text) && NAMED_SONG_PROMPT_RE.test(text);
}

function looksLikeBeyondThe7thSkyGuitarPrompt(text: string): boolean {
  return /\bbeyond\s+(?:the\s+)?(?:7th|seventh)\s+sky\b/i.test(text) &&
    /\b(?:kravitz|leny|lenny)\b/i.test(text) &&
    /\b(?:guit[ae]r|guidar)\b/i.test(text);
}

function songPracticeTopicTitle(
  description: string | null | undefined,
): string {
  const text = normalizeWhitespace(description ?? "");
  const byMatch = text.match(
    /\b(?:learn|play|practice|cover|perform)?(?:\s+to)?(?:\s+play)?\s*(.+?)\s+by\s+(.+?)(?:\s+on\s+.+)?$/i,
  );
  const rawTitle = byMatch?.[1] ?? text;
  const cleaned = rawTitle
    .replace(/\b(?:learn|to|play|practice|cover|perform)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sparsePromptTopicTitle(cleaned || description);
}

function musicOverviewForPrompt(
  description: string | null | undefined,
  dayCount: number,
): SourceBackedOverview {
  const text = normalizeWhitespace(description ?? "");
  const label = dayFlowLabel(dayCount);
  const lower = dayFlowLabelLower(dayCount);

  if (looksLikeBeyondThe7thSkyGuitarPrompt(text)) {
    return {
      title: `${label} Beyond the 7th Sky Electric Guitar Flow`,
      summary:
        `A ${lower} electric-guitar flow for Lenny Kravitz's "Beyond the 7th Sky" in standard tuning (E-A-D-G-B-E, lowest to highest), centered on key of A, about 130 BPM, and the main A, Am, and C chord movement. The plan builds from the intro section (0:00 to about 0:14) into the verse groove starting around 0:14, the bridge around 1:16, and the lead/outro material beginning around 3:00, ending with a recorded full-song pass.`,
    };
  }

  const topic = songPracticeTopicTitle(description);
  return {
    title: `${label} ${topic} Song Practice Flow`,
    summary:
      `A ${lower} song-learning flow for ${topic.toLowerCase()} that turns the tune into a playable chart, section map, and recorded checkpoints. The work starts by confirming tuning, key, tempo, chord movement, section order, and the hardest riff or transition before building toward a clean full-song pass.`,
  };
}

function spanishConjugationOverview(dayCount: number): SourceBackedOverview {
  const label = dayFlowLabel(dayCount);
  const lower = dayFlowLabelLower(dayCount);
  return {
    title: `${label} Spanish Conjugation Practice Flow`,
    summary:
      `A structured ${lower} Spanish conjugation flow for regular present-tense endings, quick recall, and short sentence practice.\n\n` +
      "Present-tense anchor (Latin American):\n" +
      "Pronoun | hablar | comer | vivir\n" +
      "yo | hablo | como | vivo\n" +
      "tu | hablas | comes | vives\n" +
      "el/ella/usted | habla | come | vive\n" +
      "nosotros | hablamos | comemos | vivimos\n" +
      "ellos/ustedes | hablan | comen | viven",
  };
}

function meduNeterOverview(dayCount: number): SourceBackedOverview {
  const label = dayFlowLabel(dayCount);
  const lower = dayFlowLabelLower(dayCount);
  return {
    title: `${label} Medu Neter Learning Flow`,
    summary:
      `A structured ${lower} beginner flow for Medu Neter, starting with ten uniliteral signs: reed leaf 𓇋 i/y, quail chick 𓅱 w/u, owl 𓅓 m, water ripple 𓈖 n, mouth 𓂋 r, stool 𓊪 p, foot 𓃀 b, basket handle 𓎡 k, bread loaf 𓏏 t, and hand 𓂧 d. Each day pairs copying, transliteration, reading direction, and a short self-quiz so the user can practice without hunting for the lesson material first.`,
  };
}

function fitnessOverviewForPrompt(
  description: string | null | undefined,
  dayCount: number,
): SourceBackedOverview {
  const text = normalizeWhitespace(description ?? "");
  const topic = sparsePromptTopicTitle(description);
  const label = dayFlowLabel(dayCount);
  const lower = dayFlowLabelLower(dayCount);

  if (looksLikeLowerBodyCirculationFlexibilityPrompt(text)) {
    return {
      title: `${label} Lower Body Circulation and Flexibility Flow`,
      summary:
        `A ${lower} lower-body mobility and circulation flow for hips, hamstrings, calves, ankles, and gentle leg drive. Start with 3-5 minutes of walking or marching, then use ankle circles, hip circles, leg swings, bodyweight squats, and easy calf raises before deeper holds. Keep stretches at a strong-but-breathable 5-7/10 and stop sharp pain; the target is warmer legs, easier range, and less stiffness after sitting or training.`,
    };
  }

  if (looksLikeCoreDefinitionPrompt(text)) {
    return {
      title: `${label} Core Definition Training Flow`,
      summary:
        `A ${lower} core-definition flow built around bracing, controlled trunk work, walking/cardio, and recovery rather than spot-fat-loss promises. Warm up with marching in place, hip circles, cat-cow, dead bugs, and glute bridges before harder core work. Track waist feel, posture, plank control, and consistency so definition has a real training base.`,
    };
  }

  return {
    title: `${label} ${topic} Training Flow`,
    summary:
      `A ${lower} training flow for ${topic.toLowerCase()} with named movements, measured effort, recovery cues, and short check-ins. Warm up with brisk walking or marching in place, hip circles, cat-cow, dead bugs, and glute bridges before harder work. Keep effort challenging but clean enough that tomorrow's session is still possible.`,
  };
}

function sparsePromptOverviewForDomain(
  description: string | null | undefined,
  domain: SparsePromptDomain,
  dayCount = 10,
): SourceBackedOverview {
  const topic = sparsePromptTopicTitle(description);
  const label = dayFlowLabel(dayCount);
  const lower = dayFlowLabelLower(dayCount);
  switch (domain) {
    case "study":
      return {
        title: `${label} ${topic} Learning Flow`,
        summary:
          `A structured ${lower} learning flow for ${topic.toLowerCase()}, with one concept chunk per event, short active practice, and evening review. The goal is usable understanding without overloading each session.`,
      };
    case "meal":
      return {
        title: `${label} ${topic} Meal Flow`,
        summary:
          `A structured ${lower} meal flow with concrete foods, simple prep, and enough variety to act without extra research. The goal is easier daily choices, steadier nutrition, and clear feedback on what works.`,
      };
    case "music":
      return musicOverviewForPrompt(description, dayCount);
    case "project":
      return {
        title: `${label} ${topic} Execution Flow`,
        summary:
          `A structured ${lower} execution flow for ${topic.toLowerCase()}, with each event focused on one artifact, decision, check, or next visible output. The goal is steady progress without overpacking the calendar.`,
      };
    case "fitness":
      return fitnessOverviewForPrompt(description, dayCount);
    case "practice":
      return {
        title: `${label} ${topic} Practice Flow`,
        summary:
          `A structured ${lower} practice flow for ${topic.toLowerCase()}, with focused drills, small applications, and evening review. The goal is visible improvement without turning each event into a long checklist.`,
      };
    default:
      return {
        title: `${label} ${topic} Flow`,
        summary:
          `A ${lower} flow for ${topic.toLowerCase()} with one useful action each day and a short review to carry the pattern forward. Keep the daily task narrow enough to finish, name the smallest version before starting, and end by writing the one observation that should shape tomorrow.`,
      };
  }
}

export function findUnderSpecifiedActionPlaceholder(
  text: string | null | undefined,
): string | null {
  const trimmed = normalizeWhitespace(text ?? "");
  if (!trimmed) return null;

  for (
    const [pattern, reason] of GENERIC_ALWAYS_BAD_ACTION_PLACEHOLDER_PATTERNS
  ) {
    const match = trimmed.match(pattern);
    if (match) return `${reason}: "${match[0]}"`;
  }

  const referentialIssue = findReferentialCompletenessIssue(trimmed);
  if (referentialIssue) return referentialIssue;

  for (
    const [pattern, reason, specificitySignal]
      of GENERIC_CONDITIONAL_ACTION_PLACEHOLDER_PATTERNS
  ) {
    const match = trimmed.match(pattern);
    if (match && !specificitySignal.test(trimmed)) {
      return `${reason}: "${match[0]}"`;
    }
  }

  return null;
}

export function hasUnderSpecifiedActionPlaceholder(
  text: string | null | undefined,
): boolean {
  return findUnderSpecifiedActionPlaceholder(text) !== null;
}

function splitParagraphBlocks(text: string): string[] {
  return normalizeWhitespace(text)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function dedupeParagraphBlocks(blocks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const block of blocks) {
    const key = block.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(block);
  }

  return out;
}

function parseMarkdownLinkDefinitions(text: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!text) return out;

  const matches = text.matchAll(
    /(?:^|\n)\s*\[([^\]]+)\]:\s*(https?:\/\/[^\s<>()]+)\s*(?=\n|$)/gi,
  );
  for (const match of matches) {
    const label = (match[1] ?? "").trim().toLowerCase();
    const url = stripTrailingUrlPunctuation(match[2] ?? "");
    if (!label || !url) continue;
    out.set(label, url);
  }
  return out;
}

function expandMarkdownLinks(
  text: string,
  defs: Map<string, string>,
): string {
  if (!text) return "";

  return text
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s<>()]+)\)/g,
      (_match, label, url) =>
        `${label.trim()} (${stripTrailingUrlPunctuation(url)})`,
    )
    .replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (_match, label, ref) => {
      const resolved = defs.get(String(ref).trim().toLowerCase());
      return resolved ? `${String(label).trim()} (${resolved})` : String(label);
    })
    .replace(
      /(?:^|\n)\s*\[([^\]]+)\]:\s*(https?:\/\/[^\s<>()]+)\s*(?=\n|$)/gi,
      "",
    );
}

function cleanSourceHintDetails(
  block: string,
  defs: Map<string, string>,
): string {
  if (!block) return "";

  const withoutHeading = block.replace(/^.*?(?:\n|$)/, "").trim();
  const trailingSection = withoutHeading.search(
    TRAILING_GLOBAL_SOURCE_SECTION_RE,
  );
  const dayScoped = trailingSection >= 0
    ? withoutHeading.slice(0, trailingSection).trim()
    : withoutHeading;
  const expanded = expandMarkdownLinks(dayScoped, defs);

  const cleaned = expanded
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/^\s*-{3,}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const withoutShortcut = cleaned.replace(LEADING_SOURCE_SHORTCUT_LINE_RE, "")
    .trim();
  return withoutShortcut || cleaned;
}

function extractSourceHintRepeatTargetDayIndex(
  block: string,
): number | null {
  const withoutHeading = block.replace(/^.*?(?:\n|$)/, "").trim();
  const match = withoutHeading.match(SOURCE_HINT_EXPLICIT_REPEAT_DAY_RE);
  if (!match?.[1]) return null;
  const dayNumber = parseInt(match[1], 10);
  if (!Number.isFinite(dayNumber) || dayNumber < 1) return null;
  return dayNumber - 1;
}

function detailTokens(text: string): Set<string> {
  const tokens: string[] = (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token: string) =>
      token.length >= 3 && !DETAIL_TOKEN_STOPWORDS.has(token)
    );
  return new Set(tokens);
}

function detailBlockMostlyCovered(block: string, source: string): boolean {
  const blockTokens = [...detailTokens(block)];
  if (blockTokens.length === 0) return true;
  const sourceTokens = detailTokens(source);
  const covered = blockTokens.filter((token) => sourceTokens.has(token)).length;
  return covered / blockTokens.length >= 0.7;
}

function mergeRepeatedSourceHintDetails(
  sourceDetails: string | null | undefined,
  residualDetails: string | null | undefined,
): string {
  const source = normalizeWhitespace(sourceDetails ?? "");
  const residual = stripUnsafeVisibleRepeatReferenceText(
    residualDetails ?? "",
  );
  if (!source) return residual;
  if (!residual) return source;

  const sourceKey = source.replace(/\s+/g, " ").toLowerCase();
  const residualBlocks = splitParagraphBlocks(residual).flatMap((block) => {
    const sentenceParts = block.split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    return sentenceParts.length > 1 ? sentenceParts : [block];
  });
  const extras = residualBlocks.filter((block) => {
    if (hasUnsafeVisibleRepeatReference(block)) return false;
    const blockKey = block.replace(/\s+/g, " ").toLowerCase();
    if (!blockKey || sourceKey.includes(blockKey)) return false;
    return !detailBlockMostlyCovered(block, source);
  });

  return dedupeParagraphBlocks([source, ...extras]).join("\n\n");
}

function parseRoutineDayRange(
  markerText: string,
  maxDays?: number,
): { startDayIndex: number; endDayIndex: number } | null {
  const cap = typeof maxDays === "number" && maxDays > 0 ? maxDays : 365;
  const rangeMatch = markerText.match(
    /\bdays?\s+(\d{1,3})\s*(?:[-–—]|to|through)\s*(\d{1,3})\b/i,
  );
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1] ?? "", 10);
    const endDay = parseInt(rangeMatch[2] ?? "", 10);
    if (
      Number.isFinite(startDay) && Number.isFinite(endDay) &&
      startDay >= 1 && endDay >= startDay
    ) {
      return {
        startDayIndex: Math.max(0, startDay - 1),
        endDayIndex: Math.min(cap - 1, endDay - 1),
      };
    }
  }

  if (typeof maxDays === "number" && maxDays > 0) {
    return { startDayIndex: 0, endDayIndex: maxDays - 1 };
  }

  return null;
}

function routineCadenceFromMarker(
  markerText: string,
): "morning" | "evening" | "daily" {
  if (/\bmorning\b/i.test(markerText)) return "morning";
  if (/\b(?:evening|night)\b/i.test(markerText)) return "evening";
  return "daily";
}

function routineTitleForCadence(
  cadence: "morning" | "evening" | "daily",
): string {
  if (cadence === "morning") return "Morning routine";
  if (cadence === "evening") return "Evening routine";
  return "Daily routine";
}

function routineTimeForCadence(
  cadence: "morning" | "evening" | "daily",
): { startTime?: string; endTime?: string } {
  if (cadence === "morning") return { startTime: "09:00", endTime: "09:30" };
  if (cadence === "evening") return { startTime: "20:00", endTime: "20:30" };
  return {};
}

export function sourceHintLooksEveningRoutine(hint: SourceDayHint): boolean {
  const text = `${hint.title ?? ""}\n${hint.details ?? ""}`.toLowerCase();
  return /\b(night|evening|bed|adapalene|azelaic|salicylic|vaseline|cleanse|moisturizer)\b/
    .test(text);
}

function sentenceCaseFragment(text: string): string {
  const clean = normalizeWhitespace(text)
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!clean) return "";
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

function joinInstructionItems(items: string[]): string {
  const clean = items.map((item) =>
    normalizeWhitespace(item)
      .replace(/^\s*[-*•]\s+/, "")
      .replace(/[.!?]+$/g, "")
      .trim()
  ).filter(Boolean).map((item, index) =>
    index > 0
      ? item.replace(
        /^(If|No|Pat|Let|Do|Stop|Apply|Wait|Use)\b/,
        (word) => word.toLowerCase(),
      )
      : item
  );
  if (clean.length <= 1) return clean.join("");
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function ensureSentence(text: string): string {
  const clean = normalizeWhitespace(text)
    .replace(/^\s*[-*•]\s+/, "")
    .trim();
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function proseLabel(label: string): string {
  const clean = normalizeWhitespace(label).replace(/:$/, "").toLowerCase();
  const stepMatch = clean.match(/^step\s+\d+\s*[-–—]\s*(.+)$/i);
  if (stepMatch?.[1]) return stepMatch[1].trim();
  if (clean === "night") return "At night";
  if (clean === "morning") return "In the morning";
  if (clean === "best option") return "Workout options";
  if (clean === "after sweating") return "After sweating";
  if (/today.?s food rule/.test(clean)) return "For the salt audit";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function proseFromInstructionBlock(block: string): string {
  const lines = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  const firstLineIsStepLabel = /^step\s+\d+\s*[-–—]\s*.+$/i.test(lines[0]);
  const label =
    lines.length > 1 && (firstLineIsStepLabel || /:\s*$/.test(lines[0]))
      ? lines[0].replace(/:\s*$/, "")
      : null;
  const bodyLines = label ? lines.slice(1) : lines;
  const items = bodyLines.map((line) => line.replace(/^\s*[-*•]\s+/, ""));

  if (label && items.length > 0) {
    const joined = joinInstructionItems(items);
    if (!joined) return "";
    const prefix = proseLabel(label);
    const lowerPrefix = prefix.toLowerCase();
    if (lowerPrefix === "rinse or cleanse") {
      return `Rinse or cleanse based on skin feel: ${joined}.`;
    }
    if (lowerPrefix === "cold under-eye reset") {
      return `Use a cold under-eye reset: ${joined}.`;
    }
    if (lowerPrefix === "under-eye") {
      return `For under-eye care, use ${joined}.`;
    }
    if (lowerPrefix === "moisturizer") {
      return `Moisturize with ${joined}.`;
    }
    if (lowerPrefix === "sunscreen") {
      return `Apply sunscreen: ${joined}.`;
    }
    if (lowerPrefix === "posture reset") {
      return `Finish with posture reset: ${joined}.`;
    }
    if (prefix === "After sweating") {
      return `After sweating, ${sentenceCaseFragment(joined)}.`;
    }
    return `${prefix}: ${joined}.`;
  }

  if (items.length === 1) {
    return ensureSentence(items[0]);
  }

  return items.map(ensureSentence).filter(Boolean).join(" ");
}

function calendarProseFromDetails(details: string): string {
  const clean = normalizeWhitespace(details)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return "";

  const rawBlocks = splitParagraphBlocks(clean);
  const mergedBlocks: string[] = [];
  for (let index = 0; index < rawBlocks.length; index++) {
    const block = rawBlocks[index];
    const next = rawBlocks[index + 1];
    if (
      next &&
      /^step\s+\d+\s*[-–—]\s*.+$/i.test(block) &&
      /(?:^|\n)\s*[-*•]\s+/.test(next)
    ) {
      mergedBlocks.push(`${block}:\n${next}`);
      index += 1;
      continue;
    }
    mergedBlocks.push(block);
  }

  const blocks = mergedBlocks
    .map(proseFromInstructionBlock)
    .filter(Boolean);
  return dedupeParagraphBlocks(blocks).join(" ");
}

function sourceHintTitleCore(title: string | null | undefined): string {
  const clean = normalizeWhitespace(title ?? "")
    .replace(/\bday\s+\d{1,3}\b/gi, "")
    .replace(/\bnight\s*$/i, "")
    .replace(/\bday\s*$/i, "")
    .replace(/\s*[-–—]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "Day-specific routine";
}

export function calendarizeSourceDayHint(hint: SourceDayHint): SourceDayHint {
  const evening = sourceHintLooksEveningRoutine(hint);
  const coreTitle = sourceHintTitleCore(hint.title);
  const title = evening ? `Night routine - ${coreTitle}` : coreTitle;
  const body = calendarProseFromDetails(hint.details ?? "") ||
    normalizeWhitespace(hint.details ?? "");
  const intro = evening
    ? `Tonight is the ${sentenceCaseFragment(coreTitle)} block.`
    : "";
  const details = [intro, body].filter(Boolean).join(" ");
  const startTime = hint.startTime ?? (evening ? "20:00" : undefined);
  const endTime = hint.endTime ?? (evening ? "20:30" : undefined);
  return {
    ...hint,
    title,
    details,
    startTime,
    endTime,
  };
}

export function calendarizeRecurringSourceRoutineHint(
  hint: RecurringSourceRoutineHint,
): RecurringSourceRoutineHint {
  const details = calendarProseFromDetails(hint.details) || hint.details;
  return {
    ...hint,
    title: routineTitleForCadence(hint.cadence),
    details,
  };
}

function hasLiteralPreservationCue(text: string): boolean {
  return /\b(exactly|verbatim|copy(?:-|\s)?paste|faithfully|keep\s+the\s+same|just\s+add|schedule\s+these|preserve\s+details|preserve\s+the\s+details|preserve\s+wording|preserve\s+the\s+wording|keep\s+details|keep\s+the\s+details|don['’]?t\s+change\s+details|do\s+not\s+change\s+details|don['’]?t\s+simplify|do\s+not\s+simplify|don['’]?t\s+alter|do\s+not\s+alter|keep\s+it\s+intact|leave\s+it\s+as\s+is)\b/i
    .test(text);
}

function stripTrailingUrlPunctuation(url: string): string {
  let clean = url.trim();
  while (/[),.;!?]$/.test(clean)) {
    clean = clean.slice(0, -1);
  }
  return clean;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function minutesToTime(value: number): string {
  const minutes = ((value % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseDurationMinutes(text: string): number | null {
  const minuteMatch = text.match(/\b(\d{1,3})\s*(?:minutes?|mins?|min)\b/i);
  if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1], 10);
    if (Number.isFinite(minutes) && minutes >= 5 && minutes <= 24 * 60) {
      return minutes;
    }
  }

  const hourMatch = text.match(/\b(\d(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/i);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    const minutes = Math.round(hours * 60);
    if (Number.isFinite(minutes) && minutes >= 15 && minutes <= 24 * 60) {
      return minutes;
    }
  }

  return null;
}

function parseTimeToken(
  rawToken: string,
  inheritedMeridiem?: "am" | "pm",
): string | null {
  const token = rawToken.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(?:(?:12\s*)?noon|midday)$/.test(token)) return "12:00";
  if (/^(?:(?:12\s*)?midnight)$/.test(token)) return "00:00";

  const match = token.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] == null ? 0 : parseInt(match[2], 10);
  let meridiem = (match[3]?.toLowerCase() as "am" | "pm" | undefined) ??
    inheritedMeridiem;

  if (
    !Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const hasColon = token.includes(":");
  if (!meridiem) {
    if (!hasColon) return null;
    if (hour > 23) return null;
    return `${pad2(hour)}:${pad2(minute)}`;
  }

  if (hour < 1 || hour > 12) return null;
  if (meridiem === "am") {
    if (hour === 12) hour = 0;
  } else if (hour < 12) {
    hour += 12;
  }

  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseRangeMatch(match: RegExpMatchArray): RequestedTimeWindow | null {
  const leftRaw = match[1]?.trim();
  const rightRaw = match[2]?.trim();
  if (!leftRaw || !rightRaw) return null;

  const leftMeridiem = leftRaw.match(/\b(am|pm)\b/i)?.[1]?.toLowerCase() as
    | "am"
    | "pm"
    | undefined;
  const rightMeridiem = rightRaw.match(/\b(am|pm)\b/i)?.[1]?.toLowerCase() as
    | "am"
    | "pm"
    | undefined;

  const startTime = parseTimeToken(leftRaw, rightMeridiem);
  const endTime = parseTimeToken(rightRaw, leftMeridiem);
  if (!startTime || !endTime) return null;

  const [sh, sm] = startTime.split(":").map((value) => parseInt(value, 10));
  const [eh, em] = endTime.split(":").map((value) => parseInt(value, 10));
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  if (endMinutes <= startMinutes) return null;
  if (endMinutes - startMinutes > 12 * 60) return null;

  return {
    startTime,
    endTime,
    source: "range",
  };
}

export function extractFirstUrl(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const match = text.match(URL_RE)?.[0];
  if (!match) return null;
  const clean = stripTrailingUrlPunctuation(match);
  if (!clean) return null;
  return clean.startsWith("www.") ? `https://${clean}` : clean;
}

export function sanitizeFlowLocation(
  raw: string | null | undefined,
): string | null {
  const trimmed = normalizeWhitespace(raw ?? "");
  if (!trimmed) return null;

  const url = extractFirstUrl(trimmed);
  if (url) return url;

  if (
    GENERIC_LOCATION_VALUE_RE.test(trimmed) ||
    GENERIC_LOCATION_CUE_RE.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

export function countYoutubeUrls(text: string | null | undefined): number {
  if (!text) return 0;
  return text.match(YOUTUBE_URL_RE)?.length ?? 0;
}

export function looksLikeYoutubeUrl(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  return YOUTUBE_URL_LIKE_RE.test(text.trim());
}

export function normalizeYoutubeVideoUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let candidate = stripTrailingUrlPunctuation(raw);
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase()
      .replace(/^www\./, "")
      .replace(/^m\./, "");

    let videoId = "";
    if (host === "youtu.be") {
      videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0]?.trim() ?? "";
    } else if (host === "youtube.com") {
      const pathSegments = parsed.pathname.split("/").filter(Boolean);
      if (parsed.pathname === "/watch") {
        videoId = parsed.searchParams.get("v")?.trim() ?? "";
      } else if (
        pathSegments.length >= 2 &&
        ["shorts", "live", "embed"].includes(pathSegments[0].toLowerCase())
      ) {
        videoId = pathSegments[1]?.trim() ?? "";
      }
    } else {
      return null;
    }

    if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
}

export function wantsYoutubeLinks(
  description: string | null | undefined,
  sourceText?: string | null,
): boolean {
  const desc = normalizeWhitespace(description ?? "");
  const source = normalizeWhitespace(sourceText ?? "");
  if (wantsYoutubeChannelVideoFlow(description, sourceText)) return true;
  if (YOUTUBE_REQUEST_RE.test(desc)) return true;
  if (
    /\binclude\s+links?\b[\s\S]{0,120}\b(?:watch|videos?|shorts?)\b/i.test(
      desc,
    ) ||
    /\b(?:watch|videos?|shorts?)\b[\s\S]{0,120}\binclude\s+links?\b/i.test(
      desc,
    )
  ) {
    return true;
  }
  return /\b(?:youtube|yt)\b/i.test(desc) && /\b(?:link|video)\b/i.test(source);
}

export function extractYoutubeChannelUrl(
  text: string | null | undefined,
): string | null {
  const clean = normalizeWhitespace(text ?? "");
  if (!clean) return null;

  const raw = clean.match(YOUTUBE_CHANNEL_URL_RE)?.[0];
  if (!raw) return null;

  let candidate = stripTrailingUrlPunctuation(raw);
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase()
      .replace(/^www\./, "")
      .replace(/^m\./, "");
    if (host !== "youtube.com") return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const first = segments[0] ?? "";
    if (
      first.startsWith("@") ||
      (["channel", "c", "user"].includes(first) && !!segments[1])
    ) {
      return `https://www.youtube.com/${segments.slice(0, 2).join("/")}`;
    }
  } catch {
    return null;
  }

  return null;
}

export function wantsYoutubeChannelVideoFlow(
  description: string | null | undefined,
  sourceText?: string | null,
): boolean {
  const combined = normalizeWhitespace(
    [description ?? "", sourceText ?? ""].filter(Boolean).join("\n\n"),
  );
  if (!extractYoutubeChannelUrl(combined)) return false;
  if (!YOUTUBE_CHANNEL_FLOW_REQUEST_RE.test(combined)) return false;

  return (
    /\b(?:one\s+video\s+per\s+day|per\s+day|every\s+day|90\s+days?|flow|arrange|order|beginner|advanced)\b/i
      .test(combined) &&
    /\b(?:shorts?|videos?|links?|watch)\b/i.test(combined)
  );
}

export function looksStructuredDayPlan(text: string): boolean {
  const clean = normalizeWhitespace(text);
  if (!clean) return false;
  const dayMarkerCount = clean.match(/\bday\s+\d{1,3}\b/gi)?.length ?? 0;
  const urlCount = clean.match(URL_RE)?.length ?? 0;
  const numberedDayLines =
    clean.match(/(?:^|\n)\s*(?:[-*•]\s*)?(?:\*\*)?\s*day\s+\d{1,3}\b/gi)
      ?.length ?? 0;
  return dayMarkerCount >= 3 || numberedDayLines >= 2 ||
    (dayMarkerCount >= 2 && urlCount >= 2);
}

export function looksLikeLongSourceDocument(text: string): boolean {
  const clean = normalizeWhitespace(text);
  if (!clean || clean.length < 600) return false;
  if (looksStructuredDayPlan(clean)) return false;

  const blocks = splitParagraphBlocks(clean);
  if (blocks.length < 3) return false;

  const totalChars = blocks.reduce((sum, block) => sum + block.length, 0);
  const avgBlockLength = totalChars / Math.max(blocks.length, 1);
  const sentenceBlocks =
    blocks.filter((block) => (block.match(/[.!?]/g)?.length ?? 0) >= 2).length;
  const headingLikeBlocks = blocks.filter((block) =>
    /^#{1,6}\s/.test(block) ||
    (/^[A-Z0-9][^.!?\n]{0,80}$/.test(block) && block.length >= 10)
  ).length;

  return avgBlockLength >= 150 || sentenceBlocks >= 2 || headingLikeBlocks >= 2;
}

function looksLikeConversationDump(text: string): boolean {
  const clean = normalizeWhitespace(text);
  if (!clean || clean.length < 200) return false;
  return CONVERSATION_DUMP_RE.test(clean);
}

export function looksLikeDetailedPreserveSource(text: string): boolean {
  const clean = normalizeWhitespace(text);
  if (!clean || clean.length < 350) return false;

  const dayMarkerCount = clean.match(/\bday\s+\d{1,3}\b/gi)?.length ?? 0;
  const mealHeadingCount =
    clean.match(/\*\*(?:breakfast|lunch|dinner|snack)[^*]*\*\*/gi)?.length ??
      0;
  const ingredientsCount = clean.match(/\bingredients\s*:/gi)?.length ?? 0;
  const instructionsCount = clean.match(/\binstructions\s*:/gi)?.length ?? 0;
  const helpsCount =
    clean.match(/\bhow\s+this\s+.+?\s+helps\s+your\s+goals\s*:/gi)?.length ??
      0;
  const stepCount =
    clean.match(/(?:^|\s)(?:1\.|2\.|3\.|4\.|5\.|6\.)\s/g)?.length ?? 0;

  const recipeDense = ingredientsCount >= 2 && instructionsCount >= 2;
  const goalAnnotated = helpsCount >= 2;
  const repeatedMeals = mealHeadingCount >= 3;

  return (
    (dayMarkerCount >= 2 && (recipeDense || goalAnnotated || repeatedMeals)) ||
    (recipeDense && (goalAnnotated || stepCount >= 4))
  );
}

export function looksLikeMealPlanFlow(
  description: string | null | undefined,
  sourceText?: string | null,
): boolean {
  const desc = normalizeWhitespace(description ?? "");
  const source = normalizeWhitespace(sourceText ?? "");
  const combined = normalizeWhitespace(
    [desc, source].filter(Boolean).join("\n\n"),
  );
  if (!combined) return false;

  const descLead = desc.slice(0, 1200);
  const hasExplicitMealPlanIntent = MEAL_PLAN_INTENT_RE.test(descLead);
  const hasFoodSignals = MEAL_FOOD_SIGNAL_RE.test(combined);
  const hasNonMealRoutineCore = NON_MEAL_REGIMEN_CORE_RE.test(combined);
  const hasDietSupportBlock =
    /\b(diet rules?|under-eye\/bloating rules?|protein:\s*\d|vitamin c food|low-glycemic|salt audit|body composition)\b/i
      .test(combined);
  const hasMealStructure = THREE_MEAL_DAILY_RE.test(combined) ||
    /\b(meal\s*1|meal\s*2|meal\s*3|daily structure)\b/i.test(combined) ||
    (
      /\bbreakfast\b/i.test(combined) &&
      /\blunch\b/i.test(combined) &&
      /\bdinner\b/i.test(combined)
    );

  if (
    hasNonMealRoutineCore && hasDietSupportBlock && !hasExplicitMealPlanIntent
  ) {
    return false;
  }
  if (hasExplicitMealPlanIntent && !hasNonMealRoutineCore) return true;
  if (hasExplicitMealPlanIntent && hasFoodSignals) return true;
  if (hasMealStructure && !hasNonMealRoutineCore) return true;

  return MEAL_FLOW_KEYWORD_RE.test(combined) &&
    hasFoodSignals &&
    !hasNonMealRoutineCore;
}

export function wantsThreeMealDailyFlow(
  description: string | null | undefined,
  sourceText?: string | null,
): boolean {
  const combined = normalizeWhitespace(
    [description ?? "", sourceText ?? ""].filter(Boolean).join("\n\n"),
  );
  if (!combined || !looksLikeMealPlanFlow(description, sourceText)) {
    return false;
  }
  if (LIMITED_MEAL_SCOPE_RE.test(combined)) {
    return false;
  }
  if (THREE_MEAL_DAILY_RE.test(combined)) {
    return true;
  }

  const mealMarkers = combined.match(/\bmeal\s*[123]\b/gi)?.length ?? 0;
  if (mealMarkers >= 3) {
    return true;
  }

  const hasBreakfast = /\bbreakfast\b/i.test(combined);
  const hasLunch = /\blunch\b/i.test(combined);
  const hasDinner = /\bdinner\b/i.test(combined);
  if (hasBreakfast && hasLunch && hasDinner) {
    return true;
  }

  return /\bdaily structure\b/i.test(combined) &&
    /\b(nutrition|diet|meal|meals)\b/i.test(combined);
}

export function isSparsePrompt(
  description: string | null | undefined,
  sourceText?: string | null,
): boolean {
  const desc = normalizeWhitespace(description ?? "");
  const source = normalizeWhitespace(sourceText ?? "");
  if (!desc || source.length >= 80) return false;
  if (desc.length > 260) return false;
  if (looksStructuredDayPlan(desc) || /\bday\s+\d{1,3}\b/i.test(desc)) {
    return false;
  }
  if (/(?:^|\n)\s*(?:[-*•]|\d+\.)\s+\S/.test(desc)) return false;
  if (
    /\b(?:with|using|include)\b[\s\S]{0,80}\b(?:day\s+\d|morning|evening|night|breakfast|lunch|dinner)\b/i
      .test(desc)
  ) {
    return false;
  }
  return true;
}

export function inferSparsePromptDomain(
  description: string | null | undefined,
  sourceText?: string | null,
): SparsePromptDomain {
  const text = normalizeWhitespace(
    [description ?? "", sourceText ?? ""].filter(Boolean).join("\n\n"),
  );
  if (!text) return "general";
  if (looksLikeMealPlanFlow(description, sourceText)) return "meal";
  if (SKINCARE_PROMPT_RE.test(text)) return "skincare";
  if (MEDU_NETER_PROMPT_RE.test(text)) return "medu_neter";
  if (MARTIAL_ARTS_PROMPT_RE.test(text)) return "martial_arts";
  if (MUSIC_PROMPT_RE.test(text)) return "music";
  if (FINANCE_FLOW_KEYWORD_RE.test(text)) return "finance";
  if (STUDY_PROMPT_RE.test(text)) return "study";
  if (
    PROJECT_FLOW_KEYWORD_RE.test(text) &&
    (PROJECT_FLOW_STRUCTURE_RE.test(text) ||
      SPARSE_PROJECT_OBJECT_RE.test(text))
  ) {
    return "project";
  }
  if (FITNESS_PROMPT_RE.test(text)) return "fitness";
  if (PRACTICE_PROMPT_RE.test(text)) return "practice";
  return "general";
}

export function buildSparsePromptExpertDefaults(args: {
  description: string | null | undefined;
  sourceText?: string | null;
  dateRangeDays: number;
  flowFormat: FlowFormat;
}): string {
  const { description, sourceText, dateRangeDays, flowFormat } = args;
  if (!isSparsePrompt(description, sourceText)) return "";
  if (!Number.isFinite(dateRangeDays) || dateRangeDays <= 0) return "";

  const domain = inferSparsePromptDomain(description, sourceText);
  const common = [
    "SPARSE_PROMPT_EXPERT_DEFAULTS:",
    "- The user gave a basic prompt. Do not return generic advice or ask them for missing details; fill in conservative, domain-standard defaults.",
    "- Make the flow feel like a competent coach already shaped it: clear progression, concrete materials/actions, safe assumptions, visible done criteria, and a short daily reflection/check-in.",
    "- Keep visible details in polished calendar prose. Never use numbered lists in visible details; prefer concise sentences with concrete actions.",
    "- If a domain naturally has multiple operational phases in one day, create the phase notes plus the evening reflection, with no more than 3 notes per day.",
    buildConcreteActionDefaultsRule(),
    buildNoviceClarityRule(),
    buildEventDetailDensityRule(),
  ];

  const domainRule = (() => {
    switch (domain) {
      case "skincare":
        return [
          "- For skincare, use 3 notes per day when the range is 14 days or less: a morning routine, a night routine, and a short evening skin check/reflection.",
          "- Morning routine should include gentle cleanse/rinse, moisturizer, SPF, and a simple observation cue. Night routine should rotate barrier recovery, cautious active use, congestion checks, and assessment without stacking irritating actives.",
          "- Use product categories unless the user named products. Be conservative: avoid scrubs, over-exfoliation, and aggressive active stacking.",
        ].join("\n");
      case "medu_neter":
        return [
          "- For Medu Neter, use a curated beginner writing-system path instead of generic culture study.",
          "- Never write 'first ten hieroglyphs', 'basic symbols', or 'common signs' unless the same visible note names the actual signs, transliterations, and values.",
          "- Starter defaults should use uniliteral signs, reading direction, transliteration, copying practice, and short self-quizzes. Keep the user oriented as a novice.",
          "- Use Kemetic/Medu Neter wording where natural. Avoid vague phrases like ancient Egyptian culture unless the event names the exact concept or artifact.",
        ].join("\n");
      case "fitness":
        return [
          "- For fitness, build a progression with warm-up, main work, recovery guidance, and trackable effort. Add a separate recovery/mobility note only when it improves the day.",
          "- Never leave warm-up generic. Name movements such as brisk walking, marching in place, hip circles, cat-cow, dead bugs, glute bridges, bodyweight squats, reverse lunges, or plank walkouts.",
          "- For core, waist, stomach, gut, and ab-definition prompts, use conservative defaults: bracing practice, dead bugs, bird dogs, glute bridges, side planks, hollow holds, carries or marching drills, walking/cardio, and recovery. Avoid promising spot fat loss.",
          "- Name sets, time ranges, intensity, form cues, and a minimum version.",
        ].join("\n");
      case "martial_arts":
        return [
          "- For martial arts, preserve the warm-up, focused drill, application, and evening reflection structure, but never use category placeholders as the assignment.",
          "- Name discipline-appropriate movements. For kung fu, starter defaults can include horse stance (mabu), bow stance (gong bu), empty stance (xu bu), drop stance (pu bu), straight punch (chong quan), front kick (zheng ti), snap kick (tan tui), inside/outside crescent kicks, parries, and stance-to-strike line drills.",
          "- Name warm-up movements instead of saying dynamic stretching: ankle circles, knee circles, hip circles, leg swings, Cossack squats, deep squat pries, shoulder circles, wrist circles, or scapular push-ups.",
          "- Include measurable holds, reps, rounds, alignment cues, and a safe minimum version. If the exact school or form is unknown, use neutral starter drills and do not invent a lineage-specific form.",
        ].join("\n");
      case "study":
        return [
          "- For study, make the work active: recall, worked examples, self-quiz, teach-back, correction, and a visible output. Do not make reading or reviewing the whole task.",
          "- For broad learning prompts, spread concept foothold, applied practice, and evening review across separate notes when useful. Each event should handle one concept chunk, not an entire subject survey.",
          "- Use the evening reflection to capture mistakes, next questions, and what should be easier tomorrow.",
        ].join("\n");
      case "project":
        return [
          "- For projects, turn the prompt into a practical build/check/decision sequence. Name tools, materials, measurements, files, calls, or verification steps when reasonable.",
          "- End each day with the next blocker or decision, not generic motivation.",
        ].join("\n");
      case "finance":
        return [
          "- For finance, center each day on documents, numbers, comparisons, calls, applications, or decisions. Do not invent amounts.",
          "- The reflection should capture the number verified, risk found, or decision needed next.",
        ].join("\n");
      case "meal":
        return [
          "- For meals, name concrete foods and prep steps. Keep nutrition benefits attached to actual meals instead of abstract advice.",
        ].join("\n");
      case "music": {
        const knownAnchors = looksLikeBeyondThe7thSkyGuitarPrompt(
            normalizeWhitespace(description ?? ""),
          )
          ? '- Known starter anchors for this song: standard tuning; key of A; about 130 BPM; main chord movement A, Am, and C; section map: intro section from 0:00 to about 0:14, verse groove starting around 0:14, bridge around 1:16, and lead/outro material beginning around 3:00. When using timecodes in visible notes, write them as section ranges or starting points, not clipped labels like "0:00 intro".'
          : "- If the prompt names a song but no source chart is supplied, create a working chart task immediately: tuning, key, tempo, chord progression, section order, hardest riff/transition, and one recording checkpoint.";
        return [
          "- For named-song music practice, build the flow around the song's actual sections, chords, timing landmarks, and playable checkpoints, not generic skill practice.",
          knownAnchors,
          "- Assume a beginner guitarist unless the user says otherwise: define standard tuning as E-A-D-G-B-E from lowest to highest, and describe a song map/chart as the page where the user writes tuning, tempo, key, main chords, section landmarks, and the first weak spot.",
          "- Event details must name the musical target: chord names, riff/fret or tab anchors, section timestamps, rhythm feel, tempo target, tone setting, or a recorded pass. Do not write placeholders like intro riff, verse chords, chord progression, song structure, or strumming pattern unless the same note names the specific music.",
          "- A strong day isolates 2-4 bars or one section, loops it slowly, checks timing/muting/tone, then records a short pass before moving on.",
        ].join("\n");
      }
      case "practice":
        return [
          "- For practice, use warm-up, focused drill, application, and a compact evening replay. Name the rep, constraint, and evidence of improvement.",
        ].join("\n");
      default:
        return [
          "- Infer the most likely domain workflow and build a complete starter flow with concrete actions, reasonable progression, and a daily check-in.",
        ].join("\n");
    }
  })();

  return [...common, domainRule].join("\n");
}

function skincareMorningDetails(): string {
  return "Start with a gentle cleanse or lukewarm rinse based on how oily your skin feels. Apply moisturizer while the skin is slightly damp, then use a broad-spectrum tinted SPF or SPF 30+ over the full face and neck. Before moving on, check for tightness, stinging, new bumps, or dry patches so the night routine can stay conservative instead of irritating your skin.";
}

function skincareNightTemplate(dayIndex: number): {
  title: string;
  details: string;
} {
  const templates = [
    {
      title: "Night routine - Barrier baseline",
      details:
        "Cleanse gently and moisturize without any exfoliating or retinoid step tonight. Use a rice-grain amount of petrolatum only on lips, nose corners, or dry patches if they feel rough. This first night sets the baseline so later changes are easier to read.",
    },
    {
      title: "Night routine - Hydration check",
      details:
        "Cleanse and apply moisturizer in a thin, even layer. If your face feels tight after 10 minutes, add a second light layer only to dry areas rather than covering acne-prone zones heavily. Keep actives out tonight so the barrier has another quiet day.",
    },
    {
      title: "Night routine - Cautious active night",
      details:
        "Cleanse and let the face dry fully before using any active. If you already tolerate a retinoid, azelaic acid, or similar treatment, apply a pea-sized amount away from eyelids, mouth corners, and irritated skin, then moisturize. If you feel burning or raw tightness, skip the active and make this a moisturizer-only night.",
    },
    {
      title: "Night routine - Recovery and dry spots",
      details:
        "Cleanse, moisturize, and leave treatment actives alone tonight. Use a tiny amount of petrolatum on dry patches, lips, or nose corners only. The point is to keep progress moving without turning irritation into the main event.",
    },
    {
      title: "Night routine - Congestion check",
      details:
        "Cleanse and look closely at oily or congested zones such as nose, forehead, and chin. If your skin is calm and you already tolerate salicylic acid, use a very small amount only on those zones; otherwise moisturize and stop there. Do not combine this with a retinoid or another exfoliating active.",
    },
    {
      title: "Night routine - Active or barrier decision",
      details:
        "Cleanse and decide from the skin in front of you. If the barrier feels calm, use one familiar active in a thin layer and moisturize after it settles; if skin feels tight, shiny, stinging, or flaky, choose moisturizer only. A skipped active is a correction, not a failure.",
    },
    {
      title: "Night routine - Under-eye and salt audit",
      details:
        "Cleanse, moisturize, and keep the under-eye area gentle. Use a small amount of eye cream along the orbital bone if that area feels dry, then avoid heavy late salt and large fluids close to bed if puffiness is part of the pattern. Keep treatment actives away from eyelids.",
    },
    {
      title: "Night routine - Even tone support",
      details:
        "Cleanse and use azelaic acid or another familiar tone-support active only if your skin has stayed calm. Keep the layer thin, wait a few minutes, and moisturize. If there is any sting that lingers, rinse if needed and return to barrier care for the next night.",
    },
    {
      title: "Night routine - No-stacking check",
      details:
        "Cleanse and choose one lane: barrier care, one familiar active, or a tiny congested-zone treatment. Do not stack retinoid, exfoliating acid, and brightening active in the same night. Moisturize well and note whether the routine still feels comfortable after 10 minutes.",
    },
    {
      title: "Night routine - Assessment and reset",
      details:
        "Cleanse, moisturize, and keep tonight simple so the final read is clean. Use petrolatum only on small dry areas. Compare the skin to your starting point for puffiness, tightness, oiliness, new bumps, and uneven tone, then decide which active your skin handled best.",
    },
  ];
  return templates[dayIndex % templates.length];
}

function skincareReflectionDetails(dayIndex: number): string {
  const focus = [
    "dryness, tightness, and whether sunscreen felt comfortable",
    "oiliness, new bumps, and any stinging after moisturizer",
    "puffiness, sleep quality, and whether the night routine felt too strong",
    "dark marks, irritation, and whether any active should be paused",
  ][dayIndex % 4];
  return `Take 5 quiet minutes to check ${focus}. Write one sentence on what improved, one sentence on what felt irritated or uncertain, and one adjustment for tomorrow. Keep this mental-only; do not add extra products tonight just because you noticed something.`;
}

function meduNeterLessonDetails(dayIndex: number): {
  title: string;
  details: string;
} {
  const starterSigns =
    "𓇋 reed leaf = i/y, 𓅱 quail chick = w/u, 𓅓 owl = m, 𓈖 water ripple = n, 𓂋 mouth = r, 𓊪 stool = p, 𓃀 foot = b, 𓎡 basket handle = k, 𓏏 bread loaf = t, and 𓂧 hand = d";
  const templates = [
    {
      title: "Starter signs and reading direction",
      details:
        `Start with these ten Medu Neter uniliteral signs: ${starterSigns}. Copy each sign three times, say the value aloud, and note that many signs face the beginning of the text, so you read toward the faces of people, animals, or birds. You are done when you can cover the values and identify at least 7 of the 10 signs from your copied page.`,
    },
    {
      title: "Flashcards for ten signs",
      details:
        `Make one flashcard for each starter sign: 𓇋 i/y, 𓅱 w/u, 𓅓 m, 𓈖 n, 𓂋 r, 𓊪 p, 𓃀 b, 𓎡 k, 𓏏 t, and 𓂧 d. Put the glyph on the front and the object plus value on the back, such as "owl = m" or "water ripple = n." Shuffle once and stop when you can answer 8 cards correctly without looking at your notes.`,
    },
    {
      title: "Direction and sign facing",
      details:
        "Practice reading direction with the bird and face signs from your set: 𓅱 quail chick, 𓅓 owl, 𓂋 mouth, and 𓂧 hand. Draw two short rows, one facing left and one facing right, then mark the starting side before reading the values aloud. You are done when you can explain in one sentence that the text is usually read toward the faces of the signs.",
    },
    {
      title: "Transliteration practice",
      details:
        "Use the starter signs as sound values, not English letters with vowels. Build five sound chains from the cards, such as 𓅓𓈖 = m-n, 𓂋𓈖 = r-n, 𓊪𓏏 = p-t, 𓎡𓅓 = k-m, and 𓂧𓇋 = d-i/y. Copy each chain twice and say the consonant values slowly without inventing a full translation.",
    },
    {
      title: "Phonograms, logograms, and determinatives",
      details:
        "Separate three jobs a sign can do: a phonogram gives sound, a logogram can stand for a word, and a determinative silently points to meaning. Use your phonogram cards 𓅓 m, 𓈖 n, and 𓂋 r, then add examples of meaning signs: sun disk 𓇳 for sun/day/Ra contexts, seated man 𓀀 for a male person, seated woman 𓁐 for a female person, and papyrus roll 𓏛 for abstract words. You are done when you can name which examples are sound signs and which are meaning helpers.",
    },
    {
      title: "Copy quality and memory check",
      details:
        "Choose the five signs that looked messiest yesterday and copy each one five times: keep 𓈖 as a clean water ripple, 𓂋 as a clear mouth shape, 𓏏 as a flat bread loaf, 𓎡 as a basket handle, and 𓂧 as a hand. After copying, close the page and draw those five from memory. Circle only the version you would want to see again tomorrow.",
    },
    {
      title: "Seven-day review quiz",
      details:
        `Run a full review of the starter set: ${starterSigns}. First, identify each glyph from a shuffled list; second, write the value from memory; third, explain reading direction and the difference between a sound sign and a meaning helper. You are done when you know which three signs need another week of practice.`,
    },
    {
      title: "Write a cautious name practice",
      details:
        "Practice transliterating your name as a learning exercise, not as an authoritative ancient spelling. Write the consonant sounds you hear, choose the closest starter signs from 𓇋 i/y, 𓅱 w/u, 𓅓 m, 𓈖 n, 𓂋 r, 𓊪 p, 𓃀 b, 𓎡 k, 𓏏 t, and 𓂧 d, then mark any sound you do not know yet with a blank box. You are done when the attempt shows what you know and what still needs a sign.",
    },
    {
      title: "Build a pocket reference",
      details:
        "Make a half-page pocket reference with four sections: starter uniliteral signs, reading direction, sign jobs, and today's weak signs. Fill the sign section with 𓇋 i/y, 𓅱 w/u, 𓅓 m, 𓈖 n, 𓂋 r, 𓊪 p, 𓃀 b, 𓎡 k, 𓏏 t, and 𓂧 d. Keep it short enough to use during practice instead of turning it into a research project.",
    },
    {
      title: "Teach-back checkpoint",
      details:
        "Teach the starter lesson out loud in under three minutes. Show the ten signs, explain that uniliterals usually give one consonant value, demonstrate reading toward the faces, and give one example of a meaning helper such as 𓇳 sun disk or 𓏛 papyrus roll. You are done when the explanation feels clear enough that a new learner could copy your first practice page.",
    },
  ];
  return templates[dayIndex % templates.length];
}

function meduNeterReflectionDetails(dayIndex: number): string {
  const focus = [
    "which two signs you recognized fastest and which two still blurred together",
    "whether reading toward the faces felt clear or still confusing",
    "which copied sign looked cleanest and which one needs slower drawing",
    "whether sound signs and meaning helpers stayed separate in your mind",
    "what should go on tomorrow's first flashcard",
  ][dayIndex % 5];
  return `Take 6 minutes for a Medu Neter review. Write ${focus}, then choose one small repair for tomorrow's first minute. Do not add new signs tonight; the point is to keep the starter set accurate.`;
}

function buildMeduNeterSparsePromptRoutineNotes(
  dateRangeDays: number,
): SparsePromptRoutineNote[] {
  const notes: SparsePromptRoutineNote[] = [];
  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    const lesson = meduNeterLessonDetails(dayIndex);
    notes.push(
      {
        day_index: dayIndex,
        title: lesson.title,
        details: lesson.details,
        all_day: false,
        start_time: "09:00",
        end_time: "09:35",
      },
      {
        day_index: dayIndex,
        title: "Medu Neter review",
        details: meduNeterReflectionDetails(dayIndex),
        all_day: false,
        start_time: "20:00",
        end_time: "20:10",
      },
    );
  }
  return notes;
}

function martialArtsPracticeLabel(
  description: string | null | undefined,
): string {
  const text = normalizeWhitespace(description ?? "");
  if (/\bkung\s*fu|wushu|shaolin|wing\s*chun|tai\s*chi|taiji\b/i.test(text)) {
    return "kung fu";
  }
  return "martial arts";
}

function kungFuWarmupDetails(dayIndex: number): string {
  const templates = [
    "Warm up with ankle circles, knee circles, hip circles, front leg swings, side leg swings, and Cossack squats. Then hold horse stance (mabu) for 3 rounds of 30 seconds, bow stance (gong bu) for 3 rounds each side, and empty stance (xu bu) for 3 balance checks each side. Keep knees tracking over toes, spine tall, and shoulders loose.",
    "Start with wrist circles, shoulder circles, scapular push-ups, hip circles, and 10 slow deep squat pries. Move into horse stance for 2 rounds of 45 seconds, then alternate left and right bow stance for 6 slow switches. Keep the feet rooted before the hands move.",
    "Use front leg swings, side leg swings, ankle circles, and 5 Cossack squats each side to open the hips. Practice empty stance (xu bu) to bow stance (gong bu) transitions for 8 slow reps each side. Stay light on the empty-stance foot and avoid collapsing the front knee inward.",
    "Warm up with shoulder circles, wrist circles, hip circles, knee circles, and 20 relaxed bounce-free calf raises. Hold horse stance for 60 seconds total in smaller chunks if needed, then step into bow stance and return to center for 10 controlled switches. Quality beats depth today.",
    "Open with leg swings, Cossack squats, deep squat pries, and slow torso turns. Practice horse stance to drop stance (pu bu) only as low as you can control, 5 reps per side. Keep one hand near the floor for balance if needed and come out before the knees complain.",
    "Use ankle circles, knee circles, hip circles, side lunges, and shoulder circles to prepare the joints. Run 3 rounds of 20-second horse stance, 20-second bow stance left, and 20-second bow stance right. Check that your breathing stays calm and your shoulders do not climb.",
    "Warm up with front leg swings, inside crescent leg swings, outside crescent leg swings, wrist circles, and deep squat pries. Hold empty stance for 5 quiet breaths each side, then step forward into bow stance without bobbing up and down. Keep the eyes level through the transition.",
    "Start with hip circles, ankle circles, Cossack squats, and 10 slow chamber-and-rechamber knee lifts each side. Add 3 rounds of horse stance to bow stance switches, then finish with 5 relaxed shoulder rolls. The goal is warm hips, stable feet, and no rushed kicks.",
    "Warm up with shoulder circles, wrist circles, hip circles, leg swings, and 6 Cossack squats each side. Practice a slow stance ladder: horse stance, left bow stance, horse stance, right bow stance, empty stance left, empty stance right. Move smoothly enough that you could stop at any point.",
    "Use ankle circles, knee circles, hip circles, front leg swings, side leg swings, and deep squat pries as your final assessment warm-up. Hold horse stance, bow stance on each side, and empty stance on each side long enough to notice balance and tension. Mark which stance feels most improved before the main drill.",
  ];
  return templates[dayIndex % templates.length];
}

function kungFuFocusedDrillDetails(dayIndex: number): string {
  const templates = [
    "Work the stance line slowly: step from horse stance into left bow stance, return to center, then step into right bow stance. Add a straight punch (chong quan) only after the feet land. Do 5 slow passes each side, checking front knee alignment, rear heel pressure, and a clean fist recovery after every punch.",
    "Practice straight punch mechanics from horse stance for 5 sets of 10 relaxed reps. Keep the non-punching fist returning to the ribs, rotate the waist slightly, and stop the punch at shoulder height instead of lifting the elbow. Finish with 3 slow bow-stance stepping punches each side.",
    "Train front kick (zheng ti) and snap kick (tan tui) without rushing. Do 4 sets of 5 kicks per leg, using chamber, extension, rechamber, and quiet landing as the rule for every rep. If balance breaks, lower the kick and hold a wall lightly while keeping the torso upright.",
    "Work defense basics with inside parry, outside parry, high cover, and low sweeping block. Do 3 rounds of 8 reps per side, then pair each block with one step into bow stance and one straight punch. Keep the hands returning to guard instead of dropping after the block.",
    "Build a short combination: horse stance, step to bow stance, straight punch, outside parry, front kick, and return to guard. Practice 6 slow rounds per side before adding speed. The rep only counts if the stance lands before the strike and you can pause after the kick without hopping.",
    "Practice drop stance (pu bu) as a mobility and control drill, not a depth contest. Move from horse stance into a shallow drop stance, return to horse stance, then step into bow stance with a straight punch. Do 5 reps per side and keep the bent knee tracking over the toes.",
    "Train balance and footwork with empty stance to front kick. Hold empty stance for 3 breaths, chamber the knee, extend a low front kick, rechamber, and land back into empty stance. Do 5 reps per side, then walk forward with 6 slow bow-stance steps while keeping the guard relaxed.",
    "Practice inside and outside crescent kicks at low to mid height. Do 3 sets of 5 each direction per leg, focusing on a smooth arc, upright posture, and a controlled landing. Finish with 2 slow shadow rounds that link crescent kick, bow stance, straight punch, and guard recovery.",
    "Use 3 two-minute shadow rounds. Round 1 is stance transitions only; round 2 adds straight punches and parries; round 3 adds front kick or crescent kick only when balance is steady. Rest 60 seconds between rounds and write down the one movement that got sloppy first.",
    "Run a clean 10-day review: 60 seconds of horse stance broken as needed, 10 bow-stance stepping punches per side, 5 front kicks per side, 5 crescent kicks per side, and 2 slow shadow rounds. Do not chase speed; the score is stable feet, clear guard recovery, and controlled breathing.",
  ];
  return templates[dayIndex % templates.length];
}

function kungFuReflectionDetails(dayIndex: number): string {
  const focus = [
    "which stance felt most stable and which side lost balance first",
    "whether your punches started from the floor and waist or only from the shoulder",
    "which kick stayed controlled through chamber, extension, rechamber, and landing",
    "whether your hands returned to guard after each parry, block, or strike",
    "which transition got rushed when you tried to link movements",
  ][dayIndex % 5];
  return `Take 5 minutes to review today's kung fu practice. Write ${focus}, plus one correction to carry into the next session. Keep this as review only; do not add extra reps tonight if the joints or hips feel tired.`;
}

function beyond7thSkyGuitarPracticeDetails(dayIndex: number): {
  title: string;
  details: string;
} {
  const templates = [
    {
      title: "Set the song chart",
      details:
        "Before playing, make a simple song map: one page with the setup at the top and the song sections underneath. Write standard tuning as E-A-D-G-B-E from lowest string to highest string, then add about 130 BPM, key center A, and A to Am to C as the main chord movement. Under that, mark the section landmarks: intro section from 0:00 to about 0:14, verse groove starting around 0:14, bridge around 1:16, and lead/outro material beginning around 3:00. You are done when you can listen once and point to each section without pausing.",
    },
    {
      title: "Intro double-stops",
      details:
        "Keep the recording and a trusted tab open. Loop the first 2-4 bars of the intro section (0:00 to about 0:14) at 60-70% speed, focusing on the double-stop shape around the 5th-7th fret, a small quarter-step bend, a clean slide, and muted unused strings. Record one pass before raising tempo.",
    },
    {
      title: "A groove and muting",
      details:
        "Work the verse groove that starts around 0:14 on A with tight right-hand muting. Keep the pulse near 65% tempo and check that the open-string hits do not ring past the pocket. Stop when you can play 8 clean bars with no extra string noise.",
    },
    {
      title: "A to Am shift",
      details:
        "Practice the verse chord movement from A into Am and back, listening for the major-to-minor change instead of just moving fingers. Use slow downstrokes first, then add light ghost upstrokes. Done means the change stays even for 10 passes.",
    },
    {
      title: "C hit and return",
      details:
        "Add the C hit into the A and Am verse movement. Loop the two-bar spot where C appears, then return to A without rushing the beat. Record one pass and listen only for whether the C lands confidently.",
    },
    {
      title: "Intro into verse",
      details:
        "Start in the last four beats of the intro section and move into the verse groove starting around 0:14 without stopping. Keep the double-stop ending quiet enough that the A groove enters clean. Land the transition three times in a row before increasing speed.",
    },
    {
      title: "Bridge chord hits",
      details:
        "Move to the bridge section that enters around 1:16 and isolate the C and D chord hits shown in your tab. Keep each chord short, clean, and rhythmically placed before adding any lead fill. Done means you can count into each hit without waiting on the recording.",
    },
    {
      title: "Bridge lead answer",
      details:
        "Loop the bridge lead answer from about 1:19 to 1:27 and keep the bend, release, and slide controlled. Use 60% speed and name the hardest two-note move before each pass. Record one short take and keep the cleanest version as today's checkpoint.",
    },
    {
      title: "Bridge back to riff",
      details:
        "Practice the bridge return into the familiar 5th-7th fret riff shape around 1:30. Keep the bend small, the vibrato relaxed, and the final slide quiet. Done means the bridge can reconnect to the riff without a dead stop.",
    },
    {
      title: "Lead/outro climb",
      details:
        "Work the lead/outro material that begins around 3:00, using the tab as a position map rather than guessing. Keep the notes even and let only the target note sustain. Stop after one clean 15-second recording, even if it is under tempo.",
    },
    {
      title: "Verse stamina pass",
      details:
        "Play the verse groove for 60 seconds at a comfortable tempo, keeping the A, Am, and C changes clear. Watch for right-hand tension and reset the wrist if the muting gets sloppy. Done means one uninterrupted minute with steady time.",
    },
    {
      title: "Section order rehearsal",
      details:
        "Play a reduced arrangement in order: intro section from 0:00 to about 0:14, verse groove starting around 0:14, bridge around 1:16, and lead/outro material beginning around 3:00. Use short versions of each section and leave gaps if needed. The win is knowing where you are in the song at all times.",
    },
    {
      title: "Tone and attack check",
      details:
        "Set an overdriven electric tone with enough gain to sustain but not so much that muted strings blur. Play the intro double-stops, the A verse groove, and one bridge hit with the same tone. Record 30 seconds and adjust pickup, gain, or picking force once.",
    },
    {
      title: "Slow full-song pass",
      details:
        "Run the full arrangement at 60-70% speed with the recording or metronome. Keep going through small mistakes and mark only the biggest break in timing, muting, or the A, Am, and C chord changes. Record one pass; it counts if you reach the end and know tomorrow's repair spot.",
    },
    {
      title: "Repair the weakest bar",
      details:
        "Use yesterday's recording to choose one weak bar from the intro, verse, bridge, or outro. Loop only that spot for 12 careful reps, then play two bars before and after it. Done means the repair survives inside the surrounding section.",
    },
    {
      title: "Clean performance take",
      details:
        "Record a final performance pass with the A, Am, and C movement clear and the intro, verse, bridge, and lead/outro in order. Do not stop for small misses; write the timestamp of the biggest issue after the take. Keep the best version as your baseline.",
    },
  ];
  return templates[dayIndex % templates.length];
}

function musicReflectionDetails(dayIndex: number): string {
  const focus = [
    "the section that stayed most in time",
    "the A-to-Am change or 5th-7th fret riff move that still needs the slowest tempo",
    "whether muting, bends, or slides caused the most noise",
    "the timestamp you should loop first next session",
  ][dayIndex % 4];
  const templates = [
    `Take 6 minutes away from the guitar and listen back if you recorded today. Write ${focus}, then choose one small repair for the next session. Keep this as listening and planning so your hands recover.`,
    `Without picking up the guitar, replay the session in your head and write ${focus}. Add one sentence about how you will slow it down tomorrow before you try to speed it up.`,
    `Use tonight as a quick ear check: write ${focus} and the exact section you should hear before touching the strings next time. Stop there so the practice has a clean ending.`,
    `Review the chart, tab, or recording for 6 quiet minutes and write ${focus}. Close by naming the first 2-4 bars you will loop in the next practice block.`,
  ];
  return templates[dayIndex % templates.length];
}

function buildBeyond7thSkySparsePromptRoutineNotes(
  dateRangeDays: number,
): SparsePromptRoutineNote[] {
  const notes: SparsePromptRoutineNote[] = [];
  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    const practice = beyond7thSkyGuitarPracticeDetails(dayIndex);
    notes.push(
      {
        day_index: dayIndex,
        title: practice.title,
        details: practice.details,
        all_day: false,
        start_time: "18:00",
        end_time: "18:40",
      },
      {
        day_index: dayIndex,
        title: "Listening review",
        details: musicReflectionDetails(dayIndex),
        all_day: false,
        start_time: "20:30",
        end_time: "20:40",
      },
    );
  }
  return notes;
}

function buildKungFuSparsePromptRoutineNotes(
  description: string | null | undefined,
  dateRangeDays: number,
): SparsePromptRoutineNote[] {
  const label = martialArtsPracticeLabel(description);
  const notes: SparsePromptRoutineNote[] = [];
  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    notes.push(
      {
        day_index: dayIndex,
        title: "Morning Warm-Up",
        details: kungFuWarmupDetails(dayIndex),
        all_day: false,
        start_time: "08:00",
        end_time: "08:20",
      },
      {
        day_index: dayIndex,
        title: "Focused Drills",
        details: kungFuFocusedDrillDetails(dayIndex),
        all_day: false,
        start_time: "18:00",
        end_time: "18:35",
      },
      {
        day_index: dayIndex,
        title: "Evening Reflection",
        details: kungFuReflectionDetails(dayIndex).replace("kung fu", label),
        all_day: false,
        start_time: "20:30",
        end_time: "20:40",
      },
    );
  }
  return notes;
}

export function buildSparsePromptRoutineNotes(args: {
  description: string | null | undefined;
  sourceText?: string | null;
  dateRangeDays: number;
  flowFormat: FlowFormat;
}): SparsePromptRoutineNote[] | null {
  const { description, sourceText, dateRangeDays, flowFormat } = args;
  if (!isSparsePrompt(description, sourceText)) return null;
  if (flowFormat !== "REGIMEN") return null;
  if (!Number.isFinite(dateRangeDays) || dateRangeDays <= 0) return null;
  if (
    looksLikeBeyondThe7thSkyGuitarPrompt(
      normalizeWhitespace(description ?? ""),
    ) && dateRangeDays <= 21
  ) {
    return buildBeyond7thSkySparsePromptRoutineNotes(dateRangeDays);
  }
  if (
    inferSparsePromptDomain(description, sourceText) === "medu_neter" &&
    dateRangeDays <= 21
  ) {
    return buildMeduNeterSparsePromptRoutineNotes(dateRangeDays);
  }
  if (dateRangeDays > 14) return null;

  const domain = inferSparsePromptDomain(description, sourceText);
  if (domain === "martial_arts" && KUNG_FU_PROMPT_RE.test(description ?? "")) {
    return buildKungFuSparsePromptRoutineNotes(description, dateRangeDays);
  }
  if (domain !== "skincare") return null;

  const notes: SparsePromptRoutineNote[] = [];
  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    const dayNumber = dayIndex + 1;
    const night = skincareNightTemplate(dayIndex);
    notes.push(
      {
        day_index: dayIndex,
        title: `Morning skincare routine - Day ${dayNumber}`,
        details: skincareMorningDetails(),
        all_day: false,
        start_time: "08:00",
        end_time: "08:20",
      },
      {
        day_index: dayIndex,
        title: `${night.title} - Day ${dayNumber}`,
        details: night.details,
        all_day: false,
        start_time: "19:30",
        end_time: "19:50",
      },
      {
        day_index: dayIndex,
        title: `Evening skin check - Day ${dayNumber}`,
        details: skincareReflectionDetails(dayIndex),
        all_day: false,
        start_time: "20:00",
        end_time: "20:10",
      },
    );
  }
  return notes;
}

export function inferFlowFormat(
  description: string | null | undefined,
  sourceText?: string | null,
): FlowFormat {
  const desc = normalizeWhitespace(description ?? "");
  const source = normalizeWhitespace(sourceText ?? "");
  const combined = [desc, source].filter(Boolean).join("\n\n");
  if (!combined) return "STANDARD";
  const hasTransformCue = TRANSFORM_CUE_RE.test(desc);
  const longSource = looksLikeLongSourceDocument(source);
  const conversationDump = looksLikeConversationDump(source);
  const paragraphCount = splitParagraphBlocks(source).length;
  const regimenSignals = REGIMEN_FLOW_KEYWORD_RE.test(combined);

  if (looksLikeMealPlanFlow(desc, source)) {
    return "MEAL_PLAN";
  }

  if (regimenSignals && NON_MEAL_REGIMEN_CORE_RE.test(combined)) {
    return "REGIMEN";
  }

  const financeSignals = FINANCE_FLOW_KEYWORD_RE.test(combined) &&
    (FINANCE_FLOW_STRUCTURE_RE.test(combined) || /\d/.test(combined));
  if (financeSignals) {
    return "FINANCE_PLAN";
  }

  const sparseProjectSignals = PROJECT_FLOW_KEYWORD_RE.test(combined) &&
    isSparsePrompt(desc, source) &&
    !TRANSFORM_CUE_RE.test(desc) &&
    !STUDY_PROMPT_RE.test(combined) &&
    SPARSE_PROJECT_OBJECT_RE.test(combined);
  const projectSignals = PROJECT_FLOW_KEYWORD_RE.test(combined) &&
    (PROJECT_FLOW_STRUCTURE_RE.test(combined) ||
      sparseProjectSignals ||
      looksStructuredDayPlan(combined) ||
      /(?:^|\n)\s*(?:[-*•]|\d+\.)\s/.test(combined));
  if (projectSignals) {
    return "PROJECT_PLAN";
  }

  const synthesisSignals = (
    source.length >= 450 ||
    longSource ||
    conversationDump ||
    (hasTransformCue && paragraphCount >= 3)
  ) &&
    (
      SYNTHESIS_SOURCE_KEYWORD_RE.test(combined) ||
      conversationDump ||
      longSource ||
      (hasTransformCue && paragraphCount >= 3)
    );
  if (synthesisSignals) {
    return "SYNTHESIS";
  }

  if (regimenSignals) {
    return "REGIMEN";
  }

  if (longSource && hasTransformCue) {
    return "SYNTHESIS";
  }

  return "STANDARD";
}

export function inferSourceHandling(
  description: string,
  sourceText?: string | null,
): SourceHandlingMode {
  const desc = normalizeWhitespace(description);
  const source = normalizeWhitespace(sourceText ?? "");
  const combined = [desc, source].filter(Boolean).join("\n\n");
  if (!combined) return "NONE";

  const structured = looksStructuredDayPlan(source || combined);
  const literalCue = hasLiteralPreservationCue(combined);
  const detailedPreserveSource = looksLikeDetailedPreserveSource(
    source || combined,
  );
  const paragraphCount = splitParagraphBlocks(source).length;
  const conversationDump = looksLikeConversationDump(source);
  if (structured || literalCue || detailedPreserveSource) {
    return "PRESERVE_STRUCTURE";
  }

  const transformCue = TRANSFORM_CUE_RE.test(desc);
  if (
    looksLikeLongSourceDocument(source) ||
    conversationDump ||
    (
      source.length >= 450 &&
      paragraphCount >= 3 &&
      SYNTHESIS_SOURCE_KEYWORD_RE.test(combined)
    ) ||
    (source.length >= 1200 && !structured) ||
    (transformCue && source.length >= 450 && paragraphCount >= 3 && !structured)
  ) {
    return "SYNTHESIZE_FROM_SOURCE";
  }

  return "NONE";
}

function detectExplicitTimes(text: string): boolean {
  if (!text) return false;
  const timePattern = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(?:am|pm))\b/i;
  return timePattern.test(text);
}

function looksListLike(text: string): boolean {
  if (!text) return false;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines.filter((line) => /^[-*•\d]/.test(line));
  const shortLines = lines.filter((line) =>
    line.length > 0 && line.length <= 60
  );
  const commaChunks = text.split(",").map((chunk) => chunk.trim()).filter(
    Boolean,
  );
  const rawCommaFragments = commaChunks.filter((chunk) =>
    chunk.length <= 32 && !/[.!?]/.test(chunk)
  );

  return (
    bulletLines.length >= 2 ||
    (shortLines.length >= 3 && lines.length >= 3) ||
    (
      commaChunks.length >= 4 &&
      rawCommaFragments.length === commaChunks.length &&
      text.length <= 220
    )
  );
}

export function inferMode(
  description: string,
  sourceText?: string | null,
): "DICTATION" | "ELABORATION" {
  const lower = (description || "").toLowerCase();
  const sourceHandling = inferSourceHandling(description, sourceText);
  const hasDictationCue =
    /(just\s+add|put\s+this\s+in|log\s+this|schedule\s+these)/i.test(lower);
  const hasGenerativePlanCue =
    /(turn|make|convert|transform|create|build|organize|map|distill|shape|draft|generate)\b[\s\S]{0,80}\b(flow|plan|schedule|roadmap|program|routine|regimen)\b/i
      .test(description) ||
    /\b(?:\d{1,3}\s*-\s*day|\d{1,3}\s*day|30\s*day|60\s*day|90\s*day)\b[\s\S]{0,24}\b(flow|plan|schedule|roadmap|program|routine|regimen)\b/i
      .test(description);
  const hasExplicitTimes = detectExplicitTimes(description);
  const listy = looksListLike(description);

  if (sourceHandling === "PRESERVE_STRUCTURE") {
    return "DICTATION";
  }
  if (sourceHandling === "SYNTHESIZE_FROM_SOURCE") {
    return "ELABORATION";
  }
  if (hasGenerativePlanCue) {
    return "ELABORATION";
  }
  if (hasExplicitTimes || hasDictationCue || listy) {
    return "DICTATION";
  }
  return "ELABORATION";
}

export function inferRequestedTimeWindow(
  text: string,
): RequestedTimeWindow | null {
  const clean = normalizeWhitespace(text);
  if (!clean) return null;

  const rangePatterns = [
    /\b(?:from|between)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to|through|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to|through|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
  ];

  for (const pattern of rangePatterns) {
    const match = clean.match(pattern);
    if (!match) continue;
    const parsed = parseRangeMatch(match);
    if (parsed) return parsed;
  }

  const singlePatterns = [
    /\b(?:at|around|starting(?:\s+at)?|start(?:\s+at)?|schedule(?:d)?(?:\s+for|\s+at)?|do(?:\s+this)?(?:\s+at)?|begin(?:\s+at)?|watch(?:ing)?(?:\s+at)?|when\s+they\s+watch\s+at?)\s+((?:12\s*)?noon|midday|(?:12\s*)?midnight)\b/i,
    /\b(?:at|around|starting(?:\s+at)?|start(?:\s+at)?|schedule(?:d)?(?:\s+for|\s+at)?|do(?:\s+this)?(?:\s+at)?|begin(?:\s+at)?)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
    /\b((?:12\s*)?noon|midday|(?:12\s*)?midnight)\b/i,
    /\b(\d{1,2}(?::\d{2})\s*(?:am|pm)?)\b/i,
  ];

  for (const pattern of singlePatterns) {
    const match = clean.match(pattern);
    if (!match) continue;
    const startTime = parseTimeToken(match[1]);
    if (!startTime) continue;
    const durationMinutes = parseDurationMinutes(clean) ?? 60;
    const [hour, minute] = startTime.split(":").map((value) =>
      parseInt(value, 10)
    );
    const endTime = minutesToTime(hour * 60 + minute + durationMinutes);
    return {
      startTime,
      endTime,
      source: "single",
    };
  }

  return null;
}

export function mergePreservedDetails(
  generatedDetails: string | null | undefined,
  sourceDetails: string | null | undefined,
): string {
  const generated = normalizeWhitespace(generatedDetails ?? "");
  const source = normalizeWhitespace(sourceDetails ?? "");
  if (!generated) return source;
  if (!source) return generated;

  const generatedKey = generated.replace(/\s+/g, " ").toLowerCase();
  const sourceKey = source.replace(/\s+/g, " ").toLowerCase();
  if (generatedKey === sourceKey) {
    return source.length >= generated.length ? source : generated;
  }
  if (sourceKey.includes(generatedKey)) return source;
  if (generatedKey.includes(sourceKey)) return generated;

  return dedupeParagraphBlocks([
    ...splitParagraphBlocks(generated),
    ...splitParagraphBlocks(source),
  ]).join("\n\n");
}

export function hasUnsafeVisibleRepeatReference(
  text: string | null | undefined,
): boolean {
  const clean = normalizeWhitespace(text ?? "");
  if (!clean) return false;
  return INTERNAL_VISIBLE_DAY_ZERO_RE.test(clean) ||
    EXPLICIT_VISIBLE_REPEAT_DAY_RE.test(clean) ||
    RELATIVE_VISIBLE_REPEAT_RE.test(clean) ||
    SAME_AS_ABOVE_RE.test(clean) ||
    MORNING_ROUTINE_AS_USUAL_RE.test(clean);
}

export function hasVisibleNumberedInstructionList(
  text: string | null | undefined,
): boolean {
  const clean = normalizeWhitespace(text ?? "");
  if (!clean) return false;
  VISIBLE_NUMBERED_INSTRUCTION_LINE_RE.lastIndex = 0;
  return VISIBLE_NUMBERED_INSTRUCTION_LINE_RE.test(clean);
}

export function stripVisibleNumberedInstructionListMarkers(
  text: string | null | undefined,
): string {
  const clean = normalizeWhitespace(text ?? "");
  if (!clean) return "";
  VISIBLE_NUMBERED_INSTRUCTION_LINE_RE.lastIndex = 0;
  if (!VISIBLE_NUMBERED_INSTRUCTION_LINE_RE.test(clean)) return clean;

  VISIBLE_NUMBERED_INSTRUCTION_LINE_RE.lastIndex = 0;
  return clean
    .split("\n")
    .map((line) =>
      line.replace(VISIBLE_NUMBERED_INSTRUCTION_LINE_RE, "").trim()
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function unsafeVisibleRepeatTargetDayIndex(
  text: string | null | undefined,
  currentDayIndex: number,
): number | null {
  const clean = normalizeWhitespace(text ?? "");
  if (!clean) return null;

  const explicit = clean.match(EXPLICIT_VISIBLE_REPEAT_DAY_RE);
  if (explicit?.[1]) {
    const dayNumber = parseInt(explicit[1], 10);
    if (!Number.isFinite(dayNumber) || dayNumber < 0) return null;
    return dayNumber === 0 ? 0 : dayNumber - 1;
  }

  if (INTERNAL_VISIBLE_DAY_ZERO_RE.test(clean)) return 0;

  if (
    RELATIVE_VISIBLE_REPEAT_RE.test(clean) ||
    SAME_AS_ABOVE_RE.test(clean) ||
    MORNING_ROUTINE_AS_USUAL_RE.test(clean)
  ) {
    const previous = currentDayIndex - 1;
    return previous >= 0 ? previous : null;
  }

  return null;
}

export function stripUnsafeVisibleRepeatReferenceText(
  text: string | null | undefined,
): string {
  let clean = normalizeWhitespace(text ?? "");
  if (!clean) return "";
  for (const pattern of VISIBLE_REPEAT_CLEANUP_PATTERNS) {
    clean = clean.replace(pattern, "");
  }
  return clean
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*[.:;-]\s*/, "")
    .trim();
}

export function parseSourceDayHints(
  text: string,
  maxDays?: number,
): Map<number, SourceDayHint> {
  const clean = normalizeWhitespace(text);
  const out = new Map<number, SourceDayHint>();
  if (!clean) return out;
  const linkDefs = parseMarkdownLinkDefinitions(clean);

  const matches = [
    ...clean.matchAll(new RegExp(DAY_MARKER_RE.source, DAY_MARKER_RE.flags)),
  ];
  const parsedHints: Array<
    SourceDayHint & { repeatTargetDayIndex: number | null }
  > = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const rawDay = parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(rawDay) || rawDay <= 0) continue;
    const dayIndex = rawDay - 1;
    if (typeof maxDays === "number" && dayIndex >= maxDays) continue;

    const blockStart = match.index ?? 0;
    const blockEnd = i + 1 < matches.length
      ? matches[i + 1].index ?? clean.length
      : clean.length;
    const block = clean.slice(blockStart, blockEnd).trim();
    const repeatTargetDayIndex = extractSourceHintRepeatTargetDayIndex(block);
    const title = (match[2] ?? "")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const details = cleanSourceHintDetails(block, linkDefs) || undefined;
    const location = extractFirstUrl(details ?? block) ?? undefined;
    const timeWindow = inferRequestedTimeWindow(details ?? block);

    parsedHints.push({
      dayIndex,
      title: title || undefined,
      details,
      location,
      startTime: timeWindow?.startTime,
      endTime: timeWindow?.endTime,
      repeatTargetDayIndex,
    });
  }

  for (const hint of parsedHints) {
    const repeatTargetDayIndex = hint.repeatTargetDayIndex;
    let details = hint.details;
    if (repeatTargetDayIndex !== null) {
      const sourceDetails = out.get(repeatTargetDayIndex)?.details ??
        parsedHints.find((candidate) =>
          candidate.dayIndex === repeatTargetDayIndex
        )?.details;
      details = mergeRepeatedSourceHintDetails(sourceDetails, details) ||
        details;
    }

    out.set(hint.dayIndex, {
      dayIndex: hint.dayIndex,
      title: hint.title,
      details,
      location: hint.location,
      startTime: hint.startTime,
      endTime: hint.endTime,
    });
  }

  return out;
}

function extractGlobalAfterWatchingSentence(
  text: string | null | undefined,
): string | null {
  const clean = normalizeWhitespace(text ?? "");
  if (!clean) return null;

  const quoted = clean.match(GLOBAL_AFTER_WATCHING_SENTENCE_RE)?.[1];
  const lessonQuoted = clean.match(GLOBAL_LESSON_REFLECTION_SENTENCE_RE)?.[1];
  const fallback = clean.match(GLOBAL_AFTER_WATCHING_LINE_RE)?.[1];
  const lessonFallback = clean.match(GLOBAL_LESSON_REFLECTION_LINE_RE)?.[1];
  const sentence = (quoted ?? lessonQuoted ?? fallback ?? lessonFallback ?? "")
    .replace(/^["“]+|["”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return sentence || null;
}

function extractLabeledSourceLine(
  details: string | null | undefined,
  label: string,
): string | null {
  const clean = normalizeWhitespace(details ?? "");
  if (!clean) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = clean.match(
    new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*([^\\n]+)`, "i"),
  );
  const value = (match?.[1] ?? "").replace(/\s+/g, " ").trim();
  return value || null;
}

function stripSourceUrlsForVisibleDetails(text: string): string {
  return text
    .replace(URL_RE, "the linked video")
    .replace(/\bwatch\s*:\s*the linked video\b/gi, "Watch the linked video")
    .replace(/\s+/g, " ")
    .trim();
}

function detailsForStructuredVideoSourceNote(
  hint: SourceDayHint,
  globalAfterWatchingSentence: string | null,
): string {
  const rawDetails = hint.details ?? "";
  const dayPrompt = extractLabeledSourceLine(rawDetails, "Prompt");
  const dayFocus = extractLabeledSourceLine(rawDetails, "Focus");
  const dayReflection = extractLabeledSourceLine(rawDetails, "Reflection");
  const parts: string[] = [];

  if (hint.location || looksLikeYoutubeUrl(rawDetails)) {
    parts.push("Watch the linked video.");
  }

  if (dayFocus || dayReflection || dayPrompt) {
    if (dayFocus) parts.push(`Focus: ${dayFocus}`);
    if (dayReflection) parts.push(`Reflection: ${dayReflection}`);
    if (!dayReflection && dayPrompt) parts.push(`Think about: ${dayPrompt}`);
  } else {
    const displayHint = calendarizeSourceDayHint(hint);
    const visible = stripSourceUrlsForVisibleDetails(
      displayHint.details ?? rawDetails,
    );
    if (visible) parts.push(visible);
  }

  if (globalAfterWatchingSentence) {
    const existing = parts.join(" ").toLowerCase();
    if (!existing.includes(globalAfterWatchingSentence.toLowerCase())) {
      parts.push(
        `After watching, say or write one sentence: "${globalAfterWatchingSentence}"`,
      );
    }
  }

  return parts.join(" ").replace(/\s+/g, " ").trim() ||
    "Watch the linked video and write one sentence about what you noticed.";
}

function defaultEndTimeForStart(startTime: string): string {
  const parsed = parseTimeToken(startTime);
  if (!parsed) return "13:00";
  const [hour, minute] = parsed.split(":").map((value) => parseInt(value, 10));
  return minutesToTime(hour * 60 + minute + 60);
}

export function buildStructuredSourceFlowNotes(args: {
  description: string | null | undefined;
  sourceText?: string | null;
  dateRangeDays: number;
  sourceHandling: SourceHandlingMode;
  requestedTimeWindow?: RequestedTimeWindow | null;
}): StructuredSourceFlowNote[] | null {
  const {
    description,
    sourceText,
    dateRangeDays,
    sourceHandling,
    requestedTimeWindow,
  } = args;

  if (!Number.isFinite(dateRangeDays) || dateRangeDays <= 0) return null;

  const combined = normalizeWhitespace(
    [description ?? "", sourceText ?? ""].filter(Boolean).join("\n\n"),
  );
  if (!combined) return null;
  if (
    sourceHandling !== "PRESERVE_STRUCTURE" &&
    !looksStructuredDayPlan(combined)
  ) {
    return null;
  }

  const sourceDayHints = parseSourceDayHints(combined, dateRangeDays);
  if (sourceDayHints.size < dateRangeDays) return null;

  const youtubeUrlCount = countYoutubeUrls(combined);
  const videoListRequested =
    /\b(each|every)\s+day\b[\s\S]{0,80}\b(?:video|youtube|watch|link)\b/i
      .test(combined) ||
    /\bwatch\s*:\s*(?:https?:\/\/|www\.)?(?:m\.)?(?:youtube\.com|youtu\.be)\//i
      .test(combined);
  const minimumVideoCoverage = Math.max(
    2,
    Math.ceil(dateRangeDays * 0.8),
  );
  if (!videoListRequested || youtubeUrlCount < minimumVideoCoverage) {
    return null;
  }

  const globalAfterWatchingSentence = extractGlobalAfterWatchingSentence(
    combined,
  );
  const inferredTimeWindow = requestedTimeWindow ??
    inferRequestedTimeWindow(combined);
  const notes: StructuredSourceFlowNote[] = [];

  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    const hint = sourceDayHints.get(dayIndex);
    if (!hint) return null;
    const displayHint = calendarizeSourceDayHint(hint);
    const rawLocation = displayHint.location?.trim() || hint.location?.trim() ||
      null;
    const location = normalizeYoutubeVideoUrl(rawLocation) ??
      sanitizeFlowLocation(rawLocation);
    if (!location || !looksLikeYoutubeUrl(location)) return null;

    const startTime = inferredTimeWindow?.startTime ??
      displayHint.startTime ?? "12:00";
    const endTime = inferredTimeWindow?.endTime ??
      displayHint.endTime ?? defaultEndTimeForStart(startTime);

    notes.push({
      day_index: dayIndex,
      title: displayHint.title?.trim() || `Day ${dayIndex + 1}`,
      details: detailsForStructuredVideoSourceNote(
        {
          ...hint,
          title: displayHint.title,
          location,
          startTime: displayHint.startTime,
          endTime: displayHint.endTime,
        },
        globalAfterWatchingSentence,
      ),
      all_day: false,
      start_time: startTime,
      end_time: endTime,
      location,
    });
  }

  return notes;
}

function cleanYoutubeVideoTitle(title: string | null | undefined): string {
  return normalizeWhitespace(title ?? "")
    .replace(
      /\s*,\s*(?:no|[\d,.]+(?:\s*(?:k|m|b|thousand|million|billion))?)\s+views?\s*-\s*play\s+short\s*$/i,
      "",
    )
    .replace(/\s*-\s*play\s+short\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function youtubeMathDifficultyScore(title: string): number {
  const text = title.toLowerCase();
  let score = 50;

  const has = (pattern: RegExp) => pattern.test(text);

  if (
    has(
      /\b(area|square|rectangle|fraction|fractions|gcd|add fractions|denominator|simplify)\b/,
    )
  ) {
    score = Math.min(score, 8);
  }
  if (
    has(/\b(slope|line|cartesian|coordinate|pythagorean|grid|count choices)\b/)
  ) {
    score = Math.min(score, 18);
  }
  if (
    has(
      /\b(circle|pi|π|ellipse|geometry|triangle|pyramid|volume|path|shortcut|mobius|möbius)\b/,
    )
  ) {
    score = Math.min(score, 28);
  }
  if (
    has(
      /\b(pattern|spiral|square roots?|magic square|pendulum|music|sound|lighthouse|sports?|penalty)\b/,
    )
  ) {
    score = Math.min(score, 34);
  }
  if (
    has(
      /\b(exponential|logarithm|logarithms|limit|function|inverse|equation|polynomial|e\^x|becomes e)\b/,
    )
  ) {
    score = Math.max(score, 44);
  }
  if (
    has(
      /\b(factorial|deck|shuffle|pigeonhole|pascal|triangular|binary search|hash table|sort|graph theory|monty hall|palindrome)\b/,
    )
  ) {
    score = Math.max(score, 56);
  }
  if (
    has(
      /\b(sine|cos|sin|trigonometry|integral|∫|calculus|feynman|quarter circle|π\/2|map-makers|map makers)\b/,
    )
  ) {
    score = Math.max(score, 66);
  }
  if (
    has(
      /\b(matrix|matrices|eigenvector|eigenvectors|linear algebra|linear independence|complex numbers?|rotation|vector)\b/,
    )
  ) {
    score = Math.max(score, 76);
  }
  if (
    has(
      /\b(cpu|gpu|tpu|kernel|thread|threads|computer|computers|code|draw curves)\b/,
    )
  ) {
    score = Math.max(score, 80);
  }
  if (
    has(
      /\b(ai|perceptron|sigmoid|relu|gradient descent|backpropagation|dropout|kernel trick|neural|model)\b/,
    )
  ) {
    score = Math.max(score, 88);
  }
  if (
    has(
      /\b0\/0|undefined|unsolvable|harvard|t\^t|lambert|infinity|π\/√2|sin\(x\)\/x\b/,
    )
  ) {
    score = Math.max(score, 72);
  }

  return score;
}

export function rankYoutubeChannelVideosForLearning(
  videos: YoutubeChannelVideoResource[],
): YoutubeChannelVideoResource[] {
  const seen = new Set<string>();
  const cleaned: Array<
    YoutubeChannelVideoResource & { originalIndex: number }
  > = [];

  for (const [originalIndex, video] of videos.entries()) {
    const normalizedUrl = normalizeYoutubeVideoUrl(video.url);
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    cleaned.push({
      ...video,
      title: cleanYoutubeVideoTitle(video.title) || "Daily Math Visual",
      url: normalizedUrl,
      originalIndex,
    });
  }

  return cleaned
    .sort((a, b) => {
      const scoreDiff = youtubeMathDifficultyScore(a.title) -
        youtubeMathDifficultyScore(b.title);
      if (scoreDiff !== 0) return scoreDiff;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ originalIndex: _originalIndex, ...video }) => video);
}

export function buildYoutubeChannelFlowNotes(args: {
  videos: YoutubeChannelVideoResource[];
  dateRangeDays: number;
  requestedTimeWindow?: RequestedTimeWindow | null;
}): StructuredSourceFlowNote[] | null {
  const { videos, dateRangeDays, requestedTimeWindow } = args;
  if (!Number.isFinite(dateRangeDays) || dateRangeDays <= 0) return null;

  const ranked = rankYoutubeChannelVideosForLearning(videos);
  if (ranked.length < dateRangeDays) return null;

  const startTime = requestedTimeWindow?.startTime ?? "12:00";
  const endTime = requestedTimeWindow?.endTime ?? defaultEndTimeForStart(
    startTime,
  );

  return ranked.slice(0, dateRangeDays).map((video, dayIndex) => ({
    day_index: dayIndex,
    title: video.title || `Daily Math Visual ${dayIndex + 1}`,
    details:
      `Watch the linked Daily Math Visuals short. Think about the idea in "${video.title}". After watching, say or write one sentence: "What did this video help me see?"`,
    all_day: false,
    start_time: startTime,
    end_time: endTime,
    location: normalizeYoutubeVideoUrl(video.url) ?? video.url,
  }));
}

export function buildVideoLearningOverview(
  flowName: string | null | undefined,
  dateRangeDays: number,
): SourceBackedOverview {
  const title = normalizeWhitespace(flowName ?? "") ||
    `${dayFlowLabel(dateRangeDays)} Video Learning Flow`;
  const lowerTitle = title.toLowerCase();
  const subject = /\bmath\b/.test(lowerTitle) ? "visual math" : "video-based";

  return {
    title,
    summary:
      `A ${dateRangeDays}-day ${subject} learning flow with one linked video each day. The sequence moves from beginner-friendly ideas toward more advanced topics, and each day ends with a short reflection about what the video helped the learner see.`,
  };
}

export function parseRecurringSourceRoutineHints(
  text: string,
  maxDays?: number,
): RecurringSourceRoutineHint[] {
  const clean = normalizeWhitespace(text);
  if (!clean) return [];
  const linkDefs = parseMarkdownLinkDefinitions(clean);
  const out: RecurringSourceRoutineHint[] = [];

  const matches = [
    ...clean.matchAll(
      new RegExp(
        RECURRING_ROUTINE_MARKER_RE.source,
        RECURRING_ROUTINE_MARKER_RE.flags,
      ),
    ),
  ];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const marker = match[0] ?? "";
    const markerText = `${match[1] ?? ""} ${match[3] ?? ""}`.trim();
    const dayRange = parseRoutineDayRange(markerText, maxDays);
    if (!dayRange) continue;

    const cadence = routineCadenceFromMarker(markerText);
    const blockStart = match.index ?? 0;
    const blockEnd = (() => {
      const afterMarker = blockStart + marker.length;
      const nextHeading = clean.slice(afterMarker).search(/\n\s*#{1,6}\s+/);
      if (nextHeading >= 0) return afterMarker + nextHeading;
      const nextDay = clean.slice(afterMarker).search(
        new RegExp(DAY_MARKER_RE.source, DAY_MARKER_RE.flags),
      );
      if (nextDay >= 0) return afterMarker + nextDay;
      return clean.length;
    })();
    const block = clean.slice(blockStart, blockEnd).trim();
    const details = cleanSourceHintDetails(block, linkDefs);
    if (!details) continue;

    const explicitTime = inferRequestedTimeWindow(details);
    const defaultTime = routineTimeForCadence(cadence);
    out.push({
      cadence,
      ...dayRange,
      title: routineTitleForCadence(cadence),
      details,
      startTime: explicitTime?.startTime ?? defaultTime.startTime,
      endTime: explicitTime?.endTime ?? defaultTime.endTime,
    });
  }

  return out;
}

export function buildSourceBackedOverview(
  description: string | null | undefined,
  sourceText?: string | null,
  dateRangeDays?: number,
): SourceBackedOverview | null {
  const text = normalizeWhitespace(
    [description ?? "", sourceText ?? ""].filter(Boolean).join("\n\n"),
  );
  if (!text) return null;

  const days = overviewDayCount(description, sourceText, dateRangeDays);
  const label = dayFlowLabel(days);
  const lower = dayFlowLabelLower(days);

  const isSkinBarrierCycle = /\bbarrier\b/i.test(text) &&
    /\bpigment|hyperpigmentation|dark marks?\b/i.test(text) &&
    /\b(adapalene|differin|azelaic|sunscreen|under-eye|puffiness)\b/i.test(
      text,
    );
  if (isSkinBarrierCycle) {
    return {
      title: `${label} Barrier, Pigment, Puffiness, and Definition Cycle`,
      summary:
        `A ${lower} skin reset built around Vanicream cleanser and moisturizer, tinted SPF, caffeine eye care, Differin, azelaic acid, one salicylic-acid test, and Vaseline rescue. The goal is calmer barrier, less puffiness, steadier dark-mark protection, and clear feedback on what your skin tolerates without irritation.`,
    };
  }

  if (looksLikeSpanishConjugationPrompt(text)) {
    return spanishConjugationOverview(days);
  }

  if (MEDU_NETER_PROMPT_RE.test(text)) {
    return meduNeterOverview(days);
  }

  if (looksLikeNamedSongInstrumentPrompt(text)) {
    return musicOverviewForPrompt(description, days);
  }

  if (SKINCARE_PROMPT_RE.test(text)) {
    return {
      title: `${label} Skincare Routine`,
      summary:
        `A structured ${lower} skincare flow with a simple morning routine, a day-specific night routine, and a short evening skin check. The goal is steadier cleansing, hydration, SPF, and irritation-aware progress you can actually track.`,
    };
  }

  if (KUNG_FU_PROMPT_RE.test(text)) {
    return {
      title: `${label} Kung Fu Practice Flow`,
      summary:
        `A structured ${lower} kung fu flow for stance work, footwork, strikes, kicks, and short evening review. The goal is better balance, cleaner basics, and enough specific feedback to make the next session sharper.`,
    };
  }

  if (isSparsePrompt(description, sourceText)) {
    return sparsePromptOverviewForDomain(
      description,
      inferSparsePromptDomain(description, sourceText),
      days,
    );
  }

  return null;
}
