export const MAAT_REFLECTION_EXAMPLE_STORE_VERSION =
  "maat_reflection_examples_calendar_arc_v1";

export type MaatReflectionClosingMove = "question" | "charge";

export type MaatReflectionExample = {
  id: string;
  decan: string;
  month: string;
  season: string;
  caseKey: string;
  offering: string;
  userPattern: string;
  evidenceShape: string;
  calendarArcMove: string;
  alignmentMove: string;
  gapMove: string;
  lessonMove: string;
  closingMove: MaatReflectionClosingMove;
  text: string;
  sourceFile: string;
};

const SOURCE_FILE = "maat_reflection_examples_calendar_arc.md";

export const MAAT_REFLECTION_EXAMPLES: MaatReflectionExample[] = [
  {
    id: "reflection-calendar-arc-001",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "provision.repeated_open_checks",
    offering: "RESCHEDULE",
    userPattern: "new user, recurring body care, act-and-account gap",
    evidenceShape: "one recurring body-care promise through the period",
    calendarArcMove:
      "Hathor's first decan sꜣḥ asked for return, stable ground, and the body re-centered in daily care",
    alignmentMove: "the intention was present and real",
    gapMove: "the act and its witness have not yet met in one confirmed mark",
    lessonMove: "measure asks care to take a form the day can actually hold",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ asked for return - stable ground recovered, the body re-centered in daily care. The body-care promise appeared through the period, which means the intention was present and real. The strain is measure: the act and its witness have not yet met in one confirmed mark, so the care remains harder to carry than it needs to be. Ma'at is not asking for more support here, but for the support to take a form the day can actually hold. What existing moment could let this care and its witness meet in one small measure?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-002",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "visible_work.no_finish_condition",
    offering: "FINISH_CONDITION",
    userPattern: "creative professional, active but unclosed work",
    evidenceShape: "multiple work threads active without defined close",
    calendarArcMove:
      "Hathor called for restored order, beauty visible, and the house made inhabitable",
    alignmentMove: "attention and effort were real",
    gapMove: "the work did not land in a defined finishing point",
    lessonMove: "stable return asks for work that knows when it is done",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ called for restored order - beauty brought back into the visible, the house made inhabitable again. The creative work was active: attention given, effort real, multiple threads running. What didn't land was the close - several pieces remained in motion without a defined finishing point, and the period's output is harder to read than the work behind it justifies. The decan of stable return asks not for more effort but for work that knows when it is done. What would 'finished for this period' mean for the one piece that matters most?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-003",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "truthful_record.titles_only",
    offering: "WRITE_ONE_DETAIL",
    userPattern: "spiritual practitioner, practices running, surface journal",
    evidenceShape: "practice entries without concrete detail",
    calendarArcMove:
      "the decan called for embodied return, not abstract intention",
    alignmentMove: "the practices ran",
    gapMove: "the account stayed at the level of titles",
    lessonMove: "the record should reflect the ground actually covered",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ called for embodied return - not abstract intention but physical, present, recorded care. The practices ran; the journal stayed at the level of titles. There is a gap between the practice being real and the account knowing it was real, and that gap is where insight accumulates or goes dark across the months. Hathor's season asks for a record that reflects the ground actually covered - not just that something happened, but what it was. Which one practice from this decan deserves one honest sentence about what actually occurred in it?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-004",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "rhythm.anchor_missing",
    offering: "HABIT_STACK",
    userPattern: "scattered engagement, no consistent entry point",
    evidenceShape: "real engagement without reliable anchor",
    calendarArcMove:
      "the decan asked for return to stable ground and predictable moments",
    alignmentMove: "the engagement was real",
    gapMove: "the practice had no consistent entry point",
    lessonMove:
      "stability means one thing returning reliably, not many things returning occasionally",
    closingMove: "charge",
    text:
      "This decan asked for return to stable ground - the sense that certain things happen at predictable moments regardless of how the rest of the day runs. The engagement was real but scattered: no consistent entry point, no moment the practice attached to reliably. That scattering is not absence; it's a routine running entirely on memory and motivation, without a structural hold. Stability in Hathor's period means one thing returning reliably, not many things returning occasionally. What moment already happens at roughly the same time each day? The practice needs that moment as a home.",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-005",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "provision.overloaded_schedule",
    offering: "REDUCE_AND_COMPLETE_ONE",
    userPattern: "long-time user, care list larger than the period",
    evidenceShape: "body-care list spread across too many marks",
    calendarArcMove:
      "Hathor asks for restoration, not accumulation of what came before",
    alignmentMove: "care was present",
    gapMove: "care spread across too many marks to land fully",
    lessonMove: "stable return asks for care concentrated enough to close",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ asks for restoration - not accumulation of what came before, but return to what actually nourishes. The body care list this decan was larger than the period could hold, which meant care was present but spread across too many marks to land anywhere with full weight. A long list left open doesn't represent more care; it represents care that couldn't find a completing moment. The decan of stable return asks for a smaller, cleaner shape - not less care, but care concentrated enough to close. What one support, kept consistently next decan, would make the rest easier to return to?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-006",
    decan: "Khoiak",
    month: "Khoiak",
    season: "Akhet",
    caseKey: "care.self_care_displaced",
    offering: "ANCHOR_ONE_THING",
    userPattern: "caretaker, strong outward care, thin self-record",
    evidenceShape: "care for others visible while self-maintenance is thin",
    calendarArcMove:
      "the gathering season asks what was tended and what was set aside",
    alignmentMove: "outward care was real and consistent",
    gapMove: "the caretaker's own physical maintenance stayed quiet",
    lessonMove: "sustained giving requires a replenishment record",
    closingMove: "question",
    text:
      "The gathering season asks for what was tended and what was set aside - an honest accounting before the quieter months. The care account this decan was full in one direction: what was given outward was real, consistent, and present. What was given inward - the caretaker's own physical maintenance - stayed thin. The body that tends others runs its own account, and that account was quiet when it mattered. Sustained giving requires a replenishment record; without it, the depletion only becomes visible in retrospect. What one thing, tracked next decan only for yourself, would make the account complete in both directions?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-007",
    decan: "Thoth",
    month: "Thoth",
    season: "Akhet",
    caseKey: "truthful_record.vague_entries",
    offering: "WRITE_ONE_DETAIL",
    userPattern: "mid-career professional, active journal, generic language",
    evidenceShape: "active journal without particularity",
    calendarArcMove:
      "Djehuty asks for honest accounting, specific measure, and content",
    alignmentMove: "the journal was active",
    gapMove: "the entries could apply to any day",
    lessonMove: "measure without particulars is not yet measure",
    closingMove: "question",
    text:
      "The month of Djehuty asks for honest accounting - not volume, not performance, but specific measure. The journal was active this decan; the entries stayed at the surface level, applicable to any day rather than this particular one. Vague records accumulate without building, because the pattern only becomes legible through specific detail. Measure without particulars is not yet measure - it's a record that confirms presence without capturing content. What one entry from this decan could be made specific enough that reading it three months from now would bring the moment back?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-008",
    decan: "Paophi",
    month: "Paophi",
    season: "Akhet",
    caseKey: "visible_work.too_many_open_loops",
    offering: "REDUCE_AND_COMPLETE_ONE",
    userPattern: "entrepreneur, many tasks started, none closed",
    evidenceShape: "many work fronts active without closure",
    calendarArcMove:
      "the flood recedes and order returns to the visible surface",
    alignmentMove: "real effort was given across many fronts",
    gapMove: "nothing crossed into closure",
    lessonMove:
      "when ground becomes readable, finished things should stand on it",
    closingMove: "question",
    text:
      "This decan's theme was the flood receding - order returning to the visible surface, ground becoming readable again after disruption. The work was genuinely active: many tasks opened, real effort given, numerous fronts engaged. What the period didn't produce was closure - everything in motion, nothing crossed. When the flood recedes, what's left behind should be readable; the decan asked for finished things to stand on. Which one task, brought to a real close before next decan opens, would give the most stable footing for what follows?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-009",
    decan: "Pharmuthi",
    month: "Pharmuthi",
    season: "Peret",
    caseKey: "provision.feast_famine",
    offering: "STABILIZE_FLOOR",
    userPattern: "younger user, high variance, quiet phase",
    evidenceShape: "full engagement at peak then quiet",
    calendarArcMove: "the rising season asks for growth that holds",
    alignmentMove: "the peak engagement was real",
    gapMove: "the practice has not found a floor",
    lessonMove:
      "growth is small repeated acts outlasting the wave of motivation",
    closingMove: "question",
    text:
      "The rising season asks for growth that holds - not the intense burst but the consistent return, week after week, until the habit has roots. The body care account this decan followed the familiar arc: full engagement at the peak, then quiet. That cycle is honest; it's also the shape of a practice that hasn't found its floor yet. The rising of the season is not one dramatic moment - it's the gradual accumulation of small repeated acts that outlast the wave of motivation that began them. What one nourishment practice is small enough to keep even when the drive for the full routine is absent?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-010",
    decan: "Epiphi",
    month: "Epiphi",
    season: "Shemu",
    caseKey: "visible_work.repeated_deferral",
    offering: "RELEASE",
    userPattern: "strategic planner, same task deferred three decans",
    evidenceShape: "one task carried repeatedly without closing",
    calendarArcMove:
      "harvest asks which work ripened and which passed its season",
    alignmentMove: "the task remained visible in the account",
    gapMove: "it deferred without closing across periods",
    lessonMove:
      "the answer determines whether to resize, wait conditionally, or release",
    closingMove: "question",
    text:
      "The harvest period asks which work has ripened and which has passed its season. One task has carried over from last decan and the one before, deferring each time without closing - and the harvest's honest question is whether this grain is still growing or has simply been left too long in the field. A task that defers repeatedly is usually one of three things: too large as currently defined, waiting on something that hasn't arrived, or quietly no longer the right work for where things are. Which one is true for this particular task? The answer determines the right response - resize, wait with a condition, or release.",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-011",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "study.retention_missing",
    offering: "WRITE_ONE_DETAIL",
    userPattern: "avid reader, high node views, nothing saved",
    evidenceShape: "study engagement without saved insight",
    calendarArcMove: "stable return asks for what was held and made returnable",
    alignmentMove: "study engagement was real and wide",
    gapMove: "nothing was saved, linked, or written",
    lessonMove: "encounter without a mark cannot be recovered by the account",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ asked not just for what was encountered but for what was held - care made durable, insight made returnable. The study engagement was real and wide this period: genuine attention given, real content explored. What didn't happen was the anchoring - nothing saved, nothing linked, nothing written about what moved. Reading without leaving a mark produces a period of genuine engagement that the account can't recover anything from. Hathor's period asks for beauty that stays. What one thing encountered this decan is worth one sentence of honest response?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-012",
    decan: "Thoth",
    month: "Thoth",
    season: "Akhet",
    caseKey: "visible_work.no_finish_condition",
    offering: "FINISH_CONDITION",
    userPattern: "academic, research tasks sprawl indefinitely",
    evidenceShape: "research effort without bounded deliverable",
    calendarArcMove: "Djehuty asks that work produce something finishable",
    alignmentMove: "research and writing were genuine",
    gapMove: "the work stayed in motion without defined end states",
    lessonMove: "right measure asks for a visible stopping point",
    closingMove: "question",
    text:
      "Djehuty's month asks that the work produce something finishable - not just something ongoing. The research and writing this decan were genuine: real intellectual effort, real engagement with the material. But none of it arrived at a bounded deliverable; the tasks stayed in motion without defined end states. Work without a finish condition is not incomplete - it is unbounded, which is a different problem requiring a different response. The month of right measure asks for work with a visible stopping point. What would 'finished enough to close this decan on' look like for the most important open piece?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-013",
    decan: "Mesori",
    month: "Mesori",
    season: "Shemu",
    caseKey: "release.overcommitted",
    offering: "RELEASE",
    userPattern: "mid-career professional, high aggregate obligation count",
    evidenceShape: "full account with lower completion across categories",
    calendarArcMove:
      "the completing season asks which obligations are met and which are carried forward",
    alignmentMove: "the account was full and intention was broad",
    gapMove: "capacity and margin were insufficient for the load",
    lessonMove: "completion requires capacity, and capacity requires margin",
    closingMove: "question",
    text:
      "The completing season asks which obligations have been met and which are being carried forward without resolution - an inventory before the next cycle opens. The account this decan was full across every category, and the weight showed: the completion rates across all areas were lower than the opening intentions. Completion requires capacity, and capacity requires margin; carrying more than the period can hold isn't ambition, it's accumulation that costs the whole account. The completing season asks for deliberate release. What one obligation, released fully today, would bring the remaining load back to something that can actually be kept?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-014",
    decan: "Khoiak",
    month: "Khoiak",
    season: "Akhet",
    caseKey: "attention.scattered_inputs",
    offering: "DEPTH_FOCUS",
    userPattern: "creative professional, wide but shallow engagement",
    evidenceShape: "many areas touched without depth",
    calendarArcMove:
      "the inward season asks what is worth gathering and storing",
    alignmentMove: "attention was wide and real",
    gapMove: "none of the threads reached depth",
    lessonMove: "gathering season asks for one thread worth following through",
    closingMove: "question",
    text:
      "The inward season asks for what is worth gathering and storing - not everything encountered, but what will sustain the quieter months ahead. The attention record this decan was wide: many areas touched, many threads started, none followed far enough to produce real depth. Wide attention in a gathering season produces a shallow harvest. The season doesn't ask for more material; it asks for one thread worth following through to something that holds. Which one area, if given full attention next decan, would produce something worth keeping when the season turns?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-015",
    decan: "Akhet",
    month: "Akhet",
    season: "Akhet",
    caseKey: "provision.no_recent_completion",
    offering: "ANCHOR_ONE_THING",
    userPattern: "user in transition, routine disrupted",
    evidenceShape: "physical care quiet under changed conditions",
    calendarArcMove:
      "the flood season asks what continues when the ground is covered",
    alignmentMove: "the context made the quiet legible",
    gapMove: "the ordinary routine could not follow the changed ground",
    lessonMove: "recovery begins with the first practice that returns",
    closingMove: "charge",
    text:
      "The flood season asks for what continues even when the ground is covered - what practices hold their shape through the disruption. The physical care record went quiet this decan, and the context makes it legible: the ground shifted, the environment changed, the ordinary routine couldn't follow. That kind of quiet is not the same as neglect - it's infrastructure broken by transition. What the flood season asks is simpler than restoration: when the water recedes and the ground reappears, what one practice returns first? Name that, and the account knows where the next routine begins.",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-016",
    decan: "Tybi",
    month: "Tybi",
    season: "Peret",
    caseKey: "truthful_record.inconsistent_coverage",
    offering: "STABILIZE_FLOOR",
    userPattern: "spiritual user, heavy ceremony record, absent ordinary days",
    evidenceShape: "bright peaks with dark stretches between",
    calendarArcMove:
      "the clarifying season asks for a record that can be read clearly",
    alignmentMove: "ritual periods were recorded fully",
    gapMove: "ordinary days stayed unlit",
    lessonMove: "clarity comes from consistent light, not only bright moments",
    closingMove: "question",
    text:
      "The clarifying season asks for a record that can be read clearly - not just illuminated in some stretches and dark in others. The journal this decan was full during the ritual periods and absent between them; the account knows the peaks without knowing the ground between them. That makes the pattern only partially visible - it shows intensity without the texture of the ordinary days where the practice either holds or quietly slips. Clarity in this season comes from consistent light, not just bright moments. What one small writing practice, kept even on unremarkable days, would make the record whole rather than episodic?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-017",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "restraint.repeated_overcommit",
    offering: "STRUCTURAL_CHANGE",
    userPattern: "entrepreneur, repeated overcommitment across decans",
    evidenceShape: "opening obligations exceed actual completion repeatedly",
    calendarArcMove:
      "stable return asks for commitment proportionate to capacity",
    alignmentMove: "the pattern across decans is legible",
    gapMove: "planning is based on ambition more than run history",
    lessonMove: "stability comes from planning to what is actually possible",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ asked for what could be held without strain - the shape of commitment proportionate to the season's actual capacity. The opening of this decan carried more obligations than the period could hold, as the last several have; the completion rate reflects that pattern consistently. Stability in Hathor's season doesn't come from doing more - it comes from planning to what's actually possible based on how things have actually run, not how they were intended to run. What would next decan's opening list look like if it was built from the last three decans' real completion, rather than from the opening ambition?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-018",
    decan: "Paophi",
    month: "Paophi",
    season: "Akhet",
    caseKey: "rhythm.recovery_after_break",
    offering: "RE_ENTRY",
    userPattern: "established user returning after difficult stretch",
    evidenceShape: "practice quiet after conditions eased",
    calendarArcMove:
      "the receding flood reveals what returns to visible surface",
    alignmentMove: "the practice still has a returning path",
    gapMove: "the routine has not restarted on its own",
    lessonMove: "re-entry needs one honest step, not a full restart",
    closingMove: "question",
    text:
      "The receding flood reveals what returns to the visible surface and in what sequence. The practice went quiet during the difficult stretch and hasn't fully returned since the conditions eased - not from disinterest but from the gap between when a routine breaks and when it restarts on its own. The flood doesn't rush; it reveals the ground gradually, and re-entry into a steady practice works the same way: one reliable thing returns, then the next finds its footing. Re-entry doesn't require a full restart, just the next honest step. What one mark, made today, ends the quiet period and says the practice has come back?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-019",
    decan: "Thoth",
    month: "Thoth",
    season: "Akhet",
    caseKey: "speech.promise_unresolved",
    offering: "COMMIT_TODAY",
    userPattern: "professional, stated commitment not honored yet",
    evidenceShape: "promise present and follow-through pending",
    calendarArcMove:
      "the month of true account asks that the word given finds its return",
    alignmentMove: "the intention was genuine",
    gapMove: "the follow-through is pending",
    lessonMove:
      "honest relationship with what was said requires action or changed terms",
    closingMove: "question",
    text:
      "The month of true account asks that the word given finds its return - that what was spoken outward comes back as action. A commitment made this decan is still open: the intention was genuine, and the follow-through is pending. Djehuty's accounting doesn't require perfection; it requires honest relationship with what was said - either the action or an honest acknowledgment that the terms have changed. The word that goes out and doesn't return creates a small disorder in the account, not catastrophic but present. What is the one specific next action, within your authority today, that moves this from stated to honored?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-020",
    decan: "Pharmuthi",
    month: "Pharmuthi",
    season: "Peret",
    caseKey: "craft.piece_unfinished",
    offering: "FINISH_CONDITION",
    userPattern: "visual artist, piece in motion but not closed",
    evidenceShape: "creative piece visible but not closed",
    calendarArcMove: "the rising season asks what is ready to emerge",
    alignmentMove: "the seed is real and the shape is visible",
    gapMove: "the work has not reached a finished-enough state",
    lessonMove: "emergence asks for a state that can stand on its own for now",
    closingMove: "question",
    text:
      "The rising season asks what is ready to emerge - what has been tended long enough to come into the light. A piece of creative work has been in motion through the decan without reaching a close; the seed is real, the growth is happening, the shape is visible. But the rising season also asks for the moment of emergence - the work brought to a finished-enough state that it can stand on its own. Not finished forever, finished for now: in a state that could be shown, returned to later, or deliberately set aside. What session, this week, brings the open piece to that point?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-021",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "care.support_thread_open",
    offering: "COMMIT_TODAY",
    userPattern: "parent, care thread open during busy stretch",
    evidenceShape: "care thread opened but not closed",
    calendarArcMove:
      "Hathor asks for warmth restored and bonds returned to presence",
    alignmentMove: "the intention behind the care was present",
    gapMove: "timing missed the act of attention",
    lessonMove: "warmth is small, specific, and given with presence",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ asks for warmth restored - bonds returned to, the house made inhabitable again, the connections that were thinned by pressure brought back to real presence. A care thread opened this decan and stayed open: someone in the circle of responsibility received less attention than the intention behind it. That gap is not a failure of love; it's a timing miss in a demanding stretch, and the decan still has room to close it. The warmth Hathor asks for is not grand - it is small, specific, and given with presence. What one act of attention today closes this thread before the decan turns?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-022",
    decan: "Khoiak",
    month: "Khoiak",
    season: "Akhet",
    caseKey: "visible_work.stale_growing_list",
    offering: "PRUNE",
    userPattern: "consultant, task list accumulating across decans",
    evidenceShape: "list grows while completion drifts down",
    calendarArcMove:
      "the inward season asks for honest inventory and composting",
    alignmentMove: "the active list stayed visible",
    gapMove: "the list became an archive of commitments",
    lessonMove: "gathering season asks for deliberate curation",
    closingMove: "question",
    text:
      "The inward season is a time for honest inventory - what belongs in the store and what should be composted before the new cycle opens. The task list has been growing steadily across several decans while the completion rate has drifted down: more added, fewer closed, the list accumulating past the point where it reflects actual current work. That's not a work problem; it's an inventory problem - the list has become an archive of commitments rather than a map of the active ones. The gathering season asks for deliberate curation. Which items, released today, would make what remains genuinely actionable?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-023",
    decan: "Mesori",
    month: "Mesori",
    season: "Shemu",
    caseKey: "order.sequence_blocked",
    offering: "UNBLOCK_PREREQUISITE",
    userPattern: "developer, downstream tasks stalled by prerequisite",
    evidenceShape: "several tasks blocked by upstream work",
    calendarArcMove:
      "completion asks which work can close and which is waiting upstream",
    alignmentMove: "effort was present in the downstream items",
    gapMove: "the sequence was wrong",
    lessonMove: "completion asks for the work in the right order",
    closingMove: "question",
    text:
      "The completing season asks which work is ready to close and which is still waiting on something upstream. Several tasks have been open without movement, and the structural reason is clear: a foundational piece hasn't been finished, so everything dependent on it is blocked. The effort going into the downstream items is real but can't produce outputs - the sequence is wrong, not the work. Completion asks for the work in the right order. What single prerequisite, finished today, makes two or three other things actionable that currently are not?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-024",
    decan: "Akhet",
    month: "Akhet",
    season: "Akhet",
    caseKey: "provision.capacity_mismatch",
    offering: "RELEASE_WITHOUT_GUILT",
    userPattern: "user under high external load",
    evidenceShape: "body support thin under external demand",
    calendarArcMove:
      "the flood season asks what sustains the body through disruption",
    alignmentMove: "the context made the exchange honest",
    gapMove: "the usual care routine received less capacity",
    lessonMove:
      "the flood asks for one practice that holds the thread until routine returns",
    closingMove: "question",
    text:
      "The flood season asks for what sustains the body through disruption - not the full care routine, but the minimum that keeps the ground from going entirely unmapped. The body support account is thin this decan, and the context is honest: something external demanded what the physical maintenance routine usually receives, and that exchange was appropriate for the season. The flood doesn't ask for the usual account; it asks for one practice that holds the thread until the water recedes and the routine can return. What one small act of physical care would represent the practice holding itself through a harder stretch?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-025",
    decan: "Tybi",
    month: "Tybi",
    season: "Peret",
    caseKey: "study.application_gap",
    offering: "COMMIT_TODAY",
    userPattern: "practitioner, ideas in journal, no action translation",
    evidenceShape: "ideas recorded without task translation",
    calendarArcMove:
      "the clarifying season asks for understanding that produces direction",
    alignmentMove: "genuine intellectual attention was present",
    gapMove: "insights did not cross into observable behavior",
    lessonMove: "clarity that does not produce a next step stays unlanded",
    closingMove: "charge",
    text:
      "The clarifying season asks for understanding that produces direction - not insights held abstractly but ideas that find their way into the practice. The study engagement this decan was real: genuine intellectual attention given, ideas named in the journal. What didn't happen was the crossing over: the insights are in the record but haven't appeared in the task list or changed anything observable in behavior. Clarity that doesn't produce the next step stays in circulation without landing. What one idea from this decan's engagement is asking for a specific concrete response? Name the action it implies and write it where it can be tracked.",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-026",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "truthful_record.record_after_action_missing",
    offering: "RECORD_WHAT_HAPPENED",
    userPattern: "active daily user, practice running, log empty",
    evidenceShape: "care happened but written account did not follow",
    calendarArcMove:
      "restored embodiment asks for care made visible in the record",
    alignmentMove: "the physical care happened",
    gapMove: "the written account did not follow",
    lessonMove:
      "Hathor's season completes in the recording, not only the doing",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ asked for restored embodiment - care made visible, tended and witnessed in the record, not just lived. The physical care happened this period: the body was maintained, the daily routine ran, the work was done. But the written account didn't follow, which means the decan of returned stability has no evidence of the stability it was asked to restore. The gap isn't in the care; it's in the account of it. Hathor's season is completed in the recording, not only in the doing. What five marks, closed now, would make the record honest about what this decan actually was?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-027",
    decan: "Paophi",
    month: "Paophi",
    season: "Akhet",
    caseKey: "restraint.overreach_language",
    offering: "RELEASE_WITHOUT_GUILT",
    userPattern: "creative professional, journal overextension signals",
    evidenceShape: "journal names unsustainable pace",
    calendarArcMove:
      "the receding flood asks what the ground can actually hold",
    alignmentMove: "the journal carried the weight honestly",
    gapMove: "pace exceeded sustainable measure",
    lessonMove: "what remains should be solid enough for the body to carry",
    closingMove: "question",
    text:
      "The receding flood season asks for what the ground can actually hold - not every ambition, but what's proportionate to what the earth has left after the water passes. The journal this decan describes a pace past sustainable: too much force, too many hours demanded, the output pushed beyond what the available energy could give with quality. That pattern is legible in the record - the journal carries its weight honestly. The flood recedes; what remains should be what was actually solid. What one thing, released from the current pace, would bring the work back to a rhythm the body can sustain without cost that exceeds the output?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-028",
    decan: "Thoth",
    month: "Thoth",
    season: "Akhet",
    caseKey: "provision.aspirational_items",
    offering: "RELEASE",
    userPattern: "new user, several items added but never started",
    evidenceShape: "items added with intention and untouched across decans",
    calendarArcMove:
      "Djehuty asks the record to reflect what is real rather than intended",
    alignmentMove: "the initial intention was genuine",
    gapMove: "the aspirational items were not current practice",
    lessonMove:
      "what is practiced and what is hoped toward belong in different places",
    closingMove: "question",
    text:
      "Djehuty's accounting asks that the record reflect what's real rather than what's intended - the honest list rather than the aspirational one. Several body support items on the current list have never been started: added with genuine intention at the outset and untouched across every decan since. An honest account includes the distinction between what is being practiced and what is being hoped toward, and those belong in different places. What remains when the aspirational items are separated out is the actual practice - smaller than the list, more honest, and more buildable. Which items correspond to something you're doing for your body today, as opposed to something you intend to start?",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-029",
    decan: "Epiphi",
    month: "Epiphi",
    season: "Shemu",
    caseKey: "visible_work.started_not_closed",
    offering: "REDUCE_AND_COMPLETE_ONE",
    userPattern: "project manager, multiple tasks partially done",
    evidenceShape: "several tasks partially done, none finished",
    calendarArcMove:
      "peak harvest asks which work has matured and should be brought in",
    alignmentMove: "real progress and effort were present",
    gapMove: "the close consistently did not arrive",
    lessonMove: "harvest asks for the close, not more beginning",
    closingMove: "question",
    text:
      "The peak harvest asks which work has matured and which is still ripening - and which has been in the field long enough that it simply needs to be brought in. Several tasks this decan are partially done: real progress made, real effort given, the close consistently not arriving. Work at harvest that doesn't get brought in waits for the next cycle or weathers in the field without improving. The harvest asks for the close, not more beginning. Which one task is closest to finished right now - not most important, just closest to done? Bring that one in before the decan turns.",
    sourceFile: SOURCE_FILE,
  },
  {
    id: "reflection-calendar-arc-030",
    decan: "Hathor - sꜣḥ",
    month: "Hathor",
    season: "Akhet",
    caseKey: "provision.completed_not_logged",
    offering: "RECORD_WHAT_HAPPENED",
    userPattern: "busy daily user, care happening, log empty",
    evidenceShape: "care happened but the log stayed empty",
    calendarArcMove:
      "Hathor asks for restored embodiment: care lived and known",
    alignmentMove: "physical care happened",
    gapMove: "the account stayed blank where stability was present",
    lessonMove:
      "the gap is in the record of nourishment, not nourishment itself",
    closingMove: "question",
    text:
      "Hathor's first decan sꜣḥ asked for restored embodiment - care that is lived and known, present in the body and present in the record. The physical care happened this period: meals eaten, maintenance kept, the body held through a full decan. But the log stayed empty, which means the account of restored stability is blank where the stability actually was. That gap isn't in the nourishment; it's in the record of it - the care occurred and the account doesn't know it. What happened for your body this decan deserves to be visible. What ten minutes, taken now, closes the marks that belong to what this period actually was?",
    sourceFile: SOURCE_FILE,
  },
];

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[ꜣꜥȝ]/g, "a")
    .replace(/[ḫẖ]/g, "h")
    .replace(/[ḥ]/g, "h")
    .replace(/[ḏḍ]/g, "d")
    .replace(/[š]/g, "s")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedWords(value: string | string[] | null | undefined) {
  const text = Array.isArray(value) ? value.join(" ") : value ?? "";
  return new Set(
    normalize(text)
      .split(/\s+/)
      .filter((word) => word.length >= 4),
  );
}

function overlapScore(
  exampleValue: string,
  targetValue: string | string[] | null | undefined,
  maxScore: number,
) {
  const exampleWords = normalizedWords(exampleValue);
  const targetWords = normalizedWords(targetValue);
  if (exampleWords.size === 0 || targetWords.size === 0) return 0;
  let hits = 0;
  for (const word of targetWords) {
    if (exampleWords.has(word)) hits += 1;
  }
  return Math.min(maxScore, hits);
}

function offeringAliases(value: string | null | undefined) {
  const key = normalize(value).replace(/\s+/g, "_");
  const aliases = new Set([key]);
  const add = (...items: string[]) =>
    items.forEach((item) => aliases.add(normalize(item).replace(/\s+/g, "_")));
  if (key.includes("record")) add("record_what_happened", "write_one_detail");
  if (key.includes("write")) add("write_one_detail", "record_what_happened");
  if (key.includes("release")) {
    add("release", "release_without_guilt", "release_unrealistic_target");
  }
  if (key.includes("finish")) add("finish_condition", "set_finish_condition");
  if (key.includes("reduce")) add("reduce_and_complete_one", "scope_reduction");
  if (key.includes("anchor")) add("anchor_one_thing", "habit_stack");
  if (key.includes("habit")) add("habit_stack", "anchor_one_thing");
  if (key.includes("stabilize")) add("stabilize_floor");
  if (key.includes("reschedule")) add("reschedule");
  if (key.includes("prune")) add("prune", "release");
  if (key.includes("commit")) add("commit_today", "recommit");
  return aliases;
}

function exampleScore(
  example: MaatReflectionExample,
  params: {
    caseKey?: string | null;
    offering?: string | null;
    decanName?: string | null;
    monthName?: string | null;
    seasonName?: string | null;
    userPattern?: string | string[] | null;
    evidenceShape?: string | string[] | null;
  },
) {
  let score = 0;
  if (normalize(example.caseKey) === normalize(params.caseKey)) score += 8;
  const targetOfferings = offeringAliases(params.offering);
  const exampleOfferings = offeringAliases(example.offering);
  for (const alias of targetOfferings) {
    if (exampleOfferings.has(alias)) {
      score += 4;
      break;
    }
  }
  const decan = normalize(params.decanName);
  if (decan && normalize(example.decan).includes(decan.split(" ")[0])) {
    score += 4;
  }
  const month = normalize(params.monthName);
  if (month && normalize(example.month) === month) score += 3;
  const season = normalize(params.seasonName);
  if (season && normalize(example.season) === season) score += 2;
  score += overlapScore(example.userPattern, params.userPattern, 3);
  score += overlapScore(example.evidenceShape, params.evidenceShape, 3);
  return score;
}

export function selectMaatReflectionExamples(params: {
  caseKey?: string | null;
  offering?: string | null;
  decanName?: string | null;
  monthName?: string | null;
  seasonName?: string | null;
  userPattern?: string | string[] | null;
  evidenceShape?: string | string[] | null;
  limit?: number;
}): MaatReflectionExample[] {
  const limit = Math.max(1, Math.min(params.limit ?? 2, 4));
  return [...MAAT_REFLECTION_EXAMPLES]
    .map((example) => ({
      example,
      score: exampleScore(example, params),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.example.id.localeCompare(b.example.id);
    })
    .slice(0, limit)
    .map((item) => item.example);
}

export function maatReflectionExamplePromptBlock(
  examples: MaatReflectionExample[] | null | undefined,
) {
  if (!examples?.length) return "";
  return `\n\nREFLECTION_CALENDAR_ARC_EXAMPLES (${MAAT_REFLECTION_EXAMPLE_STORE_VERSION}; use as structure and quality references, not as evidence to copy):\n${
    examples.map((example) =>
      [
        `Example ${example.id}`,
        `Decan/month/season: ${example.decan} / ${example.month} / ${example.season}`,
        `Case/offering: ${example.caseKey} / ${example.offering}`,
        `User pattern: ${example.userPattern}`,
        `Evidence shape: ${example.evidenceShape}`,
        `Moves: calendar=${example.calendarArcMove}; alignment=${example.alignmentMove}; gap=${example.gapMove}; lesson=${example.lessonMove}; closing=${example.closingMove}`,
        `Text: ${example.text}`,
      ].join("\n")
    ).join("\n\n")
  }`;
}
