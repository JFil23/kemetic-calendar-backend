export type FirebaseServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
};

export type FirebasePushAuthMode =
  | "service_account_json"
  | "split_credentials"
  | "not_configured";

export type FirebasePushConfig = {
  projectId: string;
  projectIdSource: string | null;
  serviceAccount: FirebaseServiceAccount | null;
  authMode: FirebasePushAuthMode;
  serviceAccountSource: string | null;
};

type EnvReader = {
  get(name: string): string | undefined;
};

const fcmProjectIdSources = ["FCM_PROJECT_ID", "FIREBASE_PROJECT_ID"] as const;
const jsonSources = [
  "FCM_SERVICE_ACCOUNT_JSON",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
] as const;

function envValue(env: EnvReader, name: string): string {
  return env.get(name)?.trim() ?? "";
}

function firstEnv(
  env: EnvReader,
  names: readonly string[],
): { value: string; source: string | null } {
  for (const name of names) {
    const value = envValue(env, name);
    if (value) return { value, source: name };
  }
  return { value: "", source: null };
}

export function normalizeFirebasePrivateKey(value: string): string {
  return value.trim().replace(/\\n/g, "\n").trim();
}

function parseServiceAccountJson(value: string): FirebaseServiceAccount {
  return JSON.parse(value) as FirebaseServiceAccount;
}

function completeSplitPair(
  env: EnvReader,
  prefix: "FCM" | "FIREBASE",
): { serviceAccount: FirebaseServiceAccount; source: string } | null {
  const email = envValue(env, `${prefix}_CLIENT_EMAIL`);
  const privateKey = normalizeFirebasePrivateKey(
    envValue(env, `${prefix}_PRIVATE_KEY`),
  );
  if (!email || !privateKey) return null;
  return {
    serviceAccount: {
      client_email: email,
      private_key: privateKey,
    },
    source: `${prefix}_CLIENT_EMAIL+${prefix}_PRIVATE_KEY`,
  };
}

export function resolveFirebasePushConfig(
  env: EnvReader = Deno.env,
): FirebasePushConfig {
  const json = firstEnv(env, jsonSources);
  const project = firstEnv(env, fcmProjectIdSources);

  if (json.value) {
    const serviceAccount = parseServiceAccountJson(json.value);
    const embeddedProjectId = typeof serviceAccount.project_id === "string"
      ? serviceAccount.project_id.trim()
      : "";
    return {
      projectId: project.value || embeddedProjectId,
      projectIdSource: project.source ||
        (embeddedProjectId ? `${json.source}.project_id` : null),
      serviceAccount,
      authMode: "service_account_json",
      serviceAccountSource: json.source,
    };
  }

  const split = completeSplitPair(env, "FCM") ??
    completeSplitPair(env, "FIREBASE");
  return {
    projectId: project.value,
    projectIdSource: project.source,
    serviceAccount: split?.serviceAccount ?? null,
    authMode: split ? "split_credentials" : "not_configured",
    serviceAccountSource: split?.source ?? null,
  };
}
