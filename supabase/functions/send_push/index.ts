// Edge Function: send_push
// Sends FCM HTTP v1 messages to user devices stored in public.push_tokens.
// Environment variables (secrets):
//   PROJECT_URL or SUPABASE_URL
//   SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY
//   FCM_PROJECT_ID
//   FCM_SERVICE_ACCOUNT_JSON (full service account JSON)
// Optional:
//   BATCH_SIZE (default 400)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { SignJWT } from "https://deno.land/x/jose@v4.15.5/index.ts";
import webpush from "https://esm.sh/web-push@3.6.7";
import { recordMaatDeliveryTimingEvent } from "../_shared/maat_delivery_timing.ts";
import { resolveCompiledPackagePushText } from "../_shared/output_compiler.ts";

type SendRequest = {
  userIds?: string[];
  deviceIds?: string[];
  topic?: string;
  notification?: { title?: string; body?: string };
  data?: Record<string, unknown>;
};

type SendResponse = {
  sent: number;
  failed: number;
  stale: number;
  matchedTokens: number;
  delivered: boolean;
  reason?: string;
  failedReasons?: string[];
  deliveryKey?: string;
  pushSource?: string;
  pushBlocked?: boolean;
  pushPackageVersion?: string | null;
  pushCompilerStatus?: string | null;
};

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ??
  Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PROJECT_ID = Deno.env.get("FCM_PROJECT_ID") ?? "";
const SA_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? "";
const WEB_PUSH_PUBLIC_KEY = Deno.env.get("WEB_PUSH_PUBLIC_KEY") ?? "";
const WEB_PUSH_PRIVATE_KEY = Deno.env.get("WEB_PUSH_PRIVATE_KEY") ?? "";
const WEB_PUSH_SUBJECT = Deno.env.get("WEB_PUSH_SUBJECT") ??
  "mailto:push@kemeticcalendar.app";
const BATCH_SIZE = parseInt(Deno.env.get("BATCH_SIZE") ?? "400", 10);
const INTERNAL_FUNCTION_KEY = Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "";
const ANDROID_CHANNEL_ID = "maat.reminders";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origin.length ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-key",
    "Vary": "Origin",
  };
}

function jsonResponse(
  req: Request,
  body: unknown,
  init?: ResponseInit,
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req.headers.get("origin")),
      ...(init?.headers ?? {}),
    },
  });
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  };

  const key = await importPrivateKey(sa.private_key);
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`token exchange failed: ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

async function fetchTokens(userIds: string[]): Promise<PushTargetRow[]> {
  if (!userIds.length) return [];
  try {
    const { data, error } = await supabase
      .from("push_tokens")
      .select("device_id, token, platform")
      .in("user_id", userIds)
      .eq("is_active", true);
    if (error) throw error;
    return data as any[];
  } catch (e) {
    throw new Error(`push_tokens fetch failed: ${serializeError(e)}`);
  }
}

async function deleteTokens(deviceIds: string[]) {
  if (!deviceIds.length) return;
  try {
    await supabase.from("push_tokens").delete().in("device_id", deviceIds);
  } catch (e) {
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        msg: "push_tokens delete failed",
        error: serializeError(e),
      }),
    );
  }
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function classifyFcmFailure(
  bodyText: string,
  status?: number,
): { shouldDelete: boolean; reason: string; raw?: string } {
  try {
    const parsed = JSON.parse(bodyText);
    const err = parsed?.error;
    const status = err?.status as string | undefined; // e.g., "NOT_FOUND"
    const details = Array.isArray(err?.details) ? err.details : [];
    const fcmError = details.find(
      (d: any) =>
        typeof d?.["@type"] === "string" &&
        d["@type"].includes("google.firebase.fcm.v1.FcmError"),
    );
    const errorCode = fcmError?.errorCode as string | undefined; // e.g., "UNREGISTERED"

    const reason = `${status || "UNKNOWN"}/${errorCode || ""}`.trim();
    if (status === "NOT_FOUND" || errorCode === "UNREGISTERED") {
      return { shouldDelete: true, reason };
    }
    return { shouldDelete: false, reason };
  } catch {
    // If it's not JSON, treat it as a transient/unknown error; do not delete.
    return {
      shouldDelete: false,
      reason: `NON_JSON_ERROR${status ? `:${status}` : ""}`,
      raw: bodyText,
    };
  }
}

function normalizeData(
  data?: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!data) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value === null) {
      out[key] = "null";
      continue;
    }
    if (
      typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = String(value);
      continue;
    }
    try {
      out[key] = JSON.stringify(value);
    } catch {
      out[key] = String(value);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function firstString(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function buildAppTargetUrl(data?: Record<string, unknown>) {
  const explicitUrl = firstString(data?.url) ?? firstString(data?.link);
  if (explicitUrl) return explicitUrl;

  const initialDeliveryKey = firstString(data?.delivery_key) ??
    firstString(data?.deliveryKey);
  const kind = firstString(data?.kind) ?? firstString(data?.type) ??
    (initialDeliveryKey?.startsWith("maat_guidance:") ? "maat_guidance" : null);
  if (kind === "maat_guidance") {
    const deliveryId = firstString(data?.delivery_id) ??
      firstString(data?.deliveryId) ??
      firstString(data?.maat_guidance_id) ??
      firstString(data?.maatGuidanceId);
    const deliveryKey = initialDeliveryKey;
    const keyId = deliveryKey?.startsWith("maat_guidance:")
      ? deliveryKey.slice("maat_guidance:".length)
      : null;
    const resolvedDeliveryId = deliveryId ?? keyId;
    if (resolvedDeliveryId) {
      const params = new URLSearchParams({
        push_kind: "maat_guidance",
        delivery_id: resolvedDeliveryId,
      });
      const ctaType = firstString(data?.cta_type) ??
        firstString(data?.ctaType);
      const ctaRef = firstString(data?.cta_ref) ?? firstString(data?.ctaRef);
      if (ctaType) params.set("cta_type", ctaType);
      if (ctaRef) params.set("cta_ref", ctaRef);
      return `/?${params.toString()}`;
    }
  }
  if (kind === "decan_reflection") {
    const reflectionId = firstString(data?.reflectionId) ??
      firstString(data?.reflection_id);
    if (reflectionId) {
      const params = new URLSearchParams({
        push_kind: "decan_reflection",
        reflection_id: reflectionId,
      });
      const ctaType = firstString(data?.cta_type) ??
        firstString(data?.ctaType);
      const ctaRef = firstString(data?.cta_ref) ?? firstString(data?.ctaRef);
      if (ctaType) params.set("cta_type", ctaType);
      if (ctaRef) params.set("cta_ref", ctaRef);
      return `/?${params.toString()}`;
    }
  }

  if (kind === "flow_share") {
    const shareId = firstString(data?.share_id) ??
      firstString(data?.shareId);
    const senderId = firstString(data?.sender_id) ??
      firstString(data?.senderId);
    const params = new URLSearchParams({ push_kind: "flow_share" });
    if (shareId) {
      params.set("share_id", shareId);
    }
    if (senderId) {
      params.set("sender_id", senderId);
    }
    return `/?${params.toString()}`;
  }

  if (kind === "dm") {
    const senderId = firstString(data?.sender_id) ??
      firstString(data?.senderId);
    const shareId = firstString(data?.share_id) ??
      firstString(data?.shareId);
    const params = new URLSearchParams({ push_kind: "dm" });
    if (senderId) {
      params.set("sender_id", senderId);
    }
    if (shareId) {
      params.set("share_id", shareId);
    }
    return `/?${params.toString()}`;
  }

  if (kind === "follow") {
    const senderId = firstString(data?.sender_id) ??
      firstString(data?.senderId);
    const params = new URLSearchParams({ push_kind: "follow" });
    if (senderId) {
      params.set("sender_id", senderId);
    }
    return `/?${params.toString()}`;
  }

  if (kind === "event_invite") {
    const shareId = firstString(data?.share_id) ??
      firstString(data?.shareId);
    const senderId = firstString(data?.sender_id) ??
      firstString(data?.senderId);
    const responseStatus = firstString(data?.response_status) ??
      firstString(data?.responseStatus);
    const params = new URLSearchParams({ push_kind: "event_invite" });
    if (shareId) {
      params.set("share_id", shareId);
    }
    if (senderId) {
      params.set("sender_id", senderId);
    }
    if (responseStatus) {
      params.set("response_status", responseStatus);
    }
    return `/?${params.toString()}`;
  }

  if (kind === "calendar_invite" || kind === "calendar_invite_response") {
    const calendarId = firstString(data?.calendar_id) ??
      firstString(data?.calendarId);
    const notificationId = firstString(data?.notification_id) ??
      firstString(data?.notificationId);
    const params = new URLSearchParams({ push_kind: kind });
    if (calendarId) {
      params.set("calendar_id", calendarId);
    }
    if (notificationId) {
      params.set("notification_id", notificationId);
    }
    return `/?${params.toString()}`;
  }

  if (
    kind === "flow_like" ||
    kind === "flow_comment" ||
    kind === "flow_comment_reply" ||
    kind === "flow_comment_like"
  ) {
    const flowPostId = firstString(data?.flow_post_id) ??
      firstString(data?.flowPostId);
    if (flowPostId) {
      const params = new URLSearchParams({
        push_kind: kind,
        flow_post_id: flowPostId,
      });
      return `/?${params.toString()}`;
    }
  }

  const clientEventId = firstString(data?.client_event_id) ??
    firstString(data?.clientEventId);
  if (clientEventId) {
    const params = new URLSearchParams({
      push_kind: "calendar_event",
      client_event_id: clientEventId,
    });
    return `/?${params.toString()}`;
  }

  return "/";
}

function appendDeliveryTrackingParams(
  url: string,
  data?: Record<string, unknown>,
) {
  const deliveryKey = firstString(data?.delivery_key) ??
    firstString(data?.deliveryKey);
  if (!deliveryKey) return url;

  const deliveryKind = firstString(data?.delivery_kind) ??
    firstString(data?.deliveryKind) ??
    firstString(data?.kind) ??
    firstString(data?.type);
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);

  try {
    const parsed = new URL(url, "https://kemetic.local");
    parsed.searchParams.set("delivery_key", deliveryKey);
    if (deliveryKind) parsed.searchParams.set("delivery_kind", deliveryKind);
    return isAbsolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function enrichPushData(data?: Record<string, unknown>) {
  const base = data ? { ...data } : {};
  if (!firstString(base.kind) && firstString(base.type)) {
    base.kind = firstString(base.type);
  }
  if (!firstString(base.url) && !firstString(base.link)) {
    base.url = buildAppTargetUrl(base);
  }
  if (firstString(base.link)) {
    base.link = appendDeliveryTrackingParams(String(base.link), base);
  }
  if (firstString(base.url)) {
    base.url = appendDeliveryTrackingParams(String(base.url), base);
  }
  return base;
}

type PushTestDeliveryContext = {
  deliveryKey: string;
  userId: string | null;
  scheduledFor: string;
  functionStartedAt: string;
};

function buildPushTestDeliveryContext(
  body: SendRequest,
  requesterUid: string | null,
  functionStartedAt: string,
): PushTestDeliveryContext | null {
  const data = body.data ?? {};
  const kind = firstString(data.kind) ?? firstString(data.type);
  if (kind !== "push_test") return null;
  const deliveryKey = firstString(data.delivery_key) ??
    firstString(data.deliveryKey);
  if (!deliveryKey) return null;
  return {
    deliveryKey,
    userId: requesterUid ?? body.userIds?.[0] ?? null,
    scheduledFor: firstString(data.sent_at) ?? functionStartedAt,
    functionStartedAt,
  };
}

async function recordPushTestDeliveryTiming(
  context: PushTestDeliveryContext | null,
  params: {
    status: "picked" | "sent" | "skipped" | "failed";
    deliveredAt?: string | null;
    skipReason?: string | null;
    errorCode?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  if (!context) return;
  await recordMaatDeliveryTimingEvent(supabase, {
    deliveryKey: context.deliveryKey,
    deliveryKind: "push_test",
    targetTable: "push_tokens",
    targetId: context.deliveryKey,
    userId: context.userId,
    scheduledFor: context.scheduledFor,
    cronPickedAt: params.status === "picked" ? context.functionStartedAt : null,
    functionStartedAt: context.functionStartedAt,
    deliveredAt: params.deliveredAt ?? null,
    cronJobName: "send_push_self_test",
    deliveryAttempt: 1,
    deliveryStatus: params.status,
    skipReason: params.skipReason ?? null,
    errorCode: params.errorCode ?? null,
    metadata: params.metadata ?? {},
  });
}

function normalizeNotification(
  notification?: { title?: string; body?: string },
) {
  const title = firstString(notification?.title) ?? "Kemetic Calendar";
  const body = firstString(notification?.body) ?? "Tap to open in Kemetic.";
  return { title, body };
}

type PushTargetRow = {
  device_id: string;
  token: string;
  platform?: string | null;
};

function isWebPushRow(row: PushTargetRow) {
  if (row.platform === "web_push") {
    return true;
  }
  const token = row.token.trim();
  return token.startsWith("{") && token.includes('"endpoint"');
}

function pushTargetIdentity(row: PushTargetRow) {
  const token = row.token.trim();
  if (isWebPushRow(row)) {
    try {
      const parsed = JSON.parse(token);
      const endpoint = firstString(parsed?.endpoint);
      if (endpoint) {
        return `web:${endpoint}`;
      }
    } catch {
      // Fall back to the raw token blob when subscription parsing fails.
    }
  }
  return `token:${token}`;
}

type PushSendResult = {
  ok: boolean;
  device_id: string;
  token?: string;
  error?: string;
  shouldDelete?: boolean;
  status?: number;
};

async function sendToFCM(
  rows: PushTargetRow[],
  payload: SendRequest,
  accessToken: string,
) {
  const results: PushSendResult[] = [];
  const normalizedData = normalizeData(enrichPushData(payload.data));
  for (const row of rows) {
    const token = row.token;
    const message = {
      token,
      ...(payload.notification ? { notification: payload.notification } : {}),
      ...(normalizedData ? { data: normalizedData } : {}),
      android: {
        priority: "high",
        ...(payload.notification
          ? {
            notification: {
              channel_id: ANDROID_CHANNEL_ID,
              click_action: "FLUTTER_NOTIFICATION_CLICK",
              sound: "default",
            },
          }
          : {}),
      },
      apns: payload.notification
        ? {
          headers: {
            "apns-priority": "10",
          },
          payload: {
            aps: {
              sound: "default",
            },
          },
        }
        : undefined,
      webpush: {
        headers: {
          Urgency: "high",
        },
        notification: payload.notification
          ? {
            icon: "/icons/Icon-192.png",
            badge: "/icons/Icon-maskable-192.png",
            tag: normalizedData?.kind ??
              normalizedData?.type ??
              "kemetic-calendar",
          }
          : undefined,
      },
    };
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      const { shouldDelete, reason } = classifyFcmFailure(err, res.status);
      results.push({
        ok: false,
        device_id: row.device_id,
        token,
        error: `${res.status}:${reason}`,
        shouldDelete,
        status: res.status,
      });
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          msg: "fcm_send_failed",
          status: res.status,
          reason,
          token_suffix: token.slice(-6),
        }),
      );
    } else {
      results.push({ ok: true, device_id: row.device_id, token });
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          msg: "fcm_send_ok",
          token_suffix: token.slice(-6),
        }),
      );
    }
  }
  return results;
}

async function sendToWebPush(rows: PushTargetRow[], payload: SendRequest) {
  const results: PushSendResult[] = [];
  if (!rows.length) return results;

  if (!WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY) {
    return rows.map((row) => ({
      ok: false,
      device_id: row.device_id,
      token: row.token,
      error: "web_push_not_configured",
      shouldDelete: false,
    }));
  }

  webpush.setVapidDetails(
    WEB_PUSH_SUBJECT,
    WEB_PUSH_PUBLIC_KEY,
    WEB_PUSH_PRIVATE_KEY,
  );

  const notification = normalizeNotification(payload.notification);
  const data = enrichPushData(payload.data);
  if (!firstString(data.title)) {
    data.title = notification.title;
  }
  if (!firstString(data.body)) {
    data.body = notification.body;
  }
  const body = JSON.stringify({
    source: "kemetic-webpush",
    notification,
    data,
  });

  for (const row of rows) {
    try {
      const subscription = JSON.parse(row.token);
      await webpush.sendNotification(subscription, body, {
        TTL: 60,
        urgency: "high",
      });
      results.push({ ok: true, device_id: row.device_id, token: row.token });
    } catch (error) {
      const status = Number((error as any)?.statusCode ?? 0) || undefined;
      const reason = (error as any)?.body?.toString?.() ||
        (error as any)?.message?.toString?.() ||
        String(error);
      results.push({
        ok: false,
        device_id: row.device_id,
        token: row.token,
        error: `${status ?? "webpush"}:${reason}`,
        shouldDelete: status === 404 || status === 410,
        status,
      });
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          msg: "web_push_send_failed",
          status,
          reason,
          device_id: row.device_id,
        }),
      );
    }
  }

  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req.headers.get("origin")),
    });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders(req.headers.get("origin")),
    });
  }
  const start = Date.now();
  const log = (msg: string, extra?: Record<string, unknown>) => {
    const base = { at: new Date().toISOString(), msg };
    console.log(JSON.stringify(extra ? { ...base, ...extra } : base));
  };

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      const missing = [];
      if (!SUPABASE_URL) missing.push("SUPABASE_URL/PROJECT_URL");
      if (!SERVICE_ROLE) {
        missing.push("SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY");
      }
      log("missing env", { missing });
      return jsonResponse(req, { error: "Missing env vars", missing }, {
        status: 500,
      });
    }

    const body = (await req.json()) as SendRequest;
    const functionStartedAt = new Date(start).toISOString();
    const internalHeader = req.headers.get("x-internal-key") ?? "";
    const authHeader =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";

    let authMode: "internal_key" | "user_jwt" | "denied" = "denied";
    let requesterUid: string | null = null;

    if (INTERNAL_FUNCTION_KEY && internalHeader === INTERNAL_FUNCTION_KEY) {
      authMode = "internal_key";
    } else if (authHeader) {
      const { data: userRes, error } = await supabase.auth.getUser(authHeader);
      if (!error && userRes?.user?.id) {
        requesterUid = userRes.user.id;
        const senderId = typeof body.data === "object" && body.data !== null
          ? (body.data as Record<string, unknown>)["sender_id"] as
            | string
            | undefined
          : undefined;
        if (senderId && senderId !== requesterUid) {
          log("sender_mismatch", { senderId, requesterUid });
          return jsonResponse(req, { error: "Unauthorized" }, {
            status: 401,
          });
        }
        authMode = "user_jwt";
      }
    }

    if (authMode === "denied") {
      log("unauthorized", {
        hasInternal: !!internalHeader,
        hasAuthHeader: !!authHeader,
        internalConfigured: !!INTERNAL_FUNCTION_KEY,
        internalLen: INTERNAL_FUNCTION_KEY.length || undefined,
      });
      return jsonResponse(req, { error: "Unauthorized" }, {
        status: 401,
      });
    }

    if (authMode === "user_jwt") {
      if (!body.userIds?.length) {
        return jsonResponse(req, { error: "userIds required for user_jwt" }, {
          status: 400,
        });
      }
      if (body.userIds.length > 5) {
        return jsonResponse(req, { error: "Too many recipients" }, {
          status: 400,
        });
      }
      if (body.deviceIds?.length && body.deviceIds.length > 5) {
        return jsonResponse(req, { error: "Too many deviceIds" }, {
          status: 400,
        });
      }
    }

    const pushTestDelivery = buildPushTestDeliveryContext(
      body,
      requesterUid,
      functionStartedAt,
    );
    await recordPushTestDeliveryTiming(pushTestDelivery, {
      status: "picked",
      metadata: {
        auth_mode: authMode,
        device_ids: body.deviceIds ?? [],
      },
    });

    const pushResolution = resolveCompiledPackagePushText({
      payload: body.data,
      legacyPushText: body.notification?.body,
    });
    if (pushResolution.blocked) {
      log("push blocked by compiled package policy", {
        reason: pushResolution.reason,
        push_source: pushResolution.source,
      });
      await recordPushTestDeliveryTiming(pushTestDelivery, {
        status: "skipped",
        deliveredAt: new Date().toISOString(),
        skipReason: pushResolution.reason ?? pushResolution.source,
        metadata: {
          push_source: pushResolution.source,
          package_version: pushResolution.packageVersion,
          compiler_status: pushResolution.compilerStatus,
        },
      });
      return jsonResponse(
        req,
        {
          sent: 0,
          failed: 0,
          stale: 0,
          matchedTokens: 0,
          delivered: false,
          reason: pushResolution.reason ?? pushResolution.source,
          failedReasons: [],
          deliveryKey: pushTestDelivery?.deliveryKey,
          pushSource: pushResolution.source,
          pushBlocked: true,
          pushPackageVersion: pushResolution.packageVersion,
          pushCompilerStatus: pushResolution.compilerStatus,
        } satisfies SendResponse,
        { status: 200 },
      );
    }
    if (pushResolution.text) {
      const notification = normalizeNotification(body.notification);
      body.notification = {
        ...notification,
        body: pushResolution.text,
      };
    }
    body.data = {
      ...(body.data ?? {}),
      push_source: pushResolution.source,
      ...(pushResolution.packageVersion
        ? { compiled_package_version: pushResolution.packageVersion }
        : {}),
      ...(pushResolution.compilerStatus
        ? { compiler_status: pushResolution.compilerStatus }
        : {}),
    };

    log("env", {
      url: SUPABASE_URL,
      serviceRolePresent: SERVICE_ROLE.length > 0,
    });
    console.log(
      JSON.stringify({
        msg: "SEND_PUSH start",
        userIds: body.userIds ?? [],
        authMode,
      }),
    );
    log("request", {
      userIds: body.userIds?.length ?? 0,
      topic: body.topic ?? null,
      hasNotification: !!body.notification,
      hasData: !!body.data,
      authMode,
      requesterUid,
    });

    let targets: PushTargetRow[] = [];
    if (body.userIds?.length) {
      const rows = await fetchTokens(body.userIds);
      const dedupedRows = Array.from(
        new Map(
          rows
            .filter((row) => row.token?.trim())
            .map((row) => [pushTargetIdentity(row), row]),
        ).values(),
      );
      if (body.deviceIds?.length) {
        const allowedDeviceIds = new Set(
          body.deviceIds.map((deviceId) => deviceId.trim()).filter(Boolean),
        );
        targets = dedupedRows.filter((row) =>
          allowedDeviceIds.has(row.device_id)
        );
      } else {
        targets = dedupedRows;
      }
      log("tokens fetched", {
        users: body.userIds.length,
        tokens: targets.length,
      });
      console.log(
        JSON.stringify({
          msg: "SEND_PUSH tokens resolved",
          count: targets.length,
          userIds: body.userIds ?? [],
          deviceIds: body.deviceIds ?? [],
          authMode,
        }),
      );
    } else if (body.topic) {
      return new Response("Topic send not implemented in scaffold", {
        status: 400,
        headers: corsHeaders(req.headers.get("origin")),
      });
    } else {
      return new Response("No userIds or topic provided", {
        status: 400,
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (!targets.length) {
      log("no tokens found for users");
      await recordPushTestDeliveryTiming(pushTestDelivery, {
        status: "skipped",
        deliveredAt: new Date().toISOString(),
        skipReason: "no_tokens_for_recipients",
        metadata: {
          matched_tokens: 0,
        },
      });
      return jsonResponse(
        req,
        {
          sent: 0,
          failed: 0,
          stale: 0,
          matchedTokens: 0,
          delivered: false,
          reason: "no_tokens_for_recipients",
          failedReasons: [],
          deliveryKey: pushTestDelivery?.deliveryKey,
          pushSource: pushResolution.source,
          pushPackageVersion: pushResolution.packageVersion,
          pushCompilerStatus: pushResolution.compilerStatus,
        } satisfies SendResponse,
        { status: 200 },
      );
    }

    const fcmTargets = targets.filter((row) => !isWebPushRow(row));
    const webPushTargets = targets.filter((row) => isWebPushRow(row));
    let results: PushSendResult[] = [];

    if (fcmTargets.length) {
      if (!PROJECT_ID || !SA_JSON) {
        results = results.concat(
          fcmTargets.map((row) => ({
            ok: false,
            device_id: row.device_id,
            token: row.token,
            error: "fcm_not_configured",
          })),
        );
      } else {
        let sa: ServiceAccount;
        try {
          sa = JSON.parse(SA_JSON) as ServiceAccount;
        } catch (e) {
          log("bad service account json", { error: String(e) });
          return jsonResponse(req, {
            error: "Invalid FCM_SERVICE_ACCOUNT_JSON",
          }, {
            status: 500,
          });
        }

        const accessToken = await getAccessToken(sa);
        log("access token acquired");
        results = results.concat(
          await sendToFCM(fcmTargets, body, accessToken),
        );
      }
    }

    if (webPushTargets.length) {
      results = results.concat(await sendToWebPush(webPushTargets, body));
    }

    const staleDeviceIds = results
      .filter((r) => r.shouldDelete)
      .map((r) => r.device_id);
    await deleteTokens(staleDeviceIds);

    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const failedReasons = results.filter((r) => !r.ok).map((r) => r.error);
    const reason = sent > 0
      ? undefined
      : failedReasons[0] ?? "push_not_delivered";
    console.log(
      JSON.stringify({
        msg: "SEND_PUSH result",
        success: sent,
        failure: failed,
        authMode,
        token_count: targets.length,
      }),
    );
    log("send finished", {
      sent,
      failed,
      stale: staleDeviceIds.length,
      durationMs: Date.now() - start,
      failedReasons,
    });

    await recordPushTestDeliveryTiming(pushTestDelivery, {
      status: sent > 0 ? "sent" : "failed",
      deliveredAt: new Date().toISOString(),
      errorCode: sent > 0 ? null : "push_not_delivered",
      metadata: {
        matched_tokens: targets.length,
        sent,
        failed,
        stale: staleDeviceIds.length,
        failed_reasons: failedReasons,
        push_source: pushResolution.source,
        package_version: pushResolution.packageVersion,
        compiler_status: pushResolution.compilerStatus,
      },
    });

    return jsonResponse(
      req,
      {
        sent,
        failed,
        stale: staleDeviceIds.length,
        matchedTokens: targets.length,
        delivered: sent > 0,
        reason,
        failedReasons,
        deliveryKey: pushTestDelivery?.deliveryKey,
        pushSource: pushResolution.source,
        pushPackageVersion: pushResolution.packageVersion,
        pushCompilerStatus: pushResolution.compilerStatus,
      } satisfies SendResponse,
      { status: 200 },
    );
  } catch (e) {
    console.error("SEND_PUSH FAILURE FULL", e);
    log("unhandled error", { error: serializeError(e) });
    return jsonResponse(req, { error: serializeError(e) }, {
      status: 500,
    });
  }
});

function serializeError(e: unknown) {
  if (e instanceof Error) {
    return { message: e.message, stack: e.stack };
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
