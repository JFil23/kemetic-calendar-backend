const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupabaseClientLike = {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error?: unknown;
    }>;
  };
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

type AuthUserResponse = {
  id?: string;
};

class RestSelectQuery {
  private filters: Record<string, string> = {};
  private columns = "*";

  constructor(
    private readonly projectUrl: string,
    private readonly serviceRoleKey: string,
    private readonly table: string,
  ) {}

  select(columns = "*") {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters[column] = String(value);
    return this;
  }

  async maybeSingle() {
    const url = new URL(
      `${this.projectUrl.replace(/\/+$/, "")}/rest/v1/${this.table}`,
    );
    url.searchParams.set("select", this.columns);
    url.searchParams.set("limit", "1");
    for (const [column, value] of Object.entries(this.filters)) {
      url.searchParams.set(column, `eq.${value}`);
    }

    const response = await fetch(url, {
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
      },
    });
    if (!response.ok) {
      return {
        data: null,
        error: new Error(
          `${this.table} query failed ${response.status}: ${await response
            .text()}`,
        ),
      };
    }
    const rows = await response.json() as unknown[];
    return { data: rows[0] ?? null, error: null };
  }
}

function createDefaultClient(): SupabaseClientLike {
  const supabaseUrl = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  }
  return {
    auth: {
      getUser: async (token: string) => {
        const response = await fetch(
          `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`,
          {
            headers: {
              apikey: serviceRoleKey,
              authorization: `Bearer ${token}`,
            },
          },
        );
        if (!response.ok) {
          return {
            data: { user: null },
            error: new Error(`auth failed ${response.status}`),
          };
        }
        const user = await response.json() as AuthUserResponse;
        return {
          data: { user: user.id ? { id: user.id } : null },
          error: null,
        };
      },
    },
    from: (table: string) =>
      new RestSelectQuery(supabaseUrl, serviceRoleKey, table),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function trimmedString(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

export function createGetDeliveryReceiptStatusHandler(options?: {
  client?: SupabaseClientLike;
}) {
  const client = options?.client ?? createDefaultClient();

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const authHeader = req.headers.get("authorization");
      const token = authHeader?.replace("Bearer ", "").trim();
      if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser(token);
      if (userError || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const deliveryKey = trimmedString(
        body.delivery_key ?? body.deliveryKey,
      );
      if (!deliveryKey) {
        return jsonResponse({ error: "Invalid payload" }, 400);
      }

      const { data, error } = await client
        .from("maat_delivery_receipt_health")
        .select("*")
        .eq("delivery_key", deliveryKey)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("get_delivery_receipt_status query error", error);
        return jsonResponse({ error: "Query failed" }, 500);
      }

      return jsonResponse({
        ok: true,
        delivery_key: deliveryKey,
        status: data ? "found" : "missing",
        receipt: data ?? null,
      });
    } catch (error) {
      console.error("get_delivery_receipt_status error", error);
      return jsonResponse({ error: "Server error" }, 500);
    }
  };
}

if (import.meta.main) {
  Deno.serve(createGetDeliveryReceiptStatusHandler());
}
