export const KA_MAX_MESSAGE_WORDS = 250;
export const KA_DAY_7_QUESTION_MAX_WORDS = 50;

export const KA_MESSAGE_KIND_BY_DAY = {
  1: "honest_account",
  2: "witness_response",
  3: "need_named",
  4: "gift_given",
  5: "simultaneous_witness",
  6: "witness_received",
  7: "question",
  8: "answer",
  9: "change_named",
  10: "ka_formula",
} as const;

export type KaDayNumber = keyof typeof KA_MESSAGE_KIND_BY_DAY;
export type KaMessageKind =
  (typeof KA_MESSAGE_KIND_BY_DAY)[keyof typeof KA_MESSAGE_KIND_BY_DAY];

export type KaMessageValidationError =
  | "empty_body"
  | "message_word_limit"
  | "day_number_invalid"
  | "message_kind_mismatch"
  | "day_7_question_word_limit";

export type KaMessageDraft = {
  body: string;
  dayNumber: number;
  messageKind: string;
};

export type KaMessageValidationResult = {
  ok: boolean;
  wordCount: number;
  expectedKind: KaMessageKind | null;
  errors: KaMessageValidationError[];
};

export function kaWordCount(body: string): number {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

export function expectedKaMessageKind(dayNumber: number): KaMessageKind | null {
  if (!Number.isInteger(dayNumber)) return null;
  return KA_MESSAGE_KIND_BY_DAY[dayNumber as KaDayNumber] ?? null;
}

export function validateKaMessageDraft(
  draft: KaMessageDraft,
): KaMessageValidationResult {
  const wordCount = kaWordCount(draft.body);
  const expectedKind = expectedKaMessageKind(draft.dayNumber);
  const errors: KaMessageValidationError[] = [];

  if (wordCount === 0) errors.push("empty_body");
  if (wordCount > KA_MAX_MESSAGE_WORDS) errors.push("message_word_limit");
  if (expectedKind == null) errors.push("day_number_invalid");
  if (expectedKind != null && draft.messageKind !== expectedKind) {
    errors.push("message_kind_mismatch");
  }
  if (
    draft.dayNumber === 7 &&
    draft.messageKind === "question" &&
    wordCount > KA_DAY_7_QUESTION_MAX_WORDS
  ) {
    errors.push("day_7_question_word_limit");
  }

  return {
    ok: errors.length === 0,
    wordCount,
    expectedKind,
    errors,
  };
}

export type KaDay5VisibilityInput = {
  dayNumber: number;
  isOwnMessage: boolean;
  bothMessagesSent: boolean;
  dayWindowClosed: boolean;
};

export function kaMessageVisibleToParticipant(
  input: KaDay5VisibilityInput,
): boolean {
  if (input.isOwnMessage) return true;
  if (input.dayNumber !== 5) return true;
  return input.bothMessagesSent || input.dayWindowClosed;
}

export type KaStoredMessage = {
  senderId: string;
  dayNumber: number;
  messageKind: string;
  deletedAt?: string | null;
};

export type KaPairCompletionState = {
  completedDayCount: number;
  userAFormulaSpoken: boolean;
  userBFormulaSpoken: boolean;
  complete: boolean;
};

export function kaPairCompletionState(
  messages: KaStoredMessage[],
  userA: string,
  userB: string,
): KaPairCompletionState {
  const activeMessages = messages.filter((message) =>
    message.deletedAt == null &&
    (message.senderId === userA || message.senderId === userB)
  );

  const sendersByDay = new Map<number, Set<string>>();
  for (const message of activeMessages) {
    const senders = sendersByDay.get(message.dayNumber) ?? new Set<string>();
    senders.add(message.senderId);
    sendersByDay.set(message.dayNumber, senders);
  }

  let completedDayCount = 0;
  for (const senders of sendersByDay.values()) {
    if (senders.has(userA) && senders.has(userB)) completedDayCount += 1;
  }

  const userAFormulaSpoken = activeMessages.some((message) =>
    message.senderId === userA &&
    message.dayNumber === 10 &&
    message.messageKind === "ka_formula"
  );
  const userBFormulaSpoken = activeMessages.some((message) =>
    message.senderId === userB &&
    message.dayNumber === 10 &&
    message.messageKind === "ka_formula"
  );
  const complete = userAFormulaSpoken && userBFormulaSpoken;

  return {
    completedDayCount: complete ? 10 : completedDayCount,
    userAFormulaSpoken,
    userBFormulaSpoken,
    complete,
  };
}
