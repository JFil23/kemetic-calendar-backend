import { computePreviousCurrentAndNextDecanWindows } from "./decan_schedule.ts";

type ReconcileClient = {
  // Supabase query builders are thenable in production and lightweight mocks
  // in tests, so keep this boundary intentionally narrow.
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

type EligibleUserRow = {
  id: string;
  timezone: string | null;
};

type ExistingScheduleRow = {
  id: string;
  user_id: string;
  decan_start: string;
  status: string;
  send_at: string;
  next_attempt_at?: string | null;
  sent_at: string | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function timestampsEqualAtSchedulerPrecision(
  existing: string | null | undefined,
  scheduled: string | null | undefined,
) {
  const existingMs = typeof existing === "string"
    ? Date.parse(existing)
    : Number.NaN;
  const scheduledMs = typeof scheduled === "string"
    ? Date.parse(scheduled)
    : Number.NaN;
  return Number.isFinite(existingMs) &&
    Number.isFinite(scheduledMs) &&
    existingMs === scheduledMs;
}

async function fetchEligibleUsers(
  client: ReconcileClient,
  from: number,
  to: number,
  activeUserIds: string[],
): Promise<EligibleUserRow[]> {
  if (!activeUserIds.length) return [];
  const { data, error } = await client
    .from("profiles")
    .select("id, timezone")
    .in("id", activeUserIds)
    .order("id", { ascending: true })
    .range(from, to);
  if (error) {
    throw new Error(`Eligible user fetch error: ${errorMessage(error)}`);
  }
  return (data ?? []) as EligibleUserRow[];
}

async function fetchExistingSchedules(
  client: ReconcileClient,
  userIds: string[],
  decanStarts: string[],
): Promise<ExistingScheduleRow[]> {
  if (!userIds.length || !decanStarts.length) return [];
  const { data, error } = await client
    .from("decan_reflection_schedule")
    .select(
      "id, user_id, decan_start, status, send_at, next_attempt_at, sent_at",
    )
    .in("user_id", userIds)
    .in("decan_start", decanStarts);
  if (error) {
    throw new Error(`Schedule fetch error: ${errorMessage(error)}`);
  }
  return (data ?? []) as ExistingScheduleRow[];
}

async function updateSchedule(
  client: ReconcileClient,
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await client
    .from("decan_reflection_schedule")
    .update(values)
    .eq("id", id);
  if (error) {
    throw new Error(`Schedule update error: ${errorMessage(error)}`);
  }
}

export async function reconcileDecanReflectionSchedules(
  client: ReconcileClient,
  params: {
    now: Date;
    activeUserIds: string[];
    batchSize?: number;
  },
) {
  const batchSize = Math.max(1, Math.min(params.batchSize ?? 500, 1000));
  let from = 0;
  const totals = {
    active_user_count: params.activeUserIds.length,
    users_scanned: 0,
    inserted: 0,
    updated: 0,
    made_good: 0,
  };

  while (true) {
    const users = await fetchEligibleUsers(
      client,
      from,
      from + batchSize - 1,
      params.activeUserIds,
    );
    if (!users.length) break;
    totals.users_scanned += users.length;

    const userWindows = users.map((user) => ({
      userId: user.id,
      windows: computePreviousCurrentAndNextDecanWindows(
        params.now,
        user.timezone,
      ),
    }));
    const rows = userWindows.flatMap(({ userId, windows }) =>
      windows.map((window) => ({
        user_id: userId,
        decan_start: window.start,
        decan_end: window.end,
        send_at: window.sendAt,
        next_attempt_at: window.sendAt,
        decan_name: window.decanName,
        decan_theme: window.decanTheme,
        decan_context_key: window.decanContextKey,
        status: "pending",
      }))
    );
    const existingRows = await fetchExistingSchedules(
      client,
      users.map((user) => user.id),
      Array.from(new Set(rows.map((row) => row.decan_start))),
    );
    const existingByKey = new Map(
      existingRows.map((row) => [`${row.user_id}::${row.decan_start}`, row]),
    );
    const inserts = rows.filter((row) =>
      !existingByKey.has(`${row.user_id}::${row.decan_start}`)
    );

    if (inserts.length) {
      const { error } = await client
        .from("decan_reflection_schedule")
        .upsert(inserts, {
          onConflict: "user_id,decan_start",
          ignoreDuplicates: true,
        });
      if (error) {
        throw new Error(`Schedule seed error: ${errorMessage(error)}`);
      }
      totals.inserted += inserts.length;
    }

    for (const { userId, windows } of userWindows) {
      for (let index = 0; index < windows.length; index += 1) {
        const window = windows[index];
        const existing = existingByKey.get(`${userId}::${window.start}`);
        if (!existing) continue;
        const desiredFields = {
          decan_end: window.end,
          send_at: window.sendAt,
          next_attempt_at: window.sendAt,
          decan_name: window.decanName,
          decan_theme: window.decanTheme,
          decan_context_key: window.decanContextKey,
        };

        if (
          existing.status === "pending" &&
          !timestampsEqualAtSchedulerPrecision(existing.send_at, window.sendAt)
        ) {
          await updateSchedule(client, existing.id, desiredFields);
          totals.updated += 1;
          continue;
        }

        const shouldMakeGood = index === 0 &&
          ["sent", "failed", "no_push_token"].includes(existing.status) &&
          new Date(existing.send_at).getTime() <
            new Date(window.sendAt).getTime() &&
          params.now.getTime() >= new Date(window.sendAt).getTime() &&
          (!existing.sent_at ||
            new Date(existing.sent_at).getTime() <
              new Date(window.sendAt).getTime());
        if (shouldMakeGood) {
          await updateSchedule(client, existing.id, {
            ...desiredFields,
            status: "pending",
            claimed_at: null,
            claim_token: null,
            sent_at: null,
            last_error: null,
            attempt_count: 0,
            last_attempt_at: null,
          });
          totals.made_good += 1;
        }
      }
    }

    if (users.length < batchSize) break;
    from += batchSize;
  }

  return totals;
}
