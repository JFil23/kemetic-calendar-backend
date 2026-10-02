// Fresh provider adapter. It issues only read requests to Calendar; OAuth token
// exchange/revocation are the only provider POST operations.
export type Lane = "staging" | "production";
export type Json = Record<string, unknown>;
export class CalendarError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly retryable = false,
  ) {
    super(code);
  }
}
export class Deadline {
  private readonly expires: number;
  constructor(readonly duration = 90000, private readonly clock = Date.now) {
    this.expires = clock() + duration;
  }
  remaining() {
    const ms = this.expires - this.clock();
    if (ms <= 0) throw new CalendarError("timeout", 504, true);
    return ms;
  }
  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    perRequest = 10000,
  ): Promise<T> {
    const budget = Math.min(this.remaining(), perRequest);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new CalendarError("timeout", 504, true));
          }, budget);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  callback: string;
  origin: string;
};
export type Credentials = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
export type Source = {
  id: string;
  provider_calendar_id: string;
  label: string;
  color: string | null;
};
export type Projection = {
  provider_event_id: string;
  recurrence_id: string | null;
  title: string;
  detail: string | null;
  location: string | null;
  all_day: boolean;
  starts_at: string;
  ends_at: string;
  start_date: string | null;
  end_date: string | null;
};
export const asRecord = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const string = (v: unknown): string => typeof v === "string" ? v : "";
const text = (v: unknown, limit: number): string | null => {
  if (typeof v !== "string") return null;
  if (v.length > limit) {
    throw new CalendarError("provider_response_limit", 502, true);
  }
  return v;
};
const base64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));
const bytes = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
export const randomToken = () =>
  base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
export async function hash(value: string) {
  return base64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export class CredentialCipher {
  private readonly key: Promise<CryptoKey>;
  constructor(encoded: string) {
    const raw = bytes(encoded);
    if (raw.length !== 32) throw new CalendarError("not_configured", 503);
    this.key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
  async seal(value: unknown, accountLane: string): Promise<Json> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(accountLane),
      },
      await this.key,
      new TextEncoder().encode(JSON.stringify(value)),
    );
    return { v: 1, iv: base64(iv), data: base64(new Uint8Array(ciphertext)) };
  }
  async open<T>(envelope: Json, accountLane: string): Promise<T> {
    try {
      if (envelope.v !== 1) throw new Error();
      const plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes(string(envelope.iv)),
          additionalData: new TextEncoder().encode(accountLane),
        },
        await this.key,
        bytes(string(envelope.data)),
      );
      return JSON.parse(new TextDecoder().decode(plain)) as T;
    } catch {
      throw new CalendarError("credentials_unavailable", 503);
    }
  }
}
export function requestedWindow(body: Json, now = new Date()) {
  const day = 86400000;
  const defaultStart = now.getTime() - 30 * day;
  const defaultEnd = now.getTime() + 180 * day;
  const start = body.start == null
    ? defaultStart
    : Date.parse(string(body.start));
  const end = body.end == null ? defaultEnd : Date.parse(string(body.end));
  if (
    !Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
    end - start > 730 * day
  ) throw new CalendarError("invalid_window");
  // Refresh exactly an explicitly requested visible range; background work owns
  // the ordinary 30-day past / 180-day future window independently.
  const timeZone = string(body.time_zone) || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(now);
  } catch {
    throw new CalendarError("invalid_time_zone");
  }
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    time_zone: timeZone,
  };
}
function dateOnly(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const stamp = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(stamp) && new Date(stamp).toISOString().startsWith(v)
    ? v
    : null;
}
export function projectEvent(raw: unknown): Projection | null {
  const e = asRecord(raw);
  if (e.status === "cancelled") return null;
  const id = string(e.id);
  const start = asRecord(e.start), end = asRecord(e.end);
  const startDate = dateOnly(start.date), endDate = dateOnly(end.date);
  const allDay = startDate !== null;
  const begins = allDay ? startDate + "T00:00:00.000Z" : string(start.dateTime);
  const finishes = allDay && endDate
    ? endDate + "T00:00:00.000Z"
    : string(end.dateTime);
  if (
    !id || id.length > 2048 || (allDay && !endDate) ||
    !Number.isFinite(Date.parse(begins)) ||
    !Number.isFinite(Date.parse(finishes)) ||
    Date.parse(finishes) <= Date.parse(begins)
  ) throw new CalendarError("invalid_provider_event", 502, true);
  const original = asRecord(e.originalStartTime);
  const recurring = string(e.recurringEventId);
  return {
    provider_event_id: id,
    recurrence_id: recurring
      ? recurring + ":" + (string(original.dateTime) || string(original.date))
      : null,
    title: text(e.summary, 2000) || "Busy",
    detail: text(e.description, 20000),
    location: text(e.location, 4000),
    all_day: allDay,
    starts_at: new Date(begins).toISOString(),
    ends_at: new Date(finishes).toISOString(),
    start_date: startDate,
    end_date: allDay ? endDate : null,
  };
}
export class GoogleCalendar {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private json(
    url: string,
    init: RequestInit,
    deadline: Deadline,
  ): Promise<Json> {
    return deadline.run(async (signal) => {
      const response = await this.fetcher(url, { ...init, signal });
      // Provider content is untrusted and may include very large descriptions.
      // Bound bytes as well as pages/counts before parsing or retaining content.
      const reader = response.body?.getReader(), decoder = new TextDecoder();
      let raw = "", bytesRead = 0;
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytesRead += chunk.value.byteLength;
            if (bytesRead > 8 * 1024 * 1024) {
              await reader.cancel();
              throw new CalendarError("provider_response_limit", 502, true);
            }
            raw += decoder.decode(chunk.value, { stream: true });
          }
          raw += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }
      let data: Json;
      try {
        data = asRecord(JSON.parse(raw));
      } catch {
        if (response.ok) {
          throw new CalendarError("invalid_provider_response", 502, true);
        }
        data = {};
      }
      if (!response.ok) {
        const error = asRecord(data.error);
        const errors = Array.isArray(error.errors) ? error.errors : [];
        const reason = string(asRecord(errors[0]).reason);
        if (data.error === "invalid_grant" || response.status === 401) {
          throw new CalendarError("reconnect_required", 409);
        }
        if (
          response.status === 429 || reason === "rateLimitExceeded" ||
          reason === "userRateLimitExceeded"
        ) throw new CalendarError("rate_limited", 429, true);
        if (response.status >= 500) {
          throw new CalendarError("provider_unavailable", 502, true);
        }
        if (response.status === 403) {
          throw new CalendarError("calendar_access_denied", 403);
        }
        if (response.status === 404) {
          throw new CalendarError("calendar_unavailable", 404);
        }
        throw new CalendarError("provider_request_failed", 502, true);
      }
      return data;
    });
  }
  authorizationUrl(config: GoogleConfig, state: string, challenge: string) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callback,
      response_type: "code",
      scope: SCOPES.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent select_account",
    }).toString();
    return url.toString();
  }
  async exchange(
    config: GoogleConfig,
    code: string,
    verifier: string,
    deadline: Deadline,
  ): Promise<Credentials> {
    const result = await this.json("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.callback,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
      }),
    }, deadline);
    if (
      !Number.isFinite(Number(result.expires_in)) ||
      Number(result.expires_in) <= 0
    ) throw new CalendarError("invalid_provider_response", 502, true);
    const granted = new Set(string(result.scope).split(" "));
    if (
      !SCOPES.filter((s) => s.startsWith("https://")).every((s) =>
        granted.has(s)
      )
    ) throw new CalendarError("calendar_access_denied", 403);
    if (!string(result.access_token) || !string(result.refresh_token)) {
      throw new CalendarError("reconnect_required", 409);
    }
    return {
      access_token: string(result.access_token),
      refresh_token: string(result.refresh_token),
      expires_at: Date.now() + Number(result.expires_in) * 1000,
    };
  }
  async identity(accessToken: string, deadline: Deadline) {
    const info = await this.json(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: "Bearer " + accessToken } },
      deadline,
    );
    if (!string(info.sub)) {
      throw new CalendarError("invalid_provider_identity", 502);
    }
    return {
      provider_subject: string(info.sub),
      account_label: string(info.email) || "Google Calendar",
    };
  }
  async refresh(
    config: GoogleConfig,
    previous: Credentials,
    deadline: Deadline,
  ): Promise<Credentials> {
    if (previous.expires_at > Date.now() + 60000) return previous;
    const result = await this.json("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: previous.refresh_token,
      }),
    }, deadline);
    if (
      !string(result.access_token) ||
      !Number.isFinite(Number(result.expires_in))
    ) throw new CalendarError("invalid_provider_response", 502, true);
    return {
      access_token: string(result.access_token),
      refresh_token: string(result.refresh_token) || previous.refresh_token,
      expires_at: Date.now() + Number(result.expires_in) * 1000,
    };
  }
  async sources(accessToken: string, deadline: Deadline) {
    const all: Json[] = [];
    let page = "";
    const seen = new Set<string>();
    do {
      const url = new URL(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      );
      url.search = new URLSearchParams({
        maxResults: "250",
        showHidden: "true",
        minAccessRole: "reader",
        ...(page ? { pageToken: page } : {}),
      }).toString();
      const data = await this.json(url.toString(), {
        headers: { Authorization: "Bearer " + accessToken },
      }, deadline);
      if (!Array.isArray(data.items)) {
        throw new CalendarError("invalid_provider_response", 502, true);
      }
      for (const raw of data.items) {
        const s = asRecord(raw);
        if (s.deleted === true) continue;
        if (!string(s.id)) {
          throw new CalendarError("invalid_provider_response", 502, true);
        }
        all.push({
          provider_calendar_id: string(s.id),
          label: text(s.summaryOverride, 1000) || text(s.summary, 1000) ||
            "Calendar",
          color: /^#[0-9a-f]{6}$/i.test(string(s.backgroundColor))
            ? s.backgroundColor
            : null,
        });
      }
      page = string(data.nextPageToken);
      if ((page && seen.has(page)) || seen.size >= 100 || all.length > 5000) {
        throw new CalendarError("provider_page_limit", 502, true);
      }
      if (page) seen.add(page);
    } while (page);
    if (new Set(all.map((x) => x.provider_calendar_id)).size !== all.length) {
      throw new CalendarError("duplicate_provider_calendar", 502, true);
    }
    return all;
  }
  async snapshot(
    accessToken: string,
    sources: Source[],
    window: { start: string; end: string; time_zone: string },
    deadline: Deadline,
  ) {
    const result: { id: string; events: Projection[] }[] = [];
    let total = 0, totalBytes = 0;
    for (const source of sources) {
      const events: Projection[] = [];
      let page = "";
      const seen = new Set<string>();
      do {
        const url = new URL(
          "https://www.googleapis.com/calendar/v3/calendars/" +
            encodeURIComponent(source.provider_calendar_id) + "/events",
        );
        // Two-day padding makes date-only events unambiguous at offset boundaries.
        url.search = new URLSearchParams({
          singleEvents: "true",
          showDeleted: "false",
          maxResults: "250",
          timeMin: new Date(Date.parse(window.start) - 172800000).toISOString(),
          timeMax: new Date(Date.parse(window.end) + 172800000).toISOString(),
          timeZone: window.time_zone,
          ...(page ? { pageToken: page } : {}),
        }).toString();
        const data = await this.json(url.toString(), {
          headers: { Authorization: "Bearer " + accessToken },
        }, deadline);
        if (!Array.isArray(data.items)) {
          throw new CalendarError("invalid_provider_response", 502, true);
        }
        for (const raw of data.items) {
          const event = projectEvent(raw);
          if (event) {
            events.push(event);
            total++;
            totalBytes +=
              new TextEncoder().encode(JSON.stringify(event)).byteLength;
            if (totalBytes > 20 * 1024 * 1024) {
              throw new CalendarError("provider_response_limit", 502, true);
            }
          }
        }
        page = string(data.nextPageToken);
        if ((page && seen.has(page)) || seen.size >= 100 || total > 50000) {
          throw new CalendarError("provider_page_limit", 502, true);
        }
        if (page) seen.add(page);
      } while (page);
      if (
        new Set(events.map((e) => e.provider_event_id)).size !== events.length
      ) throw new CalendarError("duplicate_occurrence", 502, true);
      result.push({ id: source.id, events });
    }
    return result;
  }
}
