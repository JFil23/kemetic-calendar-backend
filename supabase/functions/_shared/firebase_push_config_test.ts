import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeFirebasePrivateKey,
  resolveFirebasePushConfig,
} from "./firebase_push_config.ts";

function env(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name];
    },
  };
}

function serviceAccountJson(projectId: string, email = "svc@example.test") {
  return JSON.stringify({
    project_id: projectId,
    client_email: email,
    private_key:
      "-----BEGIN PRIVATE KEY-----\\njson-secret\\n-----END PRIVATE KEY-----\\n",
  });
}

Deno.test("Firebase push config accepts FCM project id and service account JSON", () => {
  const config = resolveFirebasePushConfig(env({
    FCM_PROJECT_ID: "fcm-project",
    FCM_SERVICE_ACCOUNT_JSON: serviceAccountJson("json-project"),
  }));

  assertEquals(config.projectId, "fcm-project");
  assertEquals(config.projectIdSource, "FCM_PROJECT_ID");
  assertEquals(config.authMode, "service_account_json");
  assertEquals(config.serviceAccountSource, "FCM_SERVICE_ACCOUNT_JSON");
  assertEquals(config.serviceAccount?.client_email, "svc@example.test");
});

Deno.test("Firebase push config accepts Firebase project id and service account JSON", () => {
  const config = resolveFirebasePushConfig(env({
    FIREBASE_PROJECT_ID: "firebase-project",
    FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccountJson("json-project"),
  }));

  assertEquals(config.projectId, "firebase-project");
  assertEquals(config.projectIdSource, "FIREBASE_PROJECT_ID");
  assertEquals(config.authMode, "service_account_json");
  assertEquals(config.serviceAccountSource, "FIREBASE_SERVICE_ACCOUNT_JSON");
  assertEquals(config.serviceAccount?.project_id, "json-project");
});

Deno.test("Firebase push config accepts FCM split service account credentials", () => {
  const config = resolveFirebasePushConfig(env({
    FCM_PROJECT_ID: "fcm-project",
    FCM_CLIENT_EMAIL: "fcm@example.test",
    FCM_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\\nfcm-secret\\n-----END PRIVATE KEY-----\\n",
  }));

  assertEquals(config.projectId, "fcm-project");
  assertEquals(config.projectIdSource, "FCM_PROJECT_ID");
  assertEquals(config.authMode, "split_credentials");
  assertEquals(config.serviceAccountSource, "FCM_CLIENT_EMAIL+FCM_PRIVATE_KEY");
  assertEquals(config.serviceAccount?.client_email, "fcm@example.test");
});

Deno.test("Firebase push config accepts Firebase split service account credentials", () => {
  const config = resolveFirebasePushConfig(env({
    FIREBASE_PROJECT_ID: "firebase-project",
    FIREBASE_CLIENT_EMAIL: "firebase@example.test",
    FIREBASE_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\\nfirebase-secret\\n-----END PRIVATE KEY-----\\n",
  }));

  assertEquals(config.projectId, "firebase-project");
  assertEquals(config.projectIdSource, "FIREBASE_PROJECT_ID");
  assertEquals(config.authMode, "split_credentials");
  assertEquals(
    config.serviceAccountSource,
    "FIREBASE_CLIENT_EMAIL+FIREBASE_PRIVATE_KEY",
  );
  assertEquals(config.serviceAccount?.client_email, "firebase@example.test");
});

Deno.test("Firebase push config normalizes escaped newlines in split private keys", () => {
  const raw =
    "-----BEGIN PRIVATE KEY-----\\nline-one\\nline-two\\n-----END PRIVATE KEY-----\\n";
  const config = resolveFirebasePushConfig(env({
    FCM_PROJECT_ID: "fcm-project",
    FCM_CLIENT_EMAIL: "fcm@example.test",
    FCM_PRIVATE_KEY: raw,
  }));

  assertEquals(
    config.serviceAccount?.private_key,
    "-----BEGIN PRIVATE KEY-----\nline-one\nline-two\n-----END PRIVATE KEY-----",
  );
  assertEquals(normalizeFirebasePrivateKey(raw).includes("\\n"), false);
});

Deno.test("Firebase push config prefers FCM names over Firebase fallbacks", () => {
  const config = resolveFirebasePushConfig(env({
    FCM_PROJECT_ID: "fcm-project",
    FIREBASE_PROJECT_ID: "firebase-project",
    FCM_SERVICE_ACCOUNT_JSON: serviceAccountJson(
      "fcm-json-project",
      "fcm-json@example.test",
    ),
    FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccountJson(
      "firebase-json-project",
      "firebase-json@example.test",
    ),
    FCM_CLIENT_EMAIL: "fcm-split@example.test",
    FCM_PRIVATE_KEY: "fcm-split-key",
    FIREBASE_CLIENT_EMAIL: "firebase-split@example.test",
    FIREBASE_PRIVATE_KEY: "firebase-split-key",
  }));

  assertEquals(config.projectId, "fcm-project");
  assertEquals(config.projectIdSource, "FCM_PROJECT_ID");
  assertEquals(config.authMode, "service_account_json");
  assertEquals(config.serviceAccountSource, "FCM_SERVICE_ACCOUNT_JSON");
  assertEquals(config.serviceAccount?.client_email, "fcm-json@example.test");
});

Deno.test("Firebase push config can use project id embedded in JSON", () => {
  const config = resolveFirebasePushConfig(env({
    FCM_SERVICE_ACCOUNT_JSON: serviceAccountJson("json-project"),
  }));

  assertEquals(config.projectId, "json-project");
  assertEquals(
    config.projectIdSource,
    "FCM_SERVICE_ACCOUNT_JSON.project_id",
  );
  assertEquals(config.authMode, "service_account_json");
});
