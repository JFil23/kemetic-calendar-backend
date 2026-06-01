import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  expectedKaMessageKind,
  KA_DAY_7_QUESTION_MAX_WORDS,
  KA_MAX_MESSAGE_WORDS,
  kaMessageVisibleToParticipant,
  kaPairCompletionState,
  kaWordCount,
  validateKaMessageDraft,
} from "./ka_flow.ts";

Deno.test("Ka message validation enforces day kind and word limits", () => {
  assertEquals(kaWordCount("  one\n two\tthree  "), 3);
  assertEquals(expectedKaMessageKind(5), "simultaneous_witness");

  const valid = validateKaMessageDraft({
    dayNumber: 1,
    messageKind: "honest_account",
    body: "Here is the honest account.",
  });
  assert(valid.ok);
  assertEquals(valid.wordCount, 5);

  const oversized = validateKaMessageDraft({
    dayNumber: 1,
    messageKind: "honest_account",
    body: Array.from({ length: KA_MAX_MESSAGE_WORDS + 1 }, () => "word").join(
      " ",
    ),
  });
  assertEquals(oversized.ok, false);
  assertEquals(oversized.errors.includes("message_word_limit"), true);

  const wrongKind = validateKaMessageDraft({
    dayNumber: 8,
    messageKind: "question",
    body: "This is a late question.",
  });
  assertEquals(wrongKind.ok, false);
  assertEquals(wrongKind.expectedKind, "answer");
  assertEquals(wrongKind.errors.includes("message_kind_mismatch"), true);
});

Deno.test("Ka day 7 questions keep their tighter prompt limit", () => {
  const tooLongQuestion = validateKaMessageDraft({
    dayNumber: 7,
    messageKind: "question",
    body: Array.from(
      { length: KA_DAY_7_QUESTION_MAX_WORDS + 1 },
      () => "word",
    ).join(" "),
  });

  assertEquals(tooLongQuestion.ok, false);
  assertEquals(
    tooLongQuestion.errors.includes("day_7_question_word_limit"),
    true,
  );
});

Deno.test("Ka day 5 simultaneous witness stays hidden until both send or window closes", () => {
  assertEquals(
    kaMessageVisibleToParticipant({
      dayNumber: 5,
      isOwnMessage: false,
      bothMessagesSent: false,
      dayWindowClosed: false,
    }),
    false,
  );
  assertEquals(
    kaMessageVisibleToParticipant({
      dayNumber: 5,
      isOwnMessage: true,
      bothMessagesSent: false,
      dayWindowClosed: false,
    }),
    true,
  );
  assertEquals(
    kaMessageVisibleToParticipant({
      dayNumber: 5,
      isOwnMessage: false,
      bothMessagesSent: true,
      dayWindowClosed: false,
    }),
    true,
  );
  assertEquals(
    kaMessageVisibleToParticipant({
      dayNumber: 5,
      isOwnMessage: false,
      bothMessagesSent: false,
      dayWindowClosed: true,
    }),
    true,
  );
});

Deno.test("Ka completion requires both day 10 formulas", () => {
  const userA = "user-a";
  const userB = "user-b";

  const partial = kaPairCompletionState(
    [
      { senderId: userA, dayNumber: 10, messageKind: "ka_formula" },
    ],
    userA,
    userB,
  );
  assertEquals(partial.complete, false);
  assertEquals(partial.userAFormulaSpoken, true);
  assertEquals(partial.userBFormulaSpoken, false);

  const complete = kaPairCompletionState(
    [
      { senderId: userA, dayNumber: 10, messageKind: "ka_formula" },
      { senderId: userB, dayNumber: 10, messageKind: "ka_formula" },
    ],
    userA,
    userB,
  );
  assertEquals(complete.complete, true);
  assertEquals(complete.completedDayCount, 10);
});
