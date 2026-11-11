type ActiveMaatUsersClient = {
  // Supabase RPC returns a thenable builder in production and a Promise in
  // tests, so keep this dependency deliberately narrow.
  // deno-lint-ignore no-explicit-any
  rpc?: (name: string, args: Record<string, unknown>) => any;
  from?: (table: string) => unknown;
};

type ActiveMaatUserRow = {
  user_id?: string | null;
};

function errorMessage(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

export async function listActiveMaatUserIds(
  client: ActiveMaatUsersClient,
  now: Date,
  lookbackDays = 30,
) {
  const boundedDays = Math.max(1, Math.min(90, Math.floor(lookbackDays)));
  const since = new Date(
    now.getTime() - boundedDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  if (typeof client.rpc !== "function") {
    throw new Error("Active Ma'at user lookup RPC is unavailable");
  }
  const { data, error } = await client.rpc("active_maat_user_ids", {
    p_since: since,
  });
  if (error) {
    throw new Error(`Active Ma'at user lookup failed: ${errorMessage(error)}`);
  }

  return [
    ...new Set(
      ((data ?? []) as ActiveMaatUserRow[])
        .map((row) => row.user_id?.trim() ?? "")
        .filter(Boolean),
    ),
  ].sort();
}
