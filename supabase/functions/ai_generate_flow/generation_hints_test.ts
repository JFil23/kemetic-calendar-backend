import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildConcreteActionDefaultsRule,
  buildEventDetailDensityRule,
  buildNoviceClarityRule,
  buildSourceBackedOverview,
  buildSparsePromptExpertDefaults,
  buildSparsePromptRoutineNotes,
  buildStructuredSourceFlowNotes,
  buildVideoLearningOverview,
  buildYoutubeChannelFlowNotes,
  calendarizeRecurringSourceRoutineHint,
  calendarizeSourceDayHint,
  countYoutubeUrls,
  extractFirstUrl,
  extractYoutubeChannelUrl,
  findUnderSpecifiedActionPlaceholder,
  hasUnderSpecifiedActionPlaceholder,
  hasUnsafeVisibleRepeatReference,
  hasVisibleNumberedInstructionList,
  inferFlowFormat,
  inferMode,
  inferRequestedTimeWindow,
  inferSourceHandling,
  inferSparsePromptDomain,
  looksLikeDetailedPreserveSource,
  looksLikeLongSourceDocument,
  looksLikeMealPlanFlow,
  looksLikeYoutubeUrl,
  looksStructuredDayPlan,
  mergePreservedDetails,
  normalizeYoutubeVideoUrl,
  parseRecurringSourceRoutineHints,
  parseSourceDayHints,
  sanitizeFlowLocation,
  stripUnsafeVisibleRepeatReferenceText,
  stripVisibleNumberedInstructionListMarkers,
  unsafeVisibleRepeatTargetDayIndex,
  wantsThreeMealDailyFlow,
  wantsYoutubeChannelVideoFlow,
  wantsYoutubeLinks,
} from "./generation_hints.ts";

Deno.test("inferRequestedTimeWindow handles explicit single time plus duration", () => {
  const result = inferRequestedTimeWindow(
    "turn this into a 10 day flow and schedule it for 7:30am for 30 minutes each day",
  );

  assertExists(result);
  assertEquals(result.startTime, "07:30");
  assertEquals(result.endTime, "08:00");
  assertEquals(result.source, "single");
});

Deno.test("inferRequestedTimeWindow handles explicit ranges", () => {
  const result = inferRequestedTimeWindow(
    "make this nightly from 6pm to 6:45pm for the next 10 days",
  );

  assertExists(result);
  assertEquals(result.startTime, "18:00");
  assertEquals(result.endTime, "18:45");
  assertEquals(result.source, "range");
});

Deno.test("inferRequestedTimeWindow handles noon phrasing", () => {
  const result = inferRequestedTimeWindow(
    "12 noon every day is when they watch",
  );

  assertExists(result);
  assertEquals(result.startTime, "12:00");
  assertEquals(result.endTime, "13:00");
  assertEquals(result.source, "single");
});

Deno.test("parseSourceDayHints captures day URLs from pasted plans", () => {
  const hints = parseSourceDayHints(
    `
- **Day 1: Lymphatic Drainage Focus**
  https://www.youtube.com/watch?v=FSwmDWL68gw
  (30 Min Slow Flow + Self-Massage for lymphatic support)

- **Day 2: Nervous System Calm**
  https://www.youtube.com/watch?v=40bPxbFUCj4
  (30 Minute Restorative Yoga for stress relief and deep calm)
`,
    10,
  );

  assertEquals(
    hints.get(0)?.location,
    "https://www.youtube.com/watch?v=FSwmDWL68gw",
  );
  assertEquals(
    hints.get(1)?.location,
    "https://www.youtube.com/watch?v=40bPxbFUCj4",
  );
});

Deno.test("buildStructuredSourceFlowNotes materializes a 90-day daily video ladder", () => {
  const days = [
    [
      "Area of Square",
      "https://www.youtube.com/shorts/Y9EynW7GVn8",
      "What does area mean when you can actually see it?",
    ],
    [
      "How to Simplify Fractions Using GCD",
      "https://www.youtube.com/shorts/YBlWcfyCo6U",
      "What does simplifying a fraction really do?",
    ],
    [
      "What Does the Number in y = 2x Really Mean?",
      "https://www.youtube.com/shorts/DAqRm2JPGsk",
      "What does slope tell us about a line?",
    ],
    [
      "This Algebra Equation Has NO SOLUTION",
      "https://www.youtube.com/shorts/hpYO6TQtC3U",
      "How can an equation look normal but have no answer?",
    ],
    [
      "Why (a+b)^2 Is Actually a Square",
      "https://www.youtube.com/shorts/ozSkfIzJHg0",
      "How does algebra become a picture?",
    ],
    [
      "Why a² − b² Is Actually a Rectangle",
      "https://m.youtube.com/shorts/8lcelJLhG2o",
      "What happens when one square is removed from another?",
    ],
    [
      "The 9-Tile Secret: Visualizing (a+b+c)^2",
      "https://www.youtube.com/shorts/7dZfAI_ztPk",
      "How do tiles help explain algebra?",
    ],
    [
      "Why Do Cubes Add Up to a Perfect Square?",
      "https://www.youtube.com/shorts/q1DCRIxEqCQ",
      "What pattern appears when cubes stack together?",
    ],
    [
      "The Pythagorean Theorem, Rebuilt From First Principles",
      "https://www.youtube.com/shorts/M4tRtg9v3vU",
      "Why does a² + b² = c² make visual sense?",
    ],
    [
      "Why a Straight Line Is the Shortest Path",
      "https://www.youtube.com/shorts/5UnfwDHaOok",
      "Why is the direct path usually the shortest?",
    ],
    [
      "The Spider’s Shortcut",
      "https://www.youtube.com/shorts/S7ZpbvyFgPk",
      "How can unfolding a shape reveal the shortcut?",
    ],
    [
      "This Sum Never Changes",
      "https://www.youtube.com/shorts/LmdPPw8_ZAk",
      "What stays the same no matter where the point moves?",
    ],
    [
      "This Geometry Puzzle Has an Elegant Answer",
      "https://www.youtube.com/shorts/tCYXMxEzUUM",
      "What hidden structure solves the puzzle?",
    ],
    [
      "How Many Rectangles in an 8×8 Grid?",
      "https://www.youtube.com/shorts/4_F1tIeXKVY",
      "Why do we count choices instead of drawing every rectangle?",
    ],
    [
      "Where Does π Come From?",
      "https://www.youtube.com/shorts/DDlwZke9nVQ",
      "What does rolling a circle reveal about π?",
    ],
    [
      "Where Does πr² Come From?",
      "https://www.youtube.com/shorts/GLgmYIcmJds",
      "Why does the circle’s area connect to a triangle?",
    ],
    [
      "A Circle Inside a Circle",
      "https://www.youtube.com/shorts/Ewu8vpCPEcI",
      "What kind of curve appears when one circle rolls inside another?",
    ],
    [
      "Why Pyramid Volume = ⅓ × Base × Height",
      "https://www.youtube.com/shorts/LzXzh878wpg",
      "Why does the pyramid formula need one-third?",
    ],
    [
      "Why Sin²θ + Cos²θ = 1",
      "https://www.youtube.com/shorts/fjHHOy5Nyb4",
      "How is trigonometry hiding inside a circle?",
    ],
    [
      "The sin(a+b) Formula Finally Makes Sense",
      "https://www.youtube.com/shorts/2zVIYLsiBXg",
      "What does the formula show visually?",
    ],
    [
      "Why Strikers Cut Inside Before They Shoot",
      "https://www.youtube.com/shorts/402ddJ-_jPs",
      "How does geometry affect sports?",
    ],
    [
      "A Perfect Penalty Outruns Reaction Time",
      "https://www.youtube.com/shorts/P2NO1FDLmkg",
      "How can math explain reaction time?",
    ],
    [
      "Why Music Sounds Good",
      "https://www.youtube.com/shorts/r9r9jaypZQQ",
      "What does math have to do with sound?",
    ],
    [
      "How Do Ships Navigate Using a Lighthouse?",
      "https://www.youtube.com/shorts/fDTjy1bdfbU",
      "How can rotation help people find direction?",
    ],
    [
      "15 Pendulums",
      "https://www.youtube.com/shorts/uHne_bt-CII",
      "What pattern appears when motion repeats?",
    ],
    [
      "The Möbius Strip",
      "https://www.youtube.com/shorts/BYJ7UhxXFZA",
      "How can one shape have only one side?",
    ],
    [
      "The Lo Shu Square",
      "https://www.youtube.com/shorts/y0-CTf8PmY0",
      "What makes a magic square “magic”?",
    ],
    [
      "The Spiral Hidden Inside Square Roots",
      "https://www.youtube.com/shorts/kgORwuMVJrs",
      "How can square roots become a spiral?",
    ],
    [
      "The Hidden Constant in a Rotating Square",
      "https://www.youtube.com/shorts/qlmA7E6qZCs",
      "What stays the same while the square moves?",
    ],
    [
      "When an Ellipse Becomes a Cylinder",
      "https://www.youtube.com/shorts/DtMuHrZluAI",
      "How does a 2D shape become a 3D object?",
    ],
    [
      "Why an Egg Is NOT an Ellipse",
      "https://www.youtube.com/shorts/S5HBTmk4ldo",
      "Why are real-world shapes harder than textbook shapes?",
    ],
    [
      "What Happens When You Bend a Spring Into a Circle?",
      "https://www.youtube.com/shorts/Fwpb2ojcbS4",
      "What kind of shape appears from circular motion?",
    ],
    [
      "The Math of Mountains",
      "https://www.youtube.com/shorts/NC4uoubKFd8",
      "How can math build a landscape?",
    ],
    [
      "Why $1 Becomes e",
      "https://www.youtube.com/shorts/B82_jAMayPM",
      "Why does repeated growth create the number e?",
    ],
    [
      "Why Magnitude 7 Is 100× a 5",
      "https://www.youtube.com/shorts/hXG29YSeu7M",
      "Why do logarithms help compare huge changes?",
    ],
    [
      "What Is a Limit?",
      "https://www.youtube.com/shorts/xKnsPgihiug",
      "What does it mean for a value to approach something?",
    ],
    [
      "x² vs 1.1^x",
      "https://www.youtube.com/shorts/pjCJja2-n3U",
      "Why can slow exponential growth eventually win?",
    ],
    [
      "Three Functions Behave. The Fourth Surprises You.",
      "https://www.youtube.com/shorts/Fel3A10C1jM",
      "What does an inverse function do?",
    ],
    [
      "The Function That Solves the UNSOLVABLE",
      "https://www.youtube.com/shorts/8v9ZCuI-cEA",
      "Why do some equations need new kinds of functions?",
    ],
    [
      "Harvard Math Problem: t^t = 49",
      "https://www.youtube.com/shorts/32Q8veFRD3Q",
      "Why is guessing not enough here?",
    ],
    [
      "Why 1 + 1/2 + 1/3 + … = Infinity",
      "https://www.youtube.com/shorts/p0ufANPceOQ",
      "How can tiny pieces still add up forever?",
    ],
    [
      "The Area Under One Arch of Sine = 2",
      "https://www.youtube.com/shorts/ULFIxo-Xt0E",
      "How does area connect to a wave?",
    ],
    [
      "Why ∫sin(x)dx = -cos(x)",
      "https://www.youtube.com/shorts/uO8BvPXCOzA",
      "How can motion around a circle explain an integral?",
    ],
    [
      "The Integral of e^x Equals e^x",
      "https://www.youtube.com/shorts/-cdD4yl5OwM",
      "Why is e^x special?",
    ],
    [
      "This Integral Is a Quarter Circle",
      "https://www.youtube.com/shorts/XbeXC8ocRts",
      "How can an integral secretly be geometry?",
    ],
    [
      "The Integral That Equals ZERO",
      "https://www.youtube.com/shorts/0UbhMLAk8-Y",
      "How can symmetry make an answer disappear?",
    ],
    [
      "This Integral Gives the Same Answer No Matter What",
      "https://www.youtube.com/shorts/gczr-9RFN4M",
      "What stays fixed even when the curve changes?",
    ],
    [
      "The Integral That Stumped Map-Makers",
      "https://www.youtube.com/shorts/UB-7NNkvpHA",
      "Why would map-making need calculus?",
    ],
    [
      "The Integral That Hides π/√2",
      "https://www.youtube.com/shorts/ChE0snd4798",
      "Why does π appear in unexpected places?",
    ],
    [
      "Why ∫ sin(x)/x = π/2",
      "https://www.youtube.com/shorts/TnP0qLUqc3w",
      "How can a hard integral be solved by changing the question?",
    ],
    [
      "Watch a Polynomial Become the Sine Wave",
      "https://www.youtube.com/shorts/c6atsiO-1Ws",
      "How can a wave be built from powers?",
    ],
    [
      "Why 0! = 1",
      "https://www.youtube.com/shorts/cV4UR3af9Ng",
      "Why does zero factorial need to equal one?",
    ],
    [
      "How Many Zeros at the End of 1000!?",
      "https://www.youtube.com/shorts/GwKSoNDWndk",
      "Why do factors of 10 matter?",
    ],
    [
      "Why Every Shuffled Deck Is Unique",
      "https://www.youtube.com/shorts/XwavLcb5dd8",
      "Why are there so many possible card orders?",
    ],
    [
      "INSTAGRAM = GRIM SATAN",
      "https://www.youtube.com/shorts/HrhkG9w7BuM",
      "How can rearranging letters become math?",
    ],
    [
      "Why Sheldon Said 73 Is the Best Number",
      "https://www.youtube.com/shorts/bmjLDFwvHGM",
      "What makes a number interesting?",
    ],
    [
      "Why Your Calculator Says ERROR for (-2)!",
      "https://www.youtube.com/shorts/lNVEEyC5SG0",
      "Why do some operations stop working?",
    ],
    [
      "42 Paper Folds Reaches the Moon",
      "https://www.youtube.com/shorts/3JLXnnIIMxc",
      "How does doubling become enormous?",
    ],
    [
      "The Math Rule That Proves the Impossible",
      "https://www.youtube.com/shorts/zv9CkWkLJG0",
      "What does the pigeonhole principle guarantee?",
    ],
    [
      "10 Princesses, 3 Classes",
      "https://www.youtube.com/shorts/1VbomAKsmKM",
      "How can counting prove something must happen?",
    ],
    [
      "14 Workers: The Minimum to Guarantee a Full Team",
      "https://www.youtube.com/shorts/ADBpfHqWBG0",
      "How do guarantees work in counting problems?",
    ],
    [
      "Pascal’s Triangle Has a Secret Pattern",
      "https://www.youtube.com/shorts/XNIaAeF8zNc",
      "What patterns appear when numbers stack?",
    ],
    [
      "Triangular Numbers Hidden in Pascal’s Triangle",
      "https://www.youtube.com/shorts/8Mw_bwmiDUE",
      "Where do triangular numbers show up?",
    ],
    [
      "This Ancient Puzzle Has a Perfect Solution",
      "https://www.youtube.com/shorts/MuY9Zh7Ne6Y",
      "What pattern solves the puzzle?",
    ],
    [
      "The Frog and the Well",
      "https://www.youtube.com/shorts/bsEd5zYV_-A",
      "Why is the obvious answer wrong?",
    ],
    [
      "The Walking Puzzle That Invented Graph Theory",
      "https://www.youtube.com/shorts/m3DtmQTapHQ",
      "How can a walking puzzle become a new field of math?",
    ],
    [
      "Find 1 in a Billion in 30 Guesses",
      "https://www.youtube.com/shorts/PAeFohfO02c",
      "Why is cutting the problem in half powerful?",
    ],
    [
      "Binary Search Among 1 Million",
      "https://www.youtube.com/shorts/oan9C52tVh0",
      "How does binary search save time?",
    ],
    [
      "Binary Search on Strings",
      "https://www.youtube.com/shorts/7PlqtAk9V00",
      "How can the same math work on words?",
    ],
    [
      "How Hash Tables Find Anything in 1 Step",
      "https://www.youtube.com/shorts/h3r9-4urKzE",
      "How does a hash table turn searching into arithmetic?",
    ],
    [
      "Bubble Sort Explained",
      "https://www.youtube.com/shorts/LWaKIgg5Z7k",
      "Why is sorting a list harder than it looks?",
    ],
    [
      "How a GPU Runs 270,000 Threads at Once",
      "https://www.youtube.com/shorts/xkQIuGbLQ5k",
      "How does parallel work change speed?",
    ],
    [
      "Your First GPU Kernel in 3 Lines of Code",
      "https://www.youtube.com/shorts/HYLT1_Gb0mE",
      "How can many tiny workers solve one big problem?",
    ],
    [
      "CPU vs GPU",
      "https://www.youtube.com/shorts/n-lpWVpEfgo",
      "What is the difference between one smart worker and many simple workers?",
    ],
    [
      "GPU vs TPU",
      "https://www.youtube.com/shorts/lCli1f5MrWc",
      "Why are different machines built for different math?",
    ],
    [
      "The Identity Matrix Explained",
      "https://www.youtube.com/shorts/cbnhfrAPCIo",
      "Why is the identity matrix like the number 1?",
    ],
    [
      "The Undo Button of Linear Algebra",
      "https://www.youtube.com/shorts/31CY6Ct9OYE",
      "What does an inverse matrix undo?",
    ],
    [
      "Why Google Uses Eigenvectors to Rank the Internet",
      "https://www.youtube.com/shorts/c86OaJuDCbg",
      "How can repeated movement reveal importance?",
    ],
    [
      "The Cartesian Plane Is One of the Most Powerful Ideas in Math",
      "https://www.youtube.com/shorts/jQnLcfJoBg8",
      "How does the coordinate plane help us move and rotate?",
    ],
    [
      "Why Complex Numbers Make Rotation Simple",
      "https://www.youtube.com/shorts/46fA0v6zkZk",
      "How can imaginary numbers help with real motion?",
    ],
    [
      "How Computers Draw Curves",
      "https://www.youtube.com/shorts/xLLZ9V5MJs4",
      "How do computers create smooth curves?",
    ],
    [
      "Why king − man + woman = queen",
      "https://www.youtube.com/shorts/YlsJ_D2EIuY",
      "How can meaning become geometry?",
    ],
    [
      "The “+b” That Lets AI Exist",
      "https://www.youtube.com/shorts/9122zJtMUtE",
      "Why does shifting a line matter in AI?",
    ],
    [
      "Perceptron Explained Visually",
      "https://www.youtube.com/shorts/DXOyzpTK4qQ",
      "What is the smallest learning machine?",
    ],
    [
      "The Sigmoid Function Explained",
      "https://www.youtube.com/shorts/HdiKxlBJLbE",
      "How can a function turn numbers into decisions?",
    ],
    [
      "ReLU Explained",
      "https://www.youtube.com/shorts/0pMKiW_UQQs",
      "Why is a simple function powerful for AI?",
    ],
    [
      "How AI Actually Learns: Gradient Descent",
      "https://www.youtube.com/shorts/nfYo_MMiYMQ",
      "How does AI move toward a better answer?",
    ],
    [
      "Backpropagation Explained",
      "https://www.youtube.com/shorts/OZBnJQPWD6A",
      "How does a neural network learn from mistakes?",
    ],
    [
      "Dropout Explained",
      "https://www.youtube.com/shorts/bR1JP92jBIo",
      "Why would turning parts off make a model stronger?",
    ],
    [
      "The Kernel Trick Explained Visually",
      "https://www.youtube.com/shorts/Fo1aw1glI0k",
      "How can lifting a problem into another dimension make it easier?",
    ],
  ];

  assertEquals(days.length, 90);

  const prompt = [
    "Create a 90-day learning flow called “Daily Math Visuals: 90-Day Visual Math Ladder.”",
    "",
    "Schedule:",
    "- One task per day for 90 days.",
    "- Time: 12:00 PM every day.",
    "- Each day should have one video link.",
    "- After watching, ask the kids to say or write one sentence: “What did this video help me see?”",
    "",
    ...days.flatMap(([title, url, dayPrompt], index) => [
      `Day ${index + 1} — ${title}`,
      `Watch: ${url}`,
      `Prompt: ${dayPrompt}`,
      "",
    ]),
  ].join("\n");

  const requestedTimeWindow = inferRequestedTimeWindow(prompt);
  assertExists(requestedTimeWindow);
  const notes = buildStructuredSourceFlowNotes({
    description: prompt,
    dateRangeDays: 90,
    sourceHandling: inferSourceHandling(prompt),
    requestedTimeWindow,
  });

  assertExists(notes);
  assertEquals(notes.length, 90);
  assertEquals(new Set(notes.map((note) => note.day_index)).size, 90);
  assertEquals(notes.every((note) => note.start_time === "12:00"), true);
  assertEquals(notes.every((note) => note.end_time === "13:00"), true);
  assertEquals(
    notes.every((note) =>
      note.location?.startsWith("https://www.youtube.com/watch?v=")
    ),
    true,
  );
  assertEquals(
    notes.filter((note) => (note.details.match(/https?:\/\//g) ?? []).length)
      .length,
    0,
  );
  assertStringIncludes(notes[0].details, "Watch the linked video.");
  assertStringIncludes(notes[0].details, "What did this video help me see?");
  assertStringIncludes(notes[89].details, days[89][2]);
  assertEquals(
    notes[5].location,
    "https://www.youtube.com/watch?v=8lcelJLhG2o",
  );

  const appSplitDescription = [
    "USER_INTENT_SUMMARY:",
    "Create a 90-day learning flow called Daily Math Visuals.",
    "",
    "Transform SOURCE_TEXT into a flow for the selected date range. Preserve concrete initiatives, constraints, milestones, numbers, sequence, and voice from SOURCE_TEXT. Organize it into a clear progression instead of generic summaries.",
  ].join("\n");
  const appSplitTimeWindow = inferRequestedTimeWindow(appSplitDescription) ??
    inferRequestedTimeWindow(prompt);
  const appSplitNotes = buildStructuredSourceFlowNotes({
    description: appSplitDescription,
    sourceText: prompt,
    dateRangeDays: 90,
    sourceHandling: inferSourceHandling(appSplitDescription, prompt),
    requestedTimeWindow: appSplitTimeWindow,
  });

  assertExists(appSplitNotes);
  assertEquals(appSplitNotes.length, 90);
  assertEquals(appSplitNotes[89].title, "The Kernel Trick Explained Visually");

  const classifierMismatchNotes = buildStructuredSourceFlowNotes({
    description: "Create a 90-day learning flow from this source material.",
    sourceText: prompt,
    dateRangeDays: 90,
    sourceHandling: "SYNTHESIZE_FROM_SOURCE",
    requestedTimeWindow,
  });

  assertExists(classifierMismatchNotes);
  assertEquals(classifierMismatchNotes.length, 90);
  assertEquals(classifierMismatchNotes[0].location?.includes("watch?v="), true);
});

Deno.test("parseSourceDayHints handles markdown day headings and preserves rich details", () => {
  const hints = parseSourceDayHints(
    `
## DAY 4 — Install Exhaust System (MOST IMPORTANT DAY)

**Goal:** Control heat + smell

### Materials

* Inline fan (4-inch)
* Carbon filter
* Ducting

### What to do

* Mount carbon filter inside top of tent
* Connect fan -> duct -> outside space

👉 Key principle:
Air should be pulled through the filter, not pushed.

[Carbon Filter & Fan Setup (Odor Control)](https://www.youtube.com/watch?v=ZYEnWBJVC2Q&utm_source=chatgpt.com)

## DAY 5 — Dial Airflow

Ventilation prevents heat buildup and mold and keeps conditions stable. ([youtube.com][4])

[4]: https://www.youtube.com/watch?v=1DiyFlvidbI&utm_source=chatgpt.com
`,
    10,
  );

  const day4 = hints.get(3);
  assertExists(day4);
  assertEquals(day4.title, "Install Exhaust System (MOST IMPORTANT DAY)");
  assertEquals(
    day4.location,
    "https://www.youtube.com/watch?v=ZYEnWBJVC2Q&utm_source=chatgpt.com",
  );
  assertStringIncludes(day4.details ?? "", "Materials");
  assertStringIncludes(
    day4.details ?? "",
    "Connect fan -> duct -> outside space",
  );
  assertStringIncludes(
    day4.details ?? "",
    "Carbon Filter & Fan Setup (Odor Control) (https://www.youtube.com/watch?v=ZYEnWBJVC2Q&utm_source=chatgpt.com)",
  );

  const day5 = hints.get(4);
  assertExists(day5);
  assertEquals(
    day5.location,
    "https://www.youtube.com/watch?v=1DiyFlvidbI&utm_source=chatgpt.com",
  );
  assertStringIncludes(
    day5.details ?? "",
    "youtube.com (https://www.youtube.com/watch?v=1DiyFlvidbI&utm_source=chatgpt.com)",
  );
});

Deno.test("parseSourceDayHints keeps trailing global sections out of the last day", () => {
  const hints = parseSourceDayHints(
    `
### Day 10 — Assessment + recovery

Morning:
Normal routine. Take a photo in the same lighting as Day 1.

Night:
Cleanse.
Moisturizer.
Vaseline only on dry patches.

Score puffiness, clarity, oiliness, dryness, bumps, dark marks, definition, sleep, salt, and workouts.

---

# Diet rules for the 10-day decan

Protein: 30-40g per meal.

# Product buy list, ranked

Vanicream cleanser, moisturizer, sunscreen, Differin, azelaic acid.

# The exact bad combinations to avoid

Do not use Differin and salicylic acid on the same night.
`,
    10,
  );

  const day10 = hints.get(9);
  assertExists(day10);
  assertStringIncludes(day10.details ?? "", "Take a photo");
  assertStringIncludes(day10.details ?? "", "Score puffiness");
  assertEquals((day10.details ?? "").includes("Diet rules"), false);
  assertEquals((day10.details ?? "").includes("Product buy list"), false);
  assertEquals((day10.details ?? "").includes("bad combinations"), false);
});

Deno.test("parseSourceDayHints removes leading source shortcut lines when details remain", () => {
  const hints = parseSourceDayHints(
    `
### Day 2 — Adapalene night

Cleanse.
Wait until face is fully dry, ideally 10–20 minutes.
Apply Differin/adapalene 0.1%, one pea-sized amount for entire face.
Avoid under-eyes, eyelids, corners of nose, corners of mouth.
After 10 minutes, apply Vanicream moisturizer.

### Day 6 — Adapalene night

Repeat Day 2.

Cleanse.
Dry face.
Differin pea-sized amount.
Moisturizer.

No azelaic acid. No salicylic acid. No vitamin C.

### Day 7 — Under-eye + salt audit day

Morning routine as usual.

Today’s food rule:

* No late salty meal.
* Stop heavy fluids 90 minutes before bed.

Night:
Cleanse.
Moisturizer.
`,
    10,
  );

  const day6 = hints.get(5);
  const day7 = hints.get(6);
  assertExists(day6);
  assertExists(day7);
  assertEquals((day6.details ?? "").includes("Repeat Day 2"), false);
  assertStringIncludes(day6.details ?? "", "Wait until face is fully dry");
  assertStringIncludes(day6.details ?? "", "Avoid under-eyes");
  assertStringIncludes(day6.details ?? "", "one pea-sized amount");
  assertStringIncludes(day6.details ?? "", "No azelaic acid");
  assertEquals(
    (day7.details ?? "").includes("Morning routine as usual"),
    false,
  );
  assertStringIncludes(day7.details ?? "", "No late salty meal");
});

Deno.test("parseSourceDayHints expands explicit repeated source days with full referenced details", () => {
  const hints = parseSourceDayHints(
    `
### Day 4 — Azelaic acid night

Cleanse.
Apply The Ordinary Azelaic Acid 10%, pea-sized amount.
Wait 5 minutes.
Apply moisturizer.

### Day 8 — Azelaic acid night

Repeat Day 4.

Cleanse.
Azelaic acid 10%.
Moisturizer.

Optional: very thin Vaseline on dry patches after moisturizer.
`,
    10,
  );

  const day8 = hints.get(7);
  assertExists(day8);
  assertEquals((day8.details ?? "").includes("Repeat Day 4"), false);
  assertStringIncludes(day8.details ?? "", "Apply The Ordinary Azelaic Acid");
  assertStringIncludes(day8.details ?? "", "Wait 5 minutes");
  assertStringIncludes(day8.details ?? "", "Optional: very thin Vaseline");
});

Deno.test("parseSourceDayHints drops duplicated simplified residual steps from repeated days", () => {
  const hints = parseSourceDayHints(
    `
### Day 2 — Adapalene night

Cleanse.
Wait until face is fully dry, ideally 10–20 minutes.
Apply Differin/adapalene 0.1%, one pea-sized amount for entire face.
Avoid under-eyes, eyelids, corners of nose, corners of mouth.
After 10 minutes, apply Vanicream moisturizer.

### Day 6 — Adapalene night

Repeat Day 2.
Cleanse.
Dry face.
Differin pea-sized amount.
Moisturizer.
No azelaic acid. No salicylic acid. No vitamin C. No exfoliating scrub.
`,
    10,
  );

  const day6 = hints.get(5);
  assertExists(day6);
  assertStringIncludes(day6.details ?? "", "Wait until face is fully dry");
  assertStringIncludes(day6.details ?? "", "Avoid under-eyes");
  assertStringIncludes(day6.details ?? "", "No azelaic acid");
  assertEquals((day6.details ?? "").includes("Dry face."), false);
  assertEquals(
    (day6.details ?? "").includes("Differin pea-sized amount."),
    false,
  );
});

Deno.test("visible repeat helpers catch and strip user-hostile repeat pointers", () => {
  const details =
    "Repeat the morning routine from Day 1. Ensure to cleanse properly and apply all products as instructed.";

  assertEquals(hasUnsafeVisibleRepeatReference(details), true);
  assertEquals(unsafeVisibleRepeatTargetDayIndex(details, 1), 0);
  assertEquals(stripUnsafeVisibleRepeatReferenceText(details), "");
  assertEquals(
    hasUnsafeVisibleRepeatReference(
      "Take a photo in the same lighting as Day 1.",
    ),
    false,
  );
  assertEquals(
    stripUnsafeVisibleRepeatReferenceText(
      "Repeat Day 2. No azelaic acid. No salicylic acid.",
    ),
    "No azelaic acid. No salicylic acid.",
  );
});

Deno.test("visible numbered instruction helpers strip leading numeric steps", () => {
  const single =
    "1. Spend 20 minutes studying a reference book or online resource to learn 10 common symbols.";
  assertEquals(hasVisibleNumberedInstructionList(single), true);
  assertEquals(
    stripVisibleNumberedInstructionListMarkers(single),
    "Spend 20 minutes studying a reference book or online resource to learn 10 common symbols.",
  );

  const multi = [
    "1. Open one page of symbols.",
    "2. Copy three signs by hand.",
    "3. Close the source and recall one meaning.",
  ].join("\n");
  assertEquals(hasVisibleNumberedInstructionList(multi), true);
  assertEquals(
    stripVisibleNumberedInstructionListMarkers(multi),
    "Open one page of symbols. Copy three signs by hand. Close the source and recall one meaning.",
  );

  const prose =
    "Open one page of symbols, copy three signs, and recall one meaning.";
  assertEquals(hasVisibleNumberedInstructionList(prose), false);
  assertEquals(stripVisibleNumberedInstructionListMarkers(prose), prose);
});

Deno.test("parseRecurringSourceRoutineHints captures every-morning range details", () => {
  const hints = parseRecurringSourceRoutineHints(
    `
## Every morning — Days 1–10

**Step 1 — rinse or cleanse**

* If oily/sweaty: Vanicream cleanser, nickel-size, 30–45 seconds.
* If dry/normal: rinse with lukewarm water only.

**Step 2 — cold under-eye reset**

* Cold spoon, chilled eye mask, or cold damp cloth for **2 minutes**.

**Step 5 — sunscreen**

* Colorescience Face Shield Flex SPF 50 or CeraVe Tinted Mineral SPF 30.
* Two-finger amount.

## Night routine by decan day

### Day 1 — Barrier baseline

Cleanse with Vanicream.
`,
    10,
  );

  assertEquals(hints.length, 1);
  assertEquals(hints[0].cadence, "morning");
  assertEquals(hints[0].startDayIndex, 0);
  assertEquals(hints[0].endDayIndex, 9);
  assertEquals(hints[0].title, "Morning routine");
  assertEquals(hints[0].startTime, "09:00");
  assertEquals(hints[0].endTime, "09:30");
  assertStringIncludes(hints[0].details, "Vanicream cleanser");
  assertStringIncludes(hints[0].details, "cold under-eye reset");
  assertStringIncludes(hints[0].details, "Two-finger amount");
  assertEquals(hints[0].details.includes("Night routine"), false);
  assertEquals(hints[0].details.includes("Barrier baseline"), false);
});

Deno.test("parseRecurringSourceRoutineHints ignores global daily non-negotiable sections", () => {
  const hints = parseRecurringSourceRoutineHints(
    `
## Every morning — Days 1–10

Cleanse, moisturize, sunscreen.

# Diet rules for the 10-day decan

## Daily non-negotiables

Protein: 30-40g per meal.

## Under-eye/bloating rules

For 10 days:
- No salty meal within 3 hours of bed.
`,
    10,
  );

  assertEquals(hints.length, 1);
  assertEquals(hints[0].cadence, "morning");
  assertEquals(hints[0].details.includes("Protein"), false);
});

Deno.test("source parsers identify two-event skincare routine structure", () => {
  const source = `
## Every morning — Days 1–10

Cleanse or rinse, use a 2-minute cold under-eye reset, apply caffeine eye cream, moisturize, apply two-finger sunscreen, and do posture reset.

## Night routine by decan day

### Day 1 — Barrier baseline

Cleanse with Vanicream. Apply moisturizer. Use Vaseline only on dry patches.

### Day 2 — Adapalene night

Cleanse. Dry face. Apply Differin pea-sized amount. Moisturizer.

### Day 3 — Recovery + drainage

Cleanse. Moisturizer. Do 3-minute drainage.

### Day 4 — Azelaic acid night

Cleanse. Apply azelaic acid 10%. Moisturizer.

### Day 5 — Sweat + deep cleanse day

Workout today, then cleanse after sweating. Night: cleanse and moisturize.

### Day 6 — Adapalene night

Repeat Day 2.

Cleanse. Dry face. Differin pea-sized amount. Moisturizer.

### Day 7 — Under-eye + salt audit day

Morning routine as usual.

No late salty meal. Night: cleanse, eye cream, moisturizer.

### Day 8 — Azelaic acid night

Repeat Day 4.

Cleanse. Azelaic acid 10%. Moisturizer.

### Day 9 — Salicylic acid test night

Cleanse. Apply salicylic acid only to congested zones. Moisturizer.

### Day 10 — Assessment + recovery

Morning: normal routine and photo. Night: cleanse, moisturize, score puffiness and clarity.
`;

  const recurring = parseRecurringSourceRoutineHints(source, 10);
  const dayHints = parseSourceDayHints(source, 10);
  const expectedCounts = Array.from({ length: 10 }, (_unused, dayIndex) => {
    const recurringCount = recurring.filter((hint) =>
      dayIndex >= hint.startDayIndex && dayIndex <= hint.endDayIndex
    ).length;
    return recurringCount + (dayHints.has(dayIndex) ? 1 : 0);
  });

  assertEquals(recurring.length, 1);
  assertEquals(dayHints.size, 10);
  assertEquals(expectedCounts, Array(10).fill(2));
  assertEquals(
    (dayHints.get(5)?.details ?? "").includes("Repeat Day 2"),
    false,
  );
  assertEquals(
    (dayHints.get(6)?.details ?? "").includes("Morning routine as usual"),
    false,
  );
  assertEquals(
    (dayHints.get(7)?.details ?? "").includes("Repeat Day 4"),
    false,
  );
});

Deno.test("calendarized skincare source hints use night titles and prose details", () => {
  const hint = calendarizeSourceDayHint({
    dayIndex: 1,
    title: "Adapalene night",
    details:
      "Cleanse.\nWait until face is fully dry, ideally 10–20 minutes.\nApply Differin/adapalene 0.1%, one pea-sized amount for entire face.\nAvoid under-eyes, eyelids, corners of nose, corners of mouth.\nAfter 10 minutes, apply Vanicream moisturizer.\n\nIf your skin is sensitive: moisturizer first, then Differin, then moisturizer again.",
  });

  assertEquals(hint.title, "Night routine - Adapalene");
  assertEquals(hint.startTime, "20:00");
  assertEquals(hint.endTime, "20:30");
  assertStringIncludes(hint.details ?? "", "Tonight is the adapalene block.");
  assertStringIncludes(hint.details ?? "", "Wait until face is fully dry");
  assertStringIncludes(hint.details ?? "", "one pea-sized amount");
  assertStringIncludes(hint.details ?? "", "Avoid under-eyes");
  assertEquals(/\n\s*[-*•]/.test(hint.details ?? ""), false);
  assertEquals((hint.details ?? "").includes("Cleanse.\n"), false);
});

Deno.test("calendarized recurring skincare routine removes step-list mechanics", () => {
  const hint = calendarizeRecurringSourceRoutineHint({
    cadence: "morning",
    startDayIndex: 0,
    endDayIndex: 9,
    title: "Morning routine",
    startTime: "09:00",
    endTime: "09:30",
    details:
      "**Step 1 — rinse or cleanse**\n\n- If oily/sweaty: Vanicream cleanser, nickel-size, 30–45 seconds.\n- If dry/normal: rinse with lukewarm water only.\n\n**Step 6 — posture reset**\n\n- 10 chin tucks.\n- 60-second wall posture hold.",
  });

  assertEquals(hint.title, "Morning routine");
  assertStringIncludes(hint.details, "Rinse or cleanse");
  assertStringIncludes(hint.details, "Vanicream cleanser");
  assertStringIncludes(hint.details, "10 chin tucks");
  assertEquals(/\bStep\s+\d+\b/i.test(hint.details), false);
  assertEquals(/\n\s*[-*•]/.test(hint.details), false);
});

Deno.test("buildSourceBackedOverview preserves skin-cycle guardrails", () => {
  const overview = buildSourceBackedOverview(`
Turn this into a 10 day flow:

Your highest-return routine is a 10-day barrier + pigment + puffiness + definition cycle built around cleanser, moisturizer, tinted sunscreen, adapalene/azelaic acid rotation, sweat/body-composition work, under-eye de-puff control, and petrolatum rescue when needed. For Black/darker skin, irritation becomes pigment.

Do not use Differin + salicylic acid same night, Differin + azelaic acid same night, or salicylic acid + azelaic acid same night. No scrubs, no home microneedling, no jaw trainers, no new vitamin C serum, and no full-face Vaseline slugging at first.

Diet support: protein and vitamin C foods daily, low-glycemic carbs, sodium/fluid control, and consistent sleep.
`);

  assertExists(overview);
  assertEquals(
    overview.title,
    "10-Day Barrier, Pigment, Puffiness, and Definition Cycle",
  );
  assertEquals(
    overview.summary,
    "A 10-day skin reset built around Vanicream cleanser and moisturizer, tinted SPF, caffeine eye care, Differin, azelaic acid, one salicylic-acid test, and Vaseline rescue. The goal is calmer barrier, less puffiness, steadier dark-mark protection, and clear feedback on what your skin tolerates without irritation.",
  );
  assertEquals(overview.summary.includes("General description:"), false);
  assertEquals(overview.summary.includes("Product list:"), false);
  assertEquals(overview.summary.includes("Desired outcome:"), false);
  assertEquals(overview.summary.length < 320, true);
  assertStringIncludes(overview.summary, "Vanicream cleanser");
  assertStringIncludes(overview.summary, "Differin");
  assertStringIncludes(overview.summary, "azelaic acid");
  assertStringIncludes(overview.summary, "less puffiness");
  assertStringIncludes(overview.summary, "without irritation");
});

Deno.test("buildSourceBackedOverview gives basic skincare prompts a concise overview", () => {
  const overview = buildSourceBackedOverview("10 day skin care routine");

  assertExists(overview);
  assertEquals(overview.title, "10-Day Skincare Routine");
  assertEquals(
    overview.summary,
    "A structured 10-day skincare flow with a simple morning routine, a day-specific night routine, and a short evening skin check. The goal is steadier cleansing, hydration, SPF, and irritation-aware progress you can actually track.",
  );
});

Deno.test("buildSourceBackedOverview gives basic kung fu prompts a concise overview", () => {
  const overview = buildSourceBackedOverview("practice kung fu");

  assertExists(overview);
  assertEquals(overview.title, "10-Day Kung Fu Practice Flow");
  assertEquals(
    overview.summary,
    "A structured 10-day kung fu flow for stance work, footwork, strikes, kicks, and short evening review. The goal is better balance, cleaner basics, and enough specific feedback to make the next session sharper.",
  );
});

Deno.test("buildSourceBackedOverview gives sparse learning prompts a concise overview", () => {
  const overview = buildSourceBackedOverview("learn electrical engineering");

  assertExists(overview);
  assertEquals(overview.title, "10-Day Electrical Engineering Learning Flow");
  assertStringIncludes(overview.summary, "electrical engineering");
  assertStringIncludes(overview.summary, "one concept chunk per event");
  assertStringIncludes(overview.summary, "without overloading each session");
  assertEquals(overview.summary.length < 260, true);
});

Deno.test("buildVideoLearningOverview keeps math video flows concise", () => {
  const overview = buildVideoLearningOverview(
    "Daily Math Visuals: 90-Day Visual Math Ladder",
    90,
  );

  assertEquals(overview.title, "Daily Math Visuals: 90-Day Visual Math Ladder");
  assertStringIncludes(overview.summary, "90-day visual math learning flow");
  assertStringIncludes(overview.summary, "one linked video each day");
  assertEquals(
    /\b(?:song|tune|chart|riff|chord)\b/i.test(overview.summary),
    false,
  );
});

Deno.test("buildSourceBackedOverview specializes Medu Neter prompts with starter signs", () => {
  const overview = buildSourceBackedOverview("learn medu neter", null, 7);

  assertExists(overview);
  assertEquals(overview.title, "7-Day Medu Neter Learning Flow");
  assertStringIncludes(overview.summary, "ten uniliteral signs");
  assertStringIncludes(overview.summary, "𓇋");
  assertStringIncludes(overview.summary, "reed leaf");
  assertStringIncludes(overview.summary, "𓅓");
  assertStringIncludes(overview.summary, "owl");
  assertStringIncludes(
    overview.summary,
    "without hunting for the lesson material",
  );
  assertEquals(overview.summary.includes("General practice:"), false);
});

Deno.test("buildSourceBackedOverview honors date range and adds Spanish conjugation table", () => {
  const overview = buildSourceBackedOverview(
    "practice spanish conjugations",
    undefined,
    7,
  );

  assertExists(overview);
  assertEquals(overview.title, "7-Day Spanish Conjugation Practice Flow");
  assertStringIncludes(overview.summary, "A structured 7-day");
  assertStringIncludes(overview.summary, "Present-tense anchor");
  assertStringIncludes(overview.summary, "Pronoun | hablar | comer | vivir");
  assertStringIncludes(overview.summary, "yo | hablo | como | vivo");
  assertStringIncludes(
    overview.summary,
    "ellos/ustedes | hablan | comen | viven",
  );
  assertEquals(overview.summary.includes("10-day"), false);
});

Deno.test("buildSourceBackedOverview uses actual range for sparse prompt titles", () => {
  const overview = buildSourceBackedOverview("practice kung fu", null, 7);

  assertExists(overview);
  assertEquals(overview.title, "7-Day Kung Fu Practice Flow");
  assertStringIncludes(overview.summary, "7-day kung fu flow");
  assertEquals(overview.summary.includes("10-day"), false);
});

Deno.test("buildSourceBackedOverview adds practice advice for core fitness prompts", () => {
  const overview = buildSourceBackedOverview(
    "flatten gut and improve ab definition",
    null,
    7,
  );

  assertExists(overview);
  assertEquals(
    overview.title,
    "7-Day Core Definition Training Flow",
  );
  assertEquals(overview.summary.includes("General practice:"), false);
  assertStringIncludes(overview.summary, "hip circles");
  assertStringIncludes(overview.summary, "dead bugs");
  assertStringIncludes(overview.summary, "glute bridges");
  assertStringIncludes(overview.summary, "7-day core-definition flow");
  assertStringIncludes(overview.summary, "spot-fat-loss");
});

Deno.test("buildSourceBackedOverview specializes lower-body circulation and flexibility", () => {
  const overview = buildSourceBackedOverview(
    "lower body blood and flexibility",
    null,
    16,
  );

  assertExists(overview);
  assertEquals(
    overview.title,
    "16-Day Lower Body Circulation and Flexibility Flow",
  );
  assertEquals(
    inferSparsePromptDomain("lower body blood and flexibility"),
    "fitness",
  );
  assertStringIncludes(overview.summary, "hips, hamstrings, calves, ankles");
  assertEquals(overview.summary.includes("General practice:"), false);
  assertStringIncludes(overview.summary, "ankle circles");
  assertStringIncludes(overview.summary, "leg swings");
  assertStringIncludes(overview.summary, "5-7/10");
  assertEquals(overview.summary.includes("clear done criteria"), false);
  assertEquals(
    overview.summary.includes("without requiring extra research"),
    false,
  );
});

Deno.test("buildSourceBackedOverview specializes named electric guitar song prompts", () => {
  const prompt = "learn beyond the 7th sky by lenny kravitz on electric guitar";
  const overview = buildSourceBackedOverview(prompt, null, 16);

  assertExists(overview);
  assertEquals(inferSparsePromptDomain(prompt), "music");
  assertEquals(
    overview.title,
    "16-Day Beyond the 7th Sky Electric Guitar Flow",
  );
  assertStringIncludes(overview.summary, "standard tuning");
  assertStringIncludes(overview.summary, "E-A-D-G-B-E");
  assertStringIncludes(overview.summary, "lowest to highest");
  assertStringIncludes(overview.summary, "key of A");
  assertStringIncludes(overview.summary, "130 BPM");
  assertStringIncludes(overview.summary, "A, Am, and C");
  assertStringIncludes(overview.summary, "intro section (0:00 to about 0:14)");
  assertStringIncludes(overview.summary, "verse groove starting around 0:14");
  assertStringIncludes(overview.summary, "bridge around 1:16");
  assertStringIncludes(
    overview.summary,
    "lead/outro material beginning around 3:00",
  );
  assertEquals(overview.summary.includes("Reference anchors"), false);
  assertEquals(overview.summary.includes("General practice"), false);
  assertEquals(overview.summary.includes("instead of generic"), false);
  assertEquals(overview.summary.includes("working song map"), false);
  assertEquals(overview.summary.includes("0:00 intro"), false);
  assertEquals(overview.summary.includes("core chord colors"), false);
  assertEquals(overview.summary.includes("trusted tab open"), false);
});

Deno.test("concrete action defaults cover broad sparse prompt domains", () => {
  const rule = buildConcreteActionDefaultsRule();

  assertStringIncludes(rule, "exercise");
  assertStringIncludes(rule, "diet");
  assertStringIncludes(rule, "spirituality");
  assertStringIncludes(rule, "character work");
  assertStringIncludes(rule, "hobbies");
  assertStringIncludes(rule, "habits and goals");
  assertStringIncludes(rule, "side projects or work goals");
  assertStringIncludes(rule, "name the actual movements");
  assertStringIncludes(rule, "foods");
  assertStringIncludes(rule, "scripts");
  assertStringIncludes(rule, "artifacts");
  assertStringIncludes(rule, "For music");
  assertStringIncludes(rule, "chords");
  assertStringIncludes(rule, "strumming pattern");
});

Deno.test("event detail density rule keeps events focused without losing specificity", () => {
  const rule = buildEventDetailDensityRule();

  assertStringIncludes(rule, "one primary job");
  assertStringIncludes(rule, "one or two supporting sub-actions");
  assertStringIncludes(rule, "spread it across another note or another day");
  assertStringIncludes(rule, "Do not dumb the work down");
  assertStringIncludes(rule, "one concept or skill chunk per event");
  assertStringIncludes(rule, "Do not combine a mini-lecture");
});

Deno.test("generic placeholder detector rejects notes that require extra research", () => {
  const badDetails = [
    "Begin with 15 minutes of dynamic stretching, then practice basic stances for 20 minutes.",
    "Spend 30 minutes practicing specific Kung Fu techniques, emphasizing precision.",
    "Eat a healthy meal and focus on balanced nutrition.",
    "Spend time on character development exercises and reflect on growth.",
    "Work on your project for 45 minutes and make progress on your goals.",
    "Review the basics and study the key concepts.",
    "Complete a few activities that support your spiritual practice.",
    "Spend time learning specific cultural practices and reflect on the meaning.",
    "Warm up for 10 minutes before core work.",
    "Focus on the intro riff of the song and practice the notes with a metronome.",
    "Learn the chord progression for the verses and work on smooth transitions.",
    "Practice the song structure until it feels familiar.",
    "Work on the strumming pattern that fits the song's vibe.",
    "Create flashcards for the first ten hieroglyphs.",
    "Study the basic symbols and their meanings.",
    "Practice common verbs and write the forms.",
    "Review key terms for Medu Neter.",
    "Study the first five examples and write what they mean.",
    "Learn basic vocabulary before practicing sentences.",
    "Explore important historical figures from the period.",
    "Review the main topics and answer questions.",
    "Practice foundational exercises for 20 minutes.",
    "Use audio resources to aid pronunciation.",
    "Look up online resources and write notes.",
  ];

  for (const detail of badDetails) {
    assertEquals(hasUnderSpecifiedActionPlaceholder(detail), true);
  }

  const goodDetails = [
    "Warm up with ankle circles, knee circles, hip circles, front leg swings, side leg swings, and Cossack squats.",
    "Prepare eggs with spinach and oats, then pack Greek yogurt and berries so breakfast has protein, fiber, and vitamin C.",
    "Use a 10-breath count, write one sentence of gratitude, and copy one sentence you want to live by before checking your phone.",
    "Read one short passage on ancestor veneration, write one question about the ritual context, and choose one respectful term to define before tomorrow.",
    "Open the landing-page draft, rewrite the hero headline, add one pricing FAQ, and send the preview link to one reviewer.",
    "When the urge to interrupt shows up, pause for two breaths and ask one follow-up question before giving your opinion.",
    "Warm up with marching in place, hip circles, cat-cow, dead bugs, and glute bridges before core work.",
    "Loop the 0:00 intro double-stop figure around the 5th-7th fret and keep the quarter-step bend controlled before raising tempo.",
    "Work the verse chord movement A to Am, then tag the C hit before returning to A with clean muting.",
    "Map the song as intro -> verse groove -> bridge -> lead/outro, then record one slow pass naming the next weak section.",
    "Practice muted eighth-note downstrokes with light upstroke ghosts until the rhythm sits behind the beat.",
    "Write standard tuning as E-A-D-G-B-E from lowest string to highest string before checking the riff.",
    "Make a song map with tuning, tempo, key, A to Am to C as the main chord movement, section landmarks, and the first weak spot.",
    "Create flashcards for these ten starter signs: 𓇋 reed leaf = i/y, 𓅱 quail chick = w/u, 𓅓 owl = m, 𓈖 water ripple = n, and 𓂋 mouth = r.",
    "Practice common Spanish verbs: ser, estar, tener, hacer, ir, and venir in the present tense.",
    "Study these electrical engineering concepts: voltage, current, resistance, Ohm's Law, and Kirchhoff's current law.",
    "Practice foundational exercises: dead bugs, bird dogs, glute bridges, side planks, and slow mountain climbers.",
    "Use MIT OpenCourseWare Circuits and Electronics notes or Khan Academy circuit lessons to check one worked example.",
    'Watch the linked video. Think about: Why would map-making need calculus? After watching, say or write one sentence: "What did this video help me see?"',
    'Watch the linked video. Focus: Compare small numbers to huge factorial numbers. Reflection: Why can a simple rule create an enormous result? After watching, say or write one sentence: "What did this video help me see?"',
  ];

  for (const detail of goodDetails) {
    assertEquals(findUnderSpecifiedActionPlaceholder(detail), null);
  }

  const noviceBadDetails = [
    "Tune to standard tuning before you play.",
    "Make a one-page song map before playing.",
  ];
  for (const detail of noviceBadDetails) {
    assertEquals(hasUnderSpecifiedActionPlaceholder(detail), true);
  }
});

Deno.test("buildNoviceClarityRule requires beginner-readable setup", () => {
  const rule = buildNoviceClarityRule();

  assertStringIncludes(rule, "Assume the user is a capable beginner");
  assertStringIncludes(rule, "standard tuning");
  assertStringIncludes(rule, "E-A-D-G-B-E");
  assertStringIncludes(rule, "song map");
  assertStringIncludes(rule, "without separate research");
});

Deno.test("buildSparsePromptExpertDefaults expands basic prompts by domain", () => {
  const skincare = buildSparsePromptExpertDefaults({
    description: "10 day skin care routine",
    dateRangeDays: 10,
    flowFormat: "REGIMEN",
  });
  assertEquals(inferSparsePromptDomain("10 day skin care routine"), "skincare");
  assertStringIncludes(skincare, "SPARSE_PROMPT_EXPERT_DEFAULTS");
  assertStringIncludes(skincare, "morning routine");
  assertStringIncludes(skincare, "night routine");
  assertStringIncludes(skincare, "evening skin check");
  assertStringIncludes(skincare, "Never use numbered lists");
  assertStringIncludes(skincare, "CONCRETE_ACTION_DEFAULTS_RULE");

  const study = buildSparsePromptExpertDefaults({
    description: "weekly calculus study derivatives",
    dateRangeDays: 7,
    flowFormat: "REGIMEN",
  });
  assertEquals(
    inferSparsePromptDomain("weekly calculus study derivatives"),
    "study",
  );
  assertStringIncludes(study, "active");
  assertStringIncludes(study, "worked examples");
  assertStringIncludes(study, "evening reflection");

  const martialArts = buildSparsePromptExpertDefaults({
    description: "practice kung fu",
    dateRangeDays: 10,
    flowFormat: "REGIMEN",
  });
  assertEquals(inferFlowFormat("kung fu"), "REGIMEN");
  assertEquals(inferSparsePromptDomain("practice kung fu"), "martial_arts");
  assertStringIncludes(martialArts, "horse stance");
  assertStringIncludes(martialArts, "bow stance");
  assertStringIncludes(martialArts, "straight punch");
  assertStringIncludes(martialArts, "ankle circles");
  assertStringIncludes(martialArts, "never use category placeholders");

  const fitness = buildSparsePromptExpertDefaults({
    description: "flatten gut and improve ab definition",
    dateRangeDays: 7,
    flowFormat: "REGIMEN",
  });
  assertEquals(
    inferSparsePromptDomain("flatten gut and improve ab definition"),
    "fitness",
  );
  assertStringIncludes(fitness, "Never leave warm-up generic");
  assertStringIncludes(fitness, "dead bugs");
  assertStringIncludes(fitness, "Avoid promising spot fat loss");

  const musicPrompt =
    "learn to play beyond the 7th sky by leny kravitz on electric guidar";
  const music = buildSparsePromptExpertDefaults({
    description: musicPrompt,
    dateRangeDays: 16,
    flowFormat: "REGIMEN",
  });
  assertEquals(inferSparsePromptDomain(musicPrompt), "music");
  assertStringIncludes(music, "For named-song music practice");
  assertStringIncludes(music, "standard tuning");
  assertStringIncludes(music, "E-A-D-G-B-E");
  assertStringIncludes(music, "capable beginner");
  assertStringIncludes(music, "A, Am, and C");
  assertStringIncludes(music, "intro section from 0:00 to about 0:14");
  assertStringIncludes(music, "Event details must name the musical target");
});

Deno.test("buildSparsePromptRoutineNotes creates full skincare day phases", () => {
  const notes = buildSparsePromptRoutineNotes({
    description: "10 day skin care routine",
    dateRangeDays: 10,
    flowFormat: "REGIMEN",
  });

  assertExists(notes);
  assertEquals(notes.length, 30);
  for (let dayIndex = 0; dayIndex < 10; dayIndex++) {
    const dayNotes = notes.filter((note) => note.day_index === dayIndex);
    assertEquals(dayNotes.length, 3);
    assertStringIncludes(dayNotes[0].title, "Morning skincare routine");
    assertStringIncludes(dayNotes[1].title, "Night routine");
    assertStringIncludes(dayNotes[2].title, "Evening skin check");
    for (const note of dayNotes) {
      assertEquals(hasUnsafeVisibleRepeatReference(note.details), false);
      assertEquals(/^\s*(?:[-*•]|\d+[.)])\s+/m.test(note.details), false);
      assertEquals(
        /\bBegin your skincare journey\b/i.test(note.details),
        false,
      );
    }
  }

  const daySixNight = notes.find((note) =>
    note.day_index === 5 && /Night routine/.test(note.title)
  );
  assertStringIncludes(daySixNight?.details ?? "", "Cleanse");
  assertStringIncludes(daySixNight?.details ?? "", "active");
  assertStringIncludes(daySixNight?.details ?? "", "moisturizer");
});

Deno.test("buildSparsePromptRoutineNotes creates specific kung fu practice notes", () => {
  const notes = buildSparsePromptRoutineNotes({
    description: "practice kung fu",
    dateRangeDays: 10,
    flowFormat: "REGIMEN",
  });

  assertExists(notes);
  assertEquals(notes.length, 30);
  const allText = notes.map((note) => `${note.title}\n${note.details}`).join(
    "\n\n",
  );
  assertEquals(
    /\b(?:dynamic stretching|basic stances|specific kung fu techniques|specific martial arts techniques|specific techniques)\b/i
      .test(allText),
    false,
  );
  assertStringIncludes(allText, "horse stance");
  assertStringIncludes(allText, "bow stance");
  assertStringIncludes(allText, "empty stance");
  assertStringIncludes(allText, "drop stance");
  assertStringIncludes(allText, "straight punch");
  assertStringIncludes(allText, "front kick");
  assertStringIncludes(allText, "snap kick");
  assertStringIncludes(allText, "crescent kicks");

  for (let dayIndex = 0; dayIndex < 10; dayIndex++) {
    const dayNotes = notes.filter((note) => note.day_index === dayIndex);
    assertEquals(dayNotes.length, 3);
    assertEquals(dayNotes[0].title, "Morning Warm-Up");
    assertEquals(dayNotes[1].title, "Focused Drills");
    assertEquals(dayNotes[2].title, "Evening Reflection");
    for (const note of dayNotes) {
      assertEquals(hasUnsafeVisibleRepeatReference(note.details), false);
      assertEquals(/^\s*(?:[-*•]|\d+[.)])\s+/m.test(note.details), false);
      assertEquals(/\bBegin your\b/i.test(note.details), false);
      assertEquals(/\bpractice specific\b/i.test(note.details), false);
    }
  }
});

Deno.test("buildSparsePromptRoutineNotes creates a concrete Medu Neter beginner flow", () => {
  const notes = buildSparsePromptRoutineNotes({
    description: "learn medu neter",
    dateRangeDays: 7,
    flowFormat: "REGIMEN",
  });

  assertExists(notes);
  assertEquals(notes.length, 14);
  assertEquals(inferSparsePromptDomain("learn medu neter"), "medu_neter");

  const allText = notes.map((note) => `${note.title}\n${note.details}`).join(
    "\n\n",
  );
  assertStringIncludes(allText, "𓇋 reed leaf = i/y");
  assertStringIncludes(allText, "𓅱 quail chick = w/u");
  assertStringIncludes(allText, "𓅓 owl = m");
  assertStringIncludes(allText, "𓈖 water ripple = n");
  assertStringIncludes(allText, "𓂋 mouth = r");
  assertStringIncludes(allText, "reading toward the faces");
  assertStringIncludes(allText, "phonogram");
  assertStringIncludes(allText, "determinative");
  assertEquals(/\bfirst ten hieroglyphs\b/i.test(allText), false);
  assertEquals(/\bbasic symbols\b/i.test(allText), false);
  assertEquals(/\bancient Egyptian culture\b/i.test(allText), false);

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const dayNotes = notes.filter((note) => note.day_index === dayIndex);
    assertEquals(dayNotes.length, 2);
    assertEquals(dayNotes[1].title, "Medu Neter review");
    for (const note of dayNotes) {
      assertEquals(hasUnsafeVisibleRepeatReference(note.details), false);
      assertEquals(hasUnderSpecifiedActionPlaceholder(note.details), false);
      assertEquals(/^\s*(?:[-*•]|\d+[.)])\s+/m.test(note.details), false);
    }
  }
});

Deno.test("buildSparsePromptRoutineNotes creates a playable Beyond the 7th Sky plan", () => {
  const notes = buildSparsePromptRoutineNotes({
    description: "learn beyond the 7th sky by lenny kravitz on electric guitar",
    dateRangeDays: 16,
    flowFormat: "REGIMEN",
  });

  assertExists(notes);
  assertEquals(notes.length, 32);

  const allText = notes.map((note) => `${note.title}\n${note.details}`).join(
    "\n\n",
  );
  assertStringIncludes(allText, "standard");
  assertStringIncludes(allText, "E-A-D-G-B-E");
  assertStringIncludes(allText, "lowest string to highest string");
  assertStringIncludes(allText, "130 BPM");
  assertStringIncludes(allText, "A, Am, and C");
  assertStringIncludes(allText, "simple song map");
  assertStringIncludes(
    allText,
    "setup at the top and the song sections underneath",
  );
  assertStringIncludes(allText, "section landmarks");
  assertStringIncludes(allText, "intro section from 0:00 to about 0:14");
  assertStringIncludes(allText, "first 2-4 bars of the intro section");
  assertStringIncludes(allText, "verse groove starting around 0:14");
  assertStringIncludes(allText, "bridge around 1:16");
  assertStringIncludes(allText, "lead/outro material beginning around 3:00");
  assertStringIncludes(allText, "trusted tab open");
  assertStringIncludes(allText, "60-70% speed");
  assertStringIncludes(allText, "Record one pass");

  assertEquals(
    /\b(?:Reference anchors|General practice|instead of generic|working song map)\b/i
      .test(allText),
    false,
  );
  assertEquals(/\b0:00 intro\b/i.test(allText), false);
  assertEquals(/\b0:14 verse groove\b/i.test(allText), false);
  assertEquals(/\bcore chord colors\b/i.test(allText), false);
  assertEquals(
    /\b(?:learn the intro riff|verse chords|chord progression for the verses|song structure|strumming pattern that fits)\b/i
      .test(allText),
    false,
  );

  for (let dayIndex = 0; dayIndex < 16; dayIndex++) {
    const dayNotes = notes.filter((note) => note.day_index === dayIndex);
    assertEquals(dayNotes.length, 2);
    assertEquals(dayNotes[1].title, "Listening review");
    for (const note of dayNotes) {
      assertEquals(findUnderSpecifiedActionPlaceholder(note.details), null);
      assertEquals(/^\s*(?:[-*•]|\d+[.)])\s+/m.test(note.details), false);
    }
  }
});

Deno.test("buildSparsePromptRoutineNotes creates concrete piano practice notes", () => {
  const notes = buildSparsePromptRoutineNotes({
    description: "practice piano",
    dateRangeDays: 10,
    flowFormat: "REGIMEN",
  });

  assertExists(notes);
  assertEquals(notes.length, 20);
  assertEquals(inferSparsePromptDomain("practice piano"), "music");

  const allText = notes.map((note) => `${note.title}\n${note.details}`).join(
    "\n\n",
  );
  assertStringIncludes(allText, "five-finger pattern");
  assertStringIncludes(allText, "C major scale");
  assertStringIncludes(allText, "Hanon-style");
  assertStringIncludes(allText, "left-hand");
  assertStringIncludes(allText, "right-hand");
  assertStringIncludes(allText, "C-F-G");
  assertStringIncludes(allText, "metronome");
  assertStringIncludes(allText, "Trouble spot loop");
  assertStringIncludes(allText, "Clean run-through");
  assertEquals(/\bwarm\s*up\b/i.test(allText), false);

  for (let dayIndex = 0; dayIndex < 10; dayIndex++) {
    const dayNotes = notes.filter((note) => note.day_index === dayIndex);
    assertEquals(dayNotes.length, 2);
    assertEquals(dayNotes[1].title, "Practice review");
    for (const note of dayNotes) {
      assertEquals(findUnderSpecifiedActionPlaceholder(note.details), null);
      assertEquals(hasUnsafeVisibleRepeatReference(note.details), false);
      assertEquals(/^\s*(?:[-*•]|\d+[.)])\s+/m.test(note.details), false);
    }
  }
});

Deno.test("buildSparsePromptRoutineNotes covers generic music sparse prompts", () => {
  for (const description of ["practice scales", "learn a song"]) {
    const notes = buildSparsePromptRoutineNotes({
      description,
      dateRangeDays: 7,
      flowFormat: "REGIMEN",
    });

    assertExists(notes);
    assertEquals(notes.length, 14);
    const allText = notes.map((note) => note.details).join("\n\n");
    assertStringIncludes(allText, "C major scale");
    assertStringIncludes(allText, "C-F-G");
    assertEquals(/\bwarm\s*up\b/i.test(allText), false);
    for (const note of notes) {
      assertEquals(findUnderSpecifiedActionPlaceholder(note.details), null);
    }
  }
});

Deno.test("buildSparsePromptRoutineNotes keeps guitar practice guitar-specific", () => {
  const notes = buildSparsePromptRoutineNotes({
    description: "practice guitar",
    dateRangeDays: 7,
    flowFormat: "REGIMEN",
  });

  assertExists(notes);
  assertEquals(notes.length, 14);
  const allText = notes.map((note) => `${note.title}\n${note.details}`).join(
    "\n\n",
  );
  assertStringIncludes(allText, "G-C-D");
  assertStringIncludes(allText, "frets 1-2-3-4");
  assertStringIncludes(allText, "down-up");
  assertStringIncludes(allText, "Am-C-G-D");
  assertEquals(/\bC major scale\b/i.test(allText), false);
  assertEquals(/\bHanon\b/i.test(allText), false);
  assertEquals(/\bleft-hand\b/i.test(allText), false);
  assertEquals(/\bright-hand\b/i.test(allText), false);
  assertEquals(/\bwarm\s*up\b/i.test(allText), false);
  for (const note of notes) {
    assertEquals(findUnderSpecifiedActionPlaceholder(note.details), null);
    assertEquals(hasUnsafeVisibleRepeatReference(note.details), false);
  }
});

Deno.test("mergePreservedDetails keeps generated framing and source detail blocks", () => {
  const merged = mergePreservedDetails(
    `
Begin by sketching the layout and checking where exhaust can exit. Keep the first pass simple so you can verify airflow before sealing everything.

End by noting one leak path or heat risk you need to fix tomorrow.
`,
    `
Goal: Choose and measure your setup area

Materials
- Measuring tape
- Power strip location

What to do
- Measure width, height, depth
- Identify where air can exit

[Wikipedia](https://en.wikipedia.org/wiki/Grow_box)
`,
  );

  assertStringIncludes(
    merged,
    "Begin by sketching the layout and checking where exhaust can exit.",
  );
  assertStringIncludes(merged, "Goal: Choose and measure your setup area");
  assertStringIncludes(merged, "What to do");
  assertStringIncludes(
    merged,
    "[Wikipedia](https://en.wikipedia.org/wiki/Grow_box)",
  );
});

Deno.test("wantsYoutubeLinks detects explicit youtube link requests", () => {
  assertEquals(
    wantsYoutubeLinks("make me a 7 day yoga flow with youtube links"),
    true,
  );
  assertEquals(
    wantsYoutubeLinks("turn this into a study flow", "youtube video please"),
    false,
  );
});

Deno.test("youtube channel flow prompt is recognized as a link-backed video flow", () => {
  const prompt =
    "Visit this YouTube channel https://youtube.com/@dailymathvisuals?si=4wYGuTa1NvhVHcZM and arrange the shorts videos from beginner level math to advanced topics. Create a flow with one video per day for 90 days. Include links so they can tap and watch. 12 noon every day is when they watch.";

  assertEquals(
    extractYoutubeChannelUrl(prompt),
    "https://www.youtube.com/@dailymathvisuals",
  );
  assertEquals(wantsYoutubeChannelVideoFlow(prompt), true);
  assertEquals(wantsYoutubeLinks(prompt), true);
});

Deno.test("buildYoutubeChannelFlowNotes sorts channel shorts from beginner to advanced", () => {
  const notes = buildYoutubeChannelFlowNotes({
    dateRangeDays: 5,
    requestedTimeWindow: {
      startTime: "12:00",
      endTime: "13:00",
      source: "single",
    },
    videos: [
      {
        title: "The Kernel Trick Explained Visually",
        url: "https://www.youtube.com/shorts/Fo1aw1glI0k",
      },
      {
        title: "Area of Square",
        url: "https://www.youtube.com/shorts/Y9EynW7GVn8",
      },
      {
        title: "Why ∫ sin(x)/x = π/2",
        url: "https://www.youtube.com/shorts/TnP0qLUqc3w",
      },
      {
        title: "How to Simplify Fractions Using GCD",
        url: "https://www.youtube.com/shorts/YBlWcfyCo6U",
      },
      {
        title: "Perceptron Explained Visually",
        url: "https://www.youtube.com/shorts/DXOyzpTK4qQ",
      },
    ],
  });

  assertExists(notes);
  assertEquals(notes.map((note) => note.title), [
    "Area of Square",
    "How to Simplify Fractions Using GCD",
    "Why ∫ sin(x)/x = π/2",
    "The Kernel Trick Explained Visually",
    "Perceptron Explained Visually",
  ]);
  assertEquals(notes.every((note) => note.start_time === "12:00"), true);
  assertEquals(notes.every((note) => note.end_time === "13:00"), true);
  assertEquals(
    notes[0].location,
    "https://www.youtube.com/watch?v=Y9EynW7GVn8",
  );
  assertStringIncludes(notes[0].details, "What did this video help me see?");
});

Deno.test("structured video flow preserves focus and reflection labels without false generic failures", () => {
  const prompt = `
Create a 4-day learning flow called “Daily Math Visuals: 4-Day Deep Visual Math Path.”

Schedule:
- One lesson per day for 4 days.
- Time: 12:00 PM every day.
- Each day includes a longer Daily Math Visuals video link.
- After each lesson, ask the kids to answer one short reflection:
  “What did this video help me see?”

Day 1 — What Is a Factorial?
Watch: https://www.youtube.com/watch?v=FNseOd4J7T0
Focus: Understand factorial as repeated multiplication.
Reflection: What does “5!” mean, and why does it grow so quickly?

Day 2 — Factorials as Arrangements
Watch: https://www.youtube.com/watch?v=FNseOd4J7T0
Focus: Watch again for the idea of arranging objects.
Reflection: Why does changing order create so many possibilities?

Day 3 — Factorials and Real Life
Watch: https://www.youtube.com/watch?v=FNseOd4J7T0
Focus: Connect factorials to cards, passwords, schedules, and choices.
Reflection: Where could factorial growth show up in real life?

Day 4 — Explosive Growth
Watch: https://www.youtube.com/watch?v=FNseOd4J7T0
Focus: Compare small numbers to huge factorial numbers.
Reflection: Why can a simple rule create an enormous result?
`;

  const notes = buildStructuredSourceFlowNotes({
    description: prompt,
    dateRangeDays: 4,
    sourceHandling: inferSourceHandling(prompt),
    requestedTimeWindow: inferRequestedTimeWindow(prompt),
  });

  assertExists(notes);
  assertEquals(notes.length, 4);
  assertEquals(notes.every((note) => note.start_time === "12:00"), true);
  assertEquals(
    notes.every((note) =>
      note.location === "https://www.youtube.com/watch?v=FNseOd4J7T0"
    ),
    true,
  );
  assertStringIncludes(
    notes[3].details,
    "Focus: Compare small numbers to huge factorial numbers.",
  );
  assertStringIncludes(
    notes[3].details,
    "Reflection: Why can a simple rule create an enormous result?",
  );
  assertStringIncludes(notes[3].details, "What did this video help me see?");
  assertEquals(findUnderSpecifiedActionPlaceholder(notes[3].details), null);
});

Deno.test("countYoutubeUrls counts both youtube.com and youtu.be links", () => {
  const count = countYoutubeUrls(
    `
https://www.youtube.com/watch?v=FSwmDWL68gw
https://youtu.be/40bPxbFUCj4
https://example.com/not-youtube
`,
  );

  assertEquals(count, 2);
});

Deno.test("normalizeYoutubeVideoUrl canonicalizes valid video URLs", () => {
  assertEquals(
    normalizeYoutubeVideoUrl("https://youtu.be/FSwmDWL68gw?t=12"),
    "https://www.youtube.com/watch?v=FSwmDWL68gw",
  );
  assertEquals(
    normalizeYoutubeVideoUrl("www.youtube.com/shorts/40bPxbFUCj4"),
    "https://www.youtube.com/watch?v=40bPxbFUCj4",
  );
});

Deno.test("normalizeYoutubeVideoUrl rejects placeholder or non-video youtube links", () => {
  assertEquals(
    normalizeYoutubeVideoUrl("https://www.youtube.com/watch?v=example1"),
    null,
  );
  assertEquals(
    normalizeYoutubeVideoUrl("https://www.youtube.com/channel/abc123"),
    null,
  );
  assertEquals(
    looksLikeYoutubeUrl("https://www.youtube.com/watch?v=example1"),
    true,
  );
});

Deno.test("extractFirstUrl strips trailing punctuation and structured plans are detected", () => {
  assertEquals(
    extractFirstUrl("Join here: https://meet.google.com/abc-defg-hij)."),
    "https://meet.google.com/abc-defg-hij",
  );
  assertEquals(
    looksStructuredDayPlan(
      "Day 1: Practice\nhttps://youtu.be/x\nDay 2: Recover\nhttps://youtu.be/y",
    ),
    true,
  );
});

Deno.test("looksLikeLongSourceDocument detects long note dumps and passages", () => {
  const source = `
Chapter idea

The first section explains why the current workflow breaks down whenever the handoff is ambiguous. It lists the bottlenecks, the emotional resistance, and the exact moments where momentum disappears if the next action is not visible.

The second section turns that into operating rules. Keep one active deliverable, define what done looks like, and decide what proof or artifact should exist by the end of each work block so progress can be measured honestly.

The final section repeats the same pattern across examples, notes where the sequence should tighten, and points out that reflection only matters if it changes the next move instead of staying abstract.
`;

  assertEquals(looksLikeLongSourceDocument(source), true);
});

Deno.test("looksLikeMealPlanFlow detects nutrition meal-plan prompts", () => {
  const description = "Turn this into a 10 day flow";
  const source = `
Meal 1
- Eggs
- Blueberries
- Avocado

Meal 2
- Salmon
- Rice
- Broccoli

Meal 3
- Greek yogurt
- Walnuts
- Citrus
`;

  assertEquals(looksLikeMealPlanFlow(description, source), true);
});

Deno.test("looksLikeMealPlanFlow ignores diet support inside a skin routine", () => {
  const prompt = `
Turn this into a 10 day flow:

Product stack I would actually use
- Vanicream Gentle Facial Cleanser
- Vanicream Daily Facial Moisturizer
- Colorescience Face Shield Flex SPF 50
- Differin Gel Adapalene 0.1%
- The Ordinary Azelaic Acid 10%
- CeraVe Eye Repair Cream
- Colorescience if the shade matches and budget allows; CeraVe if you want the cheaper option.

10-day decan routine
Every morning — Days 1–10
Cleanse, cold under-eye reset, caffeine eye cream, moisturizer, sunscreen, and posture reset.

Day 1 — Barrier baseline
Cleanse with Vanicream. Apply moisturizer. Use Vaseline on lips and dry patches.

Day 2 — Adapalene night
Cleanse, wait until face is fully dry, apply Differin, then moisturize.

Diet rules for the 10-day decan
Protein: 30–40g per meal.
Good options: eggs, salmon, sardines, chicken, lean beef, Greek yogurt, lentils, tofu.
Vitamin C food daily: kiwi, orange, strawberries, bell pepper, broccoli, kale.
Low-glycemic carbs: oats, sweet potatoes, beans, rice paired with protein/fiber.
Breakfast, lunch, and dinner may be mentioned as support context, but they are not the requested flow.
`;

  assertEquals(looksLikeMealPlanFlow(prompt), false);
  assertEquals(inferFlowFormat(prompt), "REGIMEN");
});

Deno.test("looksLikeMealPlanFlow keeps explicit meal-plan intent", () => {
  const prompt = `
Turn this into a 10 day meal plan:

Protein: 30–40g per meal.
Good options: eggs, salmon, sardines, chicken, lean beef, Greek yogurt, lentils, tofu.
Vitamin C food daily: kiwi, orange, strawberries, bell pepper, broccoli, kale.
Low-glycemic carbs: oats, sweet potatoes, beans, and rice paired with protein.
`;

  assertEquals(looksLikeMealPlanFlow(prompt), true);
  assertEquals(inferFlowFormat(prompt), "MEAL_PLAN");
  assertEquals(looksLikeMealPlanFlow("diet plan"), true);
  assertEquals(inferFlowFormat("diet plan"), "MEAL_PLAN");
  assertEquals(inferSparsePromptDomain("diet plan"), "meal");
});

Deno.test("wantsThreeMealDailyFlow detects breakfast lunch dinner structure", () => {
  const source = `
Simple daily structure

Meal 1
- Eggs + fruit + healthy fat

Meal 2
- Protein + vegetables + carbs

Meal 3
- Protein + vegetables + fats
`;

  assertEquals(
    wantsThreeMealDailyFlow("build a clean nutrition flow", source),
    true,
  );
  assertEquals(
    wantsThreeMealDailyFlow(
      "plan 10 dinners",
      "dinners only with shopping list",
    ),
    false,
  );
});

Deno.test("inferFlowFormat detects project, finance, regimen, and synthesis flows", () => {
  assertEquals(
    inferFlowFormat(
      "Turn this into a 10 day flow for my home electrical project",
      "Materials: wire strippers, tester, outlet boxes. What to do: inspect circuit, replace outlet, test voltage.",
    ),
    "PROJECT_PLAN",
  );
  assertEquals(inferFlowFormat("build my side project"), "PROJECT_PLAN");
  assertEquals(inferSparsePromptDomain("build my side project"), "project");
  assertEquals(
    inferFlowFormat(
      "Help me turn this into a flow for applying for a loan",
      "Gather pay stubs, bank statements, compare APR, call lender, submit application.",
    ),
    "FINANCE_PLAN",
  );
  assertEquals(
    inferFlowFormat(
      "make me a 14 day shoulder rehab routine",
      "Daily mobility, cuff work, and progressive loading.",
    ),
    "REGIMEN",
  );
  assertEquals(
    inferFlowFormat(
      "Build a 7 day flow to learn Spanish conversation",
      "",
    ),
    "REGIMEN",
  );
  assertEquals(inferFlowFormat("build discipline at work"), "REGIMEN");
  assertEquals(
    inferFlowFormat(
      "Turn this long journal dump into a flow",
      "Journal entry one about burnout and scattered priorities.\n\nJournal entry two about what keeps repeating and what needs to change.\n\nJournal entry three about the kind of structure I want next month.",
    ),
    "SYNTHESIS",
  );
});

Deno.test("inferFlowFormat treats conversational or note dumps as synthesis when asked to transform them", () => {
  assertEquals(
    inferFlowFormat(
      "Turn this conversation into a 7 day flow",
      `
User: I keep overcommitting and then freezing when I need to pick one thing.
Assistant: The repeated pattern is unclear prioritization, vague deliverables, and too many parallel tracks.

User: I want a structure that makes the next action obvious and helps me stop restarting.
Assistant: Then the flow should compress the themes into checkpoints, visible outputs, and review moments.
`,
    ),
    "SYNTHESIS",
  );
});

Deno.test("inferSourceHandling preserves literal day plans", () => {
  const mode = inferSourceHandling(
    "turn this into a 10 day flow",
    `
Day 1: Reset
https://youtu.be/a

Day 2: Build
https://youtu.be/b

Day 3: Recover
https://youtu.be/c
`,
  );

  assertEquals(mode, "PRESERVE_STRUCTURE");
});

Deno.test("inferSourceHandling synthesizes long source material into a flow", () => {
  const mode = inferSourceHandling(
    "organize this into a 30 day flow",
    `
This is a long strategy memo about rebuilding a creative practice from scattered research notes, coaching excerpts, and journal entries. The material includes recurring themes, bottlenecks, experiments, and decisions about pacing.

There are notes about where confidence drops, what constraints matter, which exercises should come first, and how to turn abstract insight into measurable daily work without flattening everything into generic habits.

The final part talks about staging the work across several weeks so the user builds understanding first, then execution reps, then higher-pressure integration with reflection at the right moments.
`,
  );

  assertEquals(mode, "SYNTHESIZE_FROM_SOURCE");
});

Deno.test("inferSourceHandling synthesizes conversation-style dumps", () => {
  const mode = inferSourceHandling(
    "turn this into a 10 day flow",
    `
User: I want to stop letting my finances drift.
Assistant: Then gather your statements, map recurring expenses, and compare where cash is leaking first.

User: I also need a plan for applying for a small business loan.
Assistant: Break it into document gathering, lender comparison, application prep, and submission.
`,
  );

  assertEquals(mode, "SYNTHESIZE_FROM_SOURCE");
});

Deno.test("looksLikeDetailedPreserveSource detects detail-heavy meal plan blocks", () => {
  const source = `
### Day 1
**Breakfast: Greek Yogurt Seed Power Bowl**
**Ingredients:** 1 cup Greek yogurt, 1 tbsp chia seeds, 1 tsp honey.
**Instructions:** 1. Spoon yogurt into a bowl. 2. Stir in chia and honey. 3. Eat immediately.
**How this meal helps your goals:** Protein, probiotics, and fiber support colon health, skin, and satiety.

### Day 2
**Lunch: Kale Quinoa Bowl**
**Ingredients:** 2 cups kale, 1/2 cup quinoa, 2 eggs.
**Instructions:** 1. Cook eggs. 2. Massage kale. 3. Toss with quinoa and eggs.
**How this meal helps your goals:** Fiber, minerals, and protein support iron status, muscle, and lymph flow.
`;

  assertEquals(looksLikeDetailedPreserveSource(source), true);
});

Deno.test("inferSourceHandling preserves details when user says not to change them", () => {
  const mode = inferSourceHandling(
    "turn this into a 10 day flow and don't change details or simplify anything",
    `
Intro paragraph about the plan.

### Day 1
**Breakfast:** detailed meal here
**Ingredients:** yogurt, chia, honey
**Instructions:** 1. Mix. 2. Eat.

### Day 2
**Lunch:** another detailed meal
**Ingredients:** kale, quinoa, eggs
**Instructions:** 1. Prep. 2. Combine.
`,
  );

  assertEquals(mode, "PRESERVE_STRUCTURE");
});

Deno.test("inferMode keeps planner prompts in elaboration mode", () => {
  assertEquals(
    inferMode(
      "Build me a 7-day learning plan to relearn calculus through spaced retrieval and short problem sets. Keep weekday sessions around 20 minutes, make the done criteria explicit, include minimum versions, and tell me what to track.",
    ),
    "ELABORATION",
  );

  assertEquals(
    inferMode(
      "Create a 6-day plan to clean up my budgeting system, automate my recurring bills, and review spending without overload. Use conservative defaults, clear decision rules, and concrete metrics.",
    ),
    "ELABORATION",
  );

  assertEquals(
    inferMode(
      "Turn my pasted project source into a 10-day execution plan with milestones, minimum versions, fallback rules, and review points.",
      [
        "Goal: ship a small course-launch page and payment flow in ten days.",
        "Constraints: I work full time, can give 30 minutes on weekdays and 90 minutes on Saturday.",
        "Tasks: finalize offer, outline page sections, gather testimonials, write copy, set Stripe product, test checkout, publish, review funnel data.",
        "Weaknesses: I tend to over-plan, avoid publishing, and leave testing until the end.",
        "Need: concrete actions with clear finish lines, fallback versions, and a weekly review checkpoint.",
      ].join("\n"),
    ),
    "ELABORATION",
  );
});

Deno.test("inferMode keeps raw item scheduling prompts in dictation mode", () => {
  assertEquals(
    inferMode("Groceries, dentist, pick up prescription, pay rent"),
    "DICTATION",
  );
  assertEquals(
    inferMode("Schedule these at 7:30am, 12pm, and 6pm"),
    "DICTATION",
  );
});

Deno.test("sanitizeFlowLocation keeps useful links and drops generic setup cues", () => {
  assertEquals(
    sanitizeFlowLocation(
      "Tutorial video: https://www.youtube.com/watch?v=FSwmDWL68gw.",
    ),
    "https://www.youtube.com/watch?v=FSwmDWL68gw",
  );
  assertEquals(sanitizeFlowLocation("study materials open"), null);
  assertEquals(
    sanitizeFlowLocation("project workspace and current deliverable visible"),
    null,
  );
  assertEquals(
    sanitizeFlowLocation("Downtown courthouse"),
    "Downtown courthouse",
  );
});
