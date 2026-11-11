import { ContractError, parseFullMoonInstrumentRequest } from "./contract.ts";
import { computeFullMoonInstrument } from "./compute.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_BODY_BYTES = 8 * 1024;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function createResolveFullMoonInstrumentHandler(options?: {
  compute?: typeof computeFullMoonInstrument;
}) {
  const compute = options?.compute ?? computeFullMoonInstrument;
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Supabase's gateway verifies this JWT by default. Requiring the header
    // here also fails closed if the handler is ever invoked outside the gateway.
    if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Payload too large" }, 413);
    }

    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ error: "Payload too large" }, 413);
      }
      const parsedJson = JSON.parse(rawBody) as unknown;
      const computationRequest = parseFullMoonInstrumentRequest(parsedJson);
      const result = compute(computationRequest);
      return jsonResponse(result, result.status === "ok" ? 200 : 422);
    } catch (error) {
      if (error instanceof ContractError || error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid payload" }, 400);
      }
      // Coordinate values are deliberately not included in server logging.
      console.error("Full Moon instrument computation failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return jsonResponse({ error: "Computation unavailable" }, 500);
    }
  };
}

if (import.meta.main) {
  Deno.serve(createResolveFullMoonInstrumentHandler());
}
