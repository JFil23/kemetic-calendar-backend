// Keep the repository's pinned, functioning Supabase client dependency.
// deno-lint-ignore no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  asRecord,
  CalendarError,
  CredentialCipher,
  type Credentials,
  Deadline,
  GoogleCalendar,
  type GoogleConfig,
  hash,
  type Json,
  type Lane,
  randomToken,
  requestedWindow,
  type Source,
} from "./domain.ts";

export interface CalendarStore {
  authenticate(token: string, signal: AbortSignal): Promise<string | null>;
  call(
    action: string,
    userId: string | null,
    lane: Lane,
    payload: Json,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export type CalendarConfig = {
  lanes: Partial<Record<Lane, GoogleConfig>>;
  cipher: CredentialCipher | null;
  workerSecret: string;
};
type Claim = Json & {
  id: string;
  user_id: string;
  lane: Lane;
  credentials: Json;
  generation: number;
  lease_token: string;
  provider_subject: string;
  sources: Source[];
};
const laneOf = (value: unknown): Lane => {
  if (value !== "staging" && value !== "production") {
    throw new CalendarError("invalid_lane");
  }
  return value;
};
const knownDatabaseErrors = new Set([
  "invalid_lane",
  "invalid_oauth_state",
  "missing_account",
  "stale_attempt",
  "account_mismatch",
  "not_connected",
  "invalid_sources",
  "reconnect_required",
  "paused",
  "sync_busy",
  "incomplete_snapshot",
  "duplicate_occurrence",
  "invalid_device",
  "device_owner_conflict",
  "source_unavailable",
]);
function safeError(error: unknown) {
  if (error instanceof CalendarError) return error;
  const message = asRecord(error).message;
  if (typeof message === "string" && knownDatabaseErrors.has(message)) {
    return new CalendarError(
      message,
      [
          "sync_busy",
          "stale_attempt",
          "account_mismatch",
          "not_connected",
          "reconnect_required",
          "paused",
          "device_owner_conflict",
        ].includes(message)
        ? 409
        : 400,
      message === "sync_busy" || message === "stale_attempt",
    );
  }
  return new CalendarError("service_unavailable", 503, true);
}
function constantEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let different = 0;
  for (let i = 0; i < left.length; i++) {
    different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return different === 0;
}
export function createExternalCalendarHandler(
  options: {
    store: CalendarStore;
    config: CalendarConfig;
    google?: GoogleCalendar;
    now?: () => Date;
    deadlineMs?: number;
  },
) {
  const { store, config } = options;
  const google = options.google ?? new GoogleCalendar();
  const now = options.now ?? (() => new Date());
  const available = (lane: Lane) =>
    Boolean(config.lanes[lane] && config.cipher);
  const configured = (lane: Lane) => {
    const value = config.lanes[lane];
    if (!value || !config.cipher) {
      throw new CalendarError("not_configured", 503);
    }
    return value;
  };
  const call = async (
    action: string,
    user: string | null,
    lane: Lane,
    payload: Json,
    deadline: Deadline,
  ) => {
    try {
      return await deadline.run((signal) =>
        store.call(action, user, lane, payload, signal)
      );
    } catch (error) {
      throw safeError(error);
    }
  };
  const status = async (user: string, lane: Lane, deadline: Deadline) => ({
    ...asRecord(await call("status", user, lane, {}, deadline)),
    available: available(lane),
  });
  const leaseFields = (claim: Claim) => ({
    generation: claim.generation,
    lease_token: claim.lease_token,
  });
  const credentials = async (claim: Claim, deadline: Deadline) => {
    const binding = claim.user_id + ":" + claim.lane;
    const old = await config.cipher!.open<Credentials>(
      claim.credentials,
      binding,
    );
    const fresh = await google.refresh(configured(claim.lane), old, deadline);
    if (fresh !== old) {
      await call("rotate_credentials", claim.user_id, claim.lane, {
        ...leaseFields(claim),
        credentials: await config.cipher!.seal(fresh, binding),
      }, deadline);
    }
    // Refresh grants must retain the same immutable Google identity.
    const identity = await google.identity(fresh.access_token, deadline);
    if (identity.provider_subject !== claim.provider_subject) {
      throw new CalendarError("account_mismatch", 409);
    }
    return fresh;
  };
  const recordFailure = async (claim: Claim, error: unknown) => {
    const failure = safeError(error);
    // Separate, bounded cleanup is allowed after the operation deadline. The
    // lease/generation fence prevents this late acknowledgement changing newer state.
    try {
      await call("fail", claim.user_id, claim.lane, {
        ...leaseFields(claim),
        error_code: failure.code,
      }, new Deadline(3000));
    } catch {
      /* Lease expiry remains the recovery path if acknowledgement is unavailable. */
    }
    return failure;
  };
  const synchronize = async (
    user: string,
    lane: Lane,
    body: Json,
    deadline: Deadline,
    manual: boolean,
  ) => {
    configured(lane);
    const window = requestedWindow(body, now());
    const claim = await call("claim", user, lane, {
      time_zone: window.time_zone,
      manual,
    }, deadline) as Claim;
    try {
      const fresh = await credentials(claim, deadline);
      const sources = await google.snapshot(
        fresh.access_token,
        claim.sources,
        window,
        deadline,
      );
      deadline.remaining();
      return asRecord(
        await call("apply", user, lane, {
          ...leaseFields(claim),
          ...window,
          sources,
        }, deadline),
      );
    } catch (error) {
      throw await recordFailure(claim, error);
    }
  };
  return async (req: Request): Promise<Response> => {
    const deadline = new Deadline(options.deadlineMs ?? 90000);
    const origin = req.headers.get("origin");
    const laneOrigins = {
      staging: config.lanes.staging?.origin ?? "https://kemet-rc.pages.dev",
      production: config.lanes.production?.origin ?? "https://kemet.pages.dev",
    };
    const permittedOrigins = new Set(Object.values(laneOrigins));
    const cors = {
      ...(origin && permittedOrigins.has(origin)
        ? { "Access-Control-Allow-Origin": origin }
        : {}),
      "Access-Control-Allow-Headers":
        "authorization, apikey, x-client-info, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Cache-Control": "no-store",
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    const redirect = (location: string, _status?: number) =>
      new Response(null, {
        status: 302,
        headers: {
          Location: location,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    const path = new URL(req.url).pathname;
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (path.endsWith("/callback") && req.method === "GET") {
      const url = new URL(req.url);
      let target: GoogleConfig | undefined;
      let callbackLane: Lane = "staging";
      let returnTarget: "web" | "native" = "web";
      const resultLocation = (result: string) =>
        returnTarget === "native"
          ? "maat://calendar-import?lane=" + callbackLane + "&result=" + result
          : target!.origin + "/#/settings?external_calendar=" + result;
      try {
        const state = url.searchParams.get("state") ?? "";
        if (state.length > 200) throw new CalendarError("invalid_oauth_state");
        const lane = laneOf(state.split(".")[0]);
        callbackLane = lane;
        target = configured(lane);
        const request = asRecord(
          await call("consume_oauth", null, lane, {
            state_hash: await hash(state),
          }, deadline),
        );
        const user = String(request.user_id);
        const pending = await config.cipher!.open<
          { verifier: string; return_target?: "web" | "native" }
        >(asRecord(request.envelope), user + ":" + lane);
        returnTarget = pending.return_target === "native" ? "native" : "web";
        if (url.searchParams.has("error")) {
          throw new CalendarError("denied", 403);
        }
        const code = url.searchParams.get("code") ?? "";
        if (!code || code.length > 4096) {
          throw new CalendarError("invalid_oauth_state");
        }
        const token = await google.exchange(
          target,
          code,
          pending.verifier,
          deadline,
        );
        const identity = await google.identity(token.access_token, deadline);
        await call("connect", user, lane, {
          ...identity,
          credentials: await config.cipher!.seal(token, user + ":" + lane),
          expected_connection: request.expected_connection,
          expected_generation: request.expected_generation,
        }, deadline);
        return redirect(
          resultLocation("connected"),
          302,
        );
      } catch (error) {
        const failure = safeError(error);
        if (target) {
          const code = ["denied", "account_mismatch"].includes(failure.code)
            ? failure.code
            : "reconnect_required";
          return redirect(
            resultLocation(code),
            302,
          );
        }
        return json({
          error: { code: "invalid_oauth_state", retryable: false },
        }, 400);
      }
    }
    if (req.method !== "POST") {
      return json(
        { error: { code: "method_not_allowed", retryable: false } },
        405,
      );
    }
    try {
      if (path.endsWith("/worker")) {
        if (
          !constantEqual(
            req.headers.get("x-external-calendar-secret") ?? "",
            config.workerSecret,
          )
        ) throw new CalendarError("unauthorized", 401);
        let completed = 0, failed = 0;
        const byLane: { user_id: string; lane: Lane }[][] = [];
        for (const lane of ["staging", "production"] as const) {
          if (available(lane)) {
            byLane.push(
              await call("due", null, lane, {}, deadline) as {
                user_id: string;
                lane: Lane;
              }[],
            );
          }
        }
        // Interleave lanes before two bounded workers consume the queue. A slow
        // staging account must never starve production (or vice versa).
        const queue: { user_id: string; lane: Lane }[] = [];
        for (let i = 0; i < 5; i++) {
          for (const rows of byLane) if (rows[i]) queue.push(rows[i]);
        }
        let cursor = 0;
        await Promise.all([0, 1].map(async () => {
          while (cursor < queue.length) {
            try {
              if (deadline.remaining() < 10000) break;
            } catch {
              break;
            }
            const account = queue[cursor++];
            try {
              await synchronize(
                account.user_id,
                account.lane,
                {},
                deadline,
                false,
              );
              completed++;
            } catch {
              failed++;
            }
          }
        }));
        try {
          await call("housekeeping", null, "staging", {}, new Deadline(3000));
        } catch { /* Retention can retry next tick. */ }
        return json({ completed, failed });
      }
      const bearer = /^Bearer\s+(.+)$/i.exec(
        req.headers.get("authorization") ?? "",
      )?.[1];
      if (!bearer) throw new CalendarError("unauthorized", 401);
      const user = await deadline.run((signal) =>
        store.authenticate(bearer, signal)
      );
      if (!user) throw new CalendarError("unauthorized", 401);
      const raw = await deadline.run(async () => {
        if (!req.body) return "";
        const reader = req.body.getReader(), decoder = new TextDecoder();
        let size = 0, text = "";
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 20 * 1024 * 1024) {
              await reader.cancel();
              throw new CalendarError("invalid_request");
            }
            text += decoder.decode(chunk.value, { stream: true });
          }
          return text + decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }, 5000);
      if (raw.length > 20 * 1024 * 1024) {
        throw new CalendarError("invalid_request");
      }
      let body: Json;
      try {
        body = asRecord(JSON.parse(raw));
      } catch {
        throw new CalendarError("invalid_request");
      }
      const lane = laneOf(body.lane);

      if (origin && origin !== laneOrigins[lane]) {
        throw new CalendarError("origin_mismatch", 403);
      }
      const action = body.action;
      if (typeof action === "string" && action.startsWith("device_")) {
        if (
          ![
            "device_status",
            "device_connect",
            "device_select_sources",
            "device_snapshot",
            "device_pause",
            "device_resume",
            "device_disconnect",
          ].includes(action)
        ) throw new CalendarError("invalid_action");
        if (
          !["device_snapshot", "device_connect"].includes(action) &&
          raw.length > 16384
        ) {
          throw new CalendarError("invalid_request");
        }
        return json(await call(action, user, lane, body, deadline));
      }
      if (raw.length > 16384) throw new CalendarError("invalid_request");
      if (action === "status") return json(await status(user, lane, deadline));
      if (action === "connect") {
        if (
          body.return_target != null && body.return_target !== "web" &&
          body.return_target !== "native"
        ) throw new CalendarError("invalid_return_target");
        const provider = configured(lane),
          verifier = randomToken(),
          state = lane + "." + randomToken();
        await call("create_oauth", user, lane, {
          state_hash: await hash(state),
          envelope: await config.cipher!.seal({
            verifier,
            return_target: body.return_target ?? "web",
          }, user + ":" + lane),
        }, deadline);
        return json({
          authorization_url: google.authorizationUrl(
            provider,
            state,
            await hash(verifier),
          ),
        });
      }
      if (action === "disconnect") {
        await call("disconnect", user, lane, {
          expected_revision: body.expected_revision,
        }, deadline);
        return json(await status(user, lane, deadline));
      }
      if (
        action === "pause" || action === "resume" || action === "select_sources"
      ) {
        if (
          action === "select_sources" &&
          (!Array.isArray(body.source_ids) || body.source_ids.length > 50 ||
            body.source_ids.some((id) =>
              typeof id !== "string" || !/^[-0-9a-f]{36}$/i.test(id)
            ))
        ) throw new CalendarError("invalid_sources");
        await call(
          action,
          user,
          lane,
          {
            source_ids: body.source_ids,
            expected_revision: body.expected_revision,
          },
          deadline,
        );
        return json(await status(user, lane, deadline));
      }
      if (action === "sources") {
        configured(lane);
        const claim = await call(
          "claim",
          user,
          lane,
          { catalog: true },
          deadline,
        ) as Claim;
        try {
          const fresh = await credentials(claim, deadline);
          const sources = await google.sources(fresh.access_token, deadline);
          await call(
            "sources",
            user,
            lane,
            { ...leaseFields(claim), sources },
            deadline,
          );
        } catch (error) {
          throw await recordFailure(claim, error);
        }
        return json(await status(user, lane, deadline));
      }
      if (action === "refresh") {
        return json({
          ...await synchronize(user, lane, body, deadline, true),
          ...await status(user, lane, deadline),
        });
      }
      throw new CalendarError("invalid_action");
    } catch (error) {
      const failure = safeError(error);
      // Only stable, non-sensitive categories enter logs. No URLs, codes,
      // provider payloads, token values, calendar titles, or account addresses.
      console.warn(
        JSON.stringify({ feature: "external_calendar", error: failure.code }),
      );
      return json({
        error: { code: failure.code, retryable: failure.retryable },
      }, failure.status);
    }
  };
}

export function defaultRuntime() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const store: CalendarStore = {
    async authenticate(token, signal) {
      const response = await fetch(url + "/auth/v1/user", {
        headers: { apikey: key, Authorization: "Bearer " + token },
        signal,
      });
      if (!response.ok) return null;
      const value = asRecord(await response.json());
      return typeof value.id === "string" ? value.id : null;
    },
    async call(action, user, lane, payload, signal) {
      const { data, error } = await client.rpc(
        action.startsWith("device_")
          ? "external_calendar_device_service_v1"
          : "external_calendar_service_v1",
        {
          p_action: action,
          p_user_id: user,
          p_lane: lane,
          p_payload: payload,
        },
      ).abortSignal(signal);
      if (error) throw error;
      return data;
    },
  };
  const lanes: Partial<Record<Lane, GoogleConfig>> = {};
  for (const lane of ["staging", "production"] as const) {
    const prefix = "EXTERNAL_CALENDAR_GOOGLE_" + lane.toUpperCase();
    const clientId = Deno.env.get(prefix + "_CLIENT_ID"),
      clientSecret = Deno.env.get(prefix + "_CLIENT_SECRET");
    if (clientId && clientSecret) {
      lanes[lane] = {
        clientId,
        clientSecret,
        callback: url + "/functions/v1/external_calendar/callback",
        origin: lane === "staging"
          ? "https://kemet-rc.pages.dev"
          : "https://kemet.pages.dev",
      };
    }
  }
  let cipher: CredentialCipher | null = null;
  try {
    const encoded = Deno.env.get("EXTERNAL_CALENDAR_CREDENTIAL_KEY");
    if (encoded) cipher = new CredentialCipher(encoded);
  } catch {
    /* Status reports unavailable without exposing malformed secret material. */
  }
  return {
    store,
    config: {
      lanes,
      cipher,
      workerSecret: Deno.env.get("EXTERNAL_CALENDAR_WORKER_SECRET") ?? "",
    },
  };
}
if (import.meta.main) {
  Deno.serve(createExternalCalendarHandler(defaultRuntime()));
}
