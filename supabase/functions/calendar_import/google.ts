/** Read-only Google adapter, based on the recovered July 2 PWA importer. */
export const scopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];
export class ImportError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export type ImportedEvent = {
  start_date?: string;
  end_date?: string;
  key: string;
  title: string;
  detail: string | null;
  location: string | null;
  all_day: boolean;
  start: string;
  end: string | null;
};
export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(bytes),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImportError("invalid_provider_data");
  }
  return value as Json;
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
export async function normalize(
  calendarId: string,
  raw: Json,
): Promise<ImportedEvent | null> {
  if (raw.status === "cancelled") return null;
  const start = object(raw.start), end = object(raw.end);
  const allDay = typeof start.date === "string";
  const date = (v: Json): string => {
    const result = allDay ? `${v.date}T00:00:00.000Z` : text(v.dateTime);
    if (!result || !Number.isFinite(Date.parse(result))) {
      throw new ImportError("invalid_provider_date");
    }
    return result;
  };
  const id = text(raw.id);
  if (!id) throw new ImportError("missing_provider_identity");
  const original = raw.originalStartTime ? object(raw.originalStartTime) : null;
  let occurrence = original
    ? text(original.dateTime) ?? text(original.date)
    : null;
  if (original?.dateTime) {
    if (!occurrence || !Number.isFinite(Date.parse(occurrence))) {
      throw new ImportError("invalid_occurrence_identity");
    }
    occurrence = new Date(occurrence).toISOString();
  }
  if (raw.recurringEventId && !occurrence) {
    throw new ImportError("missing_occurrence_identity");
  }
  const identity = raw.recurringEventId
    ? [calendarId, raw.recurringEventId, occurrence]
    : [calendarId, id];
  const detail = text(raw.description);
  // Historical HAw exports must never loop back into imports.
  if (detail?.toLowerCase().includes("kemet_cid:")) return null;
  return {
    key: await digest(JSON.stringify(identity)),
    title: text(raw.summary) ?? "(Untitled event)",
    detail,
    location: text(raw.location),
    ...(allDay
      ? { start_date: String(start.date), end_date: String(end.date) }
      : {}),
    all_day: allDay,
    start: date(start),
    end: date(end),
  };
}
export async function fetchGoogleSnapshot(
  token: string,
  start: string,
  end: string,
  fetcher: typeof fetch = fetch,
): Promise<ImportedEvent[]> {
  async function pages(url: URL): Promise<Json[]> {
    const items: Json[] = [], seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        let missingPermission = false;
        if (response.status === 403) {
          const failure = await response.json().catch(() => null);
          missingPermission = failure?.error?.errors?.some(
            (e: { reason?: string }) => e.reason === "insufficientPermissions",
          ) === true;
        }
        throw new ImportError(
          response.status === 401 || missingPermission
            ? "reconnect_required"
            : "provider_unavailable",
        );
      }
      const data = object(await response.json());
      if (data.items !== undefined && !Array.isArray(data.items)) {
        throw new ImportError("invalid_provider_data");
      }
      items.push(...((data.items ?? []) as unknown[]).map(object));
      const next = text(data.nextPageToken);
      if (!next) return items;
      if (seen.has(next)) throw new ImportError("invalid_provider_pagination");
      seen.add(next);
      url.searchParams.set("pageToken", next);
    }
    throw new ImportError("import_too_large");
  }
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
  );
  url.search = new URLSearchParams({
    showDeleted: "false",
    showHidden: "false",
    minAccessRole: "reader",
  }).toString();
  const calendars = await pages(url), events: ImportedEvent[] = [];
  for (const calendar of calendars) {
    const id = text(calendar.id);
    if (!id) throw new ImportError("missing_calendar_identity");
    const eventUrl = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${
        encodeURIComponent(id)
      }/events`,
    );
    eventUrl.search = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "false",
      timeMin: start,
      timeMax: end,
      maxResults: "2500",
    }).toString();
    for (const raw of await pages(eventUrl)) {
      const event = await normalize(id, raw);
      if (event) events.push(event);
      if (events.length > 20000) throw new ImportError("import_too_large");
    }
  }
  // No partial calendar/page failure is ever turned into a successful snapshot.
  return events;
}
