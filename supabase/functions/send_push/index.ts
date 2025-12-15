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

type SendRequest = {
  userIds?: string[];
  topic?: string;
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
};

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROJECT_ID = Deno.env.get("FCM_PROJECT_ID")!;
const SA_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!;
const BATCH_SIZE = parseInt(Deno.env.get("BATCH_SIZE") ?? "400", 10);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

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
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

async function fetchTokens(userIds: string[]): Promise<{ device_id: string; token: string }[]> {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from("push_tokens")
    .select("device_id, token")
    .in("user_id", userIds);
  if (error) throw error;
  return data as any[];
}

async function deleteTokens(deviceIds: string[]) {
  if (!deviceIds.length) return;
  await supabase.from("push_tokens").delete().in("device_id", deviceIds);
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sendToFCM(tokens: string[], payload: SendRequest, accessToken: string) {
  const results: { ok: boolean; token?: string; error?: string }[] = [];
  for (const token of tokens) {
    const message = {
      token,
      notification: payload.notification,
      data: payload.data,
    };
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const err = await res.text();
      results.push({ ok: false, token, error: err });
    } else {
      results.push({ ok: true, token });
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    const body = (await req.json()) as SendRequest;
    const sa = JSON.parse(SA_JSON) as ServiceAccount;
    const accessToken = await getAccessToken(sa);

    let targets: string[] = [];
    let deviceIds: string[] = [];
    if (body.userIds?.length) {
      const rows = await fetchTokens(body.userIds);
      targets = rows.map((r) => r.token);
      deviceIds = rows.map((r) => r.device_id);
    } else if (body.topic) {
      return new Response("Topic send not implemented in scaffold", { status: 400 });
    } else {
      return new Response("No userIds or topic provided", { status: 400 });
    }

    const results = await sendToFCM(targets, body, accessToken);
    const staleTokens = results.filter((r) => !r.ok && r.token).map((r) => r.token!);
    const staleDeviceIds = deviceIds.filter((_, idx) => staleTokens.includes(targets[idx]));
    await deleteTokens(staleDeviceIds);

    return new Response(
      JSON.stringify({
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
