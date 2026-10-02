// deno-lint-ignore-file no-import-prefix -- matches the backend pinned URL import convention.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { digest, fetchGoogleSnapshot, ImportError, scopes } from "./google.ts";

const env = (key: string) => Deno.env.get(key) ?? "";
const origins = ["https://kemet-rc.pages.dev", "https://kemet.pages.dev"];
const callbackUrl = () => `${env("SUPABASE_URL")}/functions/v1/calendar_import`;
const configured = () =>
  [
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "CALENDAR_IMPORT_ENCRYPTION_KEY",
  ].every((key) => !!env(key));
type Credentials = {
  refresh_token: string;
  access_token: string;
  expires_at: number;
};
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
async function key() {
  return await crypto.subtle.importKey(
    "raw",
    unb64(env("CALENDAR_IMPORT_ENCRYPTION_KEY")),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
async function seal(value: Credentials) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}
async function unseal(value: string): Promise<Credentials> {
  const [iv, data] = value.split(".");
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await key(),
    unb64(data),
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      ...params,
      client_id: env("GOOGLE_CALENDAR_CLIENT_ID"),
      client_secret: env("GOOGLE_CALENDAR_CLIENT_SECRET"),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new ImportError(
      res.status === 400 ? "reconnect_required" : "provider_unavailable",
    );
  }
  const data = await res.json();
  if (typeof data.access_token !== "string") {
    throw new ImportError("invalid_token_response");
  }
  return data;
}
function requireResult<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new ImportError("storage_unavailable");
  return result.data;
}
export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url), origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && origins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Headers":
          "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      },
    });
  }
  const response = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  if (origin && !origins.includes(origin)) {
    return response({ error: "origin_not_allowed" }, 403);
  }
  const admin = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let failedConnection: { id: string; generation: string } | undefined;
  try {
    if (request.method === "GET") {
      const state = url.searchParams.get("state");
      if (!state || !configured()) {
        return response({ error: "invalid_callback" }, 400);
      }
      // Atomic consume: callback replay cannot reuse the state.
      const record = requireResult(
        await admin.from("calendar_import_oauth_states").delete().eq(
          "state_hash",
          await digest(state),
        ).gt("expires_at", new Date().toISOString()).select().maybeSingle(),
      );
      if (!record || !origins.includes(record.return_origin)) {
        return response({ error: "expired_callback" }, 400);
      }
      let outcome = "reconnect";
      if (!url.searchParams.has("error") && url.searchParams.get("code")) {
        try {
          const data = await tokenRequest({
            grant_type: "authorization_code",
            code: url.searchParams.get("code")!,
            redirect_uri: callbackUrl(),
          });
          const granted = new Set(String(data.scope ?? "").split(" "));
          if (!scopes.every((s) => granted.has(s)) || !data.refresh_token) {
            throw new ImportError("calendar_permission_required");
          }
          const credentials = await seal({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
          });
          const updated = requireResult(
            await admin.from("calendar_import_connections").update({
              credentials,
              connected: true,
              pending_initial_import: true,
              last_import_at: null,
              enabled: false,
              refresh_id: null,
            })
              .eq("id", record.connection_id).eq(
                "generation",
                record.generation,
              ).select("id"),
          );
          if (updated?.length === 1) outcome = "connected";
        } catch { /* OAuth diagnostics never include codes or tokens. */ }
      }
      return new Response(null, {
        status: 303,
        headers: {
          Location:
            `${record.return_origin}/#/settings?calendar_import=${outcome}`,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (request.method !== "POST") {
      return response({ error: "method_not_allowed" }, 405);
    }
    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "");
    const { data: auth, error: authError } = await admin.auth.getUser(
      accessToken,
    );
    if (authError || !auth.user) {
      return response({ error: "auth_required" }, 401);
    }
    const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await request.json(), action = body.action;
    if (action === "status") {
      const status = requireResult(
        await client.rpc("calendar_import_control", {
          p_source_key: "google",
          p_action: "status",
        }),
      );
      return response({ ...status, available: configured() });
    }
    if (action === "connect") {
      if (!configured()) {
        return response({ error: "integration_not_configured" }, 503);
      }
      if (!origin || !origins.includes(origin)) {
        return response({ error: "origin_required" }, 400);
      }
      const status = requireResult(
        await client.rpc("calendar_import_control", {
          p_source_key: "google",
          p_action: "status",
        }),
      );
      const generation = crypto.randomUUID();
      requireResult(
        await admin.from("calendar_import_connections").update({
          generation,
          refresh_id: null,
        }).eq("id", status.id).eq("user_id", auth.user.id),
      );
      const state = b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll(
        "+",
        "-",
      ).replaceAll("/", "_").replaceAll("=", "");
      requireResult(
        await admin.from("calendar_import_oauth_states").delete().eq(
          "connection_id",
          status.id,
        ),
      );
      requireResult(
        await admin.from("calendar_import_oauth_states").insert({
          state_hash: await digest(state),
          connection_id: status.id,
          generation,
          return_origin: origin,
          expires_at: new Date(Date.now() + 600000).toISOString(),
        }),
      );
      const oauth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      oauth.search = new URLSearchParams({
        client_id: env("GOOGLE_CALENDAR_CLIENT_ID"),
        redirect_uri: callbackUrl(),
        response_type: "code",
        scope: scopes.join(" "),
        access_type: "offline",
        prompt: "consent",
        state,
      }).toString();
      return response({ url: oauth.toString() });
    }
    if (["pause", "resume", "disconnect"].includes(action)) {
      return response(
        requireResult(
          await client.rpc("calendar_import_control", {
            p_source_key: "google",
            p_action: action,
          }),
        ),
      );
    }
    if (action !== "import") return response({ error: "invalid_action" }, 400);
    const start = new Date(body.start), end = new Date(body.end);
    if (
      !Number.isFinite(+start) || !Number.isFinite(+end) || end <= start ||
      +end - +start > 63072000000
    ) return response({ error: "invalid_range" }, 400);
    const status = requireResult(
      await client.rpc("calendar_import_control", {
        p_source_key: "google",
        p_action: "begin",
      }),
    );
    if (!body.interactive && !status.enabled) {
      return response({ error: "import_paused" }, 409);
    }
    const connection = requireResult(
      await admin.from("calendar_import_connections").select("credentials").eq(
        "id",
        status.id,
      ).eq("user_id", auth.user.id).eq("generation", status.generation)
        .single(),
    );
    failedConnection = { id: status.id, generation: status.generation };
    if (!connection?.credentials) throw new ImportError("reconnect_required");
    let credentials: Credentials;
    try {
      credentials = await unseal(connection.credentials);
    } catch {
      throw new ImportError("reconnect_required");
    }
    if (credentials.expires_at < Date.now() + 60000) {
      const refreshed = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: credentials.refresh_token,
      });
      credentials = {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? credentials.refresh_token,
        expires_at: Date.now() + Number(refreshed.expires_in ?? 3600) * 1000,
      };
      requireResult(
        await admin.from("calendar_import_connections").update({
          credentials: await seal(credentials),
        }).eq("id", status.id).eq("generation", status.generation),
      );
    }
    const events = await fetchGoogleSnapshot(
      credentials.access_token,
      start.toISOString(),
      end.toISOString(),
    );
    const applied = requireResult(
      await client.rpc("calendar_import_apply", {
        p_connection_id: status.id,
        p_generation: status.generation,
        p_refresh_id: status.refresh_id,
        p_start: start.toISOString(),
        p_end: end.toISOString(),
        p_events: events,
        p_time_zone: body.time_zone ?? "UTC",
      }),
    );
    return response(applied);
  } catch (error) {
    if (
      error instanceof ImportError && error.code === "reconnect_required" &&
      failedConnection
    ) {
      await admin.from("calendar_import_connections").update({
        connected: false,
        enabled: false,
        pending_initial_import: false,
        generation: crypto.randomUUID(),
        refresh_id: null,
        credentials: null,
      })
        .eq("id", failedConnection.id).eq(
          "generation",
          failedConnection.generation,
        );
    }
    return response({
      error: error instanceof ImportError ? error.code : "import_unavailable",
    }, 503);
  }
}
if (import.meta.main) Deno.serve(handler);
