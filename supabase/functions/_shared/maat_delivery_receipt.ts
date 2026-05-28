export type MaatDeliveryReceiptEventName =
  | "received"
  | "shown"
  | "opened"
  | "dismissed"
  | "acted"
  | "expired";

export type MaatDeliveryReceiptEvent = {
  deliveryKey: string;
  deliveryKind?: string | null;
  userId?: string | null;
  deviceId?: string | null;
  platform?: string | null;
  messageId?: string | null;
  receiptEvent: MaatDeliveryReceiptEventName;
  eventAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

type DeliveryReceiptClient = {
  // Supabase insert returns a thenable query builder; tests can provide a
  // smaller compatible object.
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

const RECEIPT_EVENTS = new Set<string>([
  "received",
  "shown",
  "opened",
  "dismissed",
  "acted",
  "expired",
]);

export function isMaatDeliveryReceiptEventName(
  value: unknown,
): value is MaatDeliveryReceiptEventName {
  return typeof value === "string" && RECEIPT_EVENTS.has(value.trim());
}

export function inferMaatDeliveryKindFromKey(deliveryKey: string) {
  const prefix = deliveryKey.split(":")[0]?.trim();
  if (!prefix) return "unknown";
  if (prefix === "maat_guidance") return "maat_guidance";
  return prefix;
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "");
  }
  return "";
}

function errorMessage(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

export async function recordMaatDeliveryReceiptEvent(
  client: DeliveryReceiptClient,
  event: MaatDeliveryReceiptEvent,
) {
  const deliveryKey = event.deliveryKey.trim();
  if (!deliveryKey || !isMaatDeliveryReceiptEventName(event.receiptEvent)) {
    return { ok: false, duplicate: false, error: "invalid_receipt_event" };
  }

  const row = {
    delivery_key: deliveryKey,
    delivery_kind: event.deliveryKind?.trim() ||
      inferMaatDeliveryKindFromKey(deliveryKey),
    user_id: event.userId ?? null,
    device_id: event.deviceId?.trim() || null,
    platform: event.platform?.trim() || null,
    message_id: event.messageId?.trim() || null,
    receipt_event: event.receiptEvent,
    event_at: event.eventAt ?? new Date().toISOString(),
    metadata: event.metadata ?? {},
  };

  try {
    const table = client.from("maat_delivery_receipt_events");
    if (typeof table?.insert !== "function") {
      return { ok: false, duplicate: false, error: "insert_unavailable" };
    }
    const { error } = await table.insert(row);
    if (error) {
      if (errorCode(error) === "23505") {
        return { ok: true, duplicate: true, error: null };
      }
      console.error(
        JSON.stringify({
          msg: "maat_delivery_receipt_event_insert_failed",
          delivery_key: deliveryKey,
          receipt_event: event.receiptEvent,
          error: errorMessage(error),
        }),
      );
      return { ok: false, duplicate: false, error: errorMessage(error) };
    }
    return { ok: true, duplicate: false, error: null };
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: "maat_delivery_receipt_event_insert_exception",
        delivery_key: deliveryKey,
        receipt_event: event.receiptEvent,
        error: errorMessage(error),
      }),
    );
    return { ok: false, duplicate: false, error: errorMessage(error) };
  }
}
