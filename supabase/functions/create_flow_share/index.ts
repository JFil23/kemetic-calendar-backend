import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { buildFlowShareSnapshot } from "../_shared/flow_share_snapshot.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sendFlowSharePush({
  authHeader,
  recipientId,
  senderId,
  senderLabel,
  flowName,
  shareId,
}: {
  authHeader: string;
  recipientId: string;
  senderId: string;
  senderLabel: string;
  flowName: string;
  shareId?: string | null;
}) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send_push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        userIds: [recipientId],
        notification: {
          title: `Flow shared by ${senderLabel}`,
          body: flowName.trim() || "Tap to open in Inbox",
        },
        data: {
          type: "flow_share",
          kind: "flow_share",
          sender_id: senderId,
          share_id: shareId ?? undefined,
          share_kind: "flow",
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("create_flow_share: push http error", {
        recipientId,
        senderId,
        status: res.status,
        body: text,
      });
    }
  } catch (error) {
    console.error("create_flow_share: push error", {
      recipientId,
      senderId,
      error,
    });
  }
}

export function createFlowShareHandler({
  userClientFor = (authHeader: string) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    }),
  adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY),
  sendPush = sendFlowSharePush,
} = {}) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        },
      });
    }

    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      const supabaseUser = userClientFor(authHeader);
      const supabaseAdmin = adminClient;
      const { data: auth, error: authError } = await supabaseUser.auth
        .getUser(authHeader.replace(/^Bearer\s+/i, ""));
      const user_id = auth.user?.id;
      if (authError || !user_id) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      const {
        flow_id,
        flow_post_id,
        source_share_id,
        recipients,
        suggested_schedule,
      } = await req.json();

      if (
        (!flow_id && !flow_post_id && !source_share_id) || !recipients ||
        !Array.isArray(recipients) ||
        recipients.length === 0
      ) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      const { data: senderProfile, error: profileError } = await supabaseAdmin
        .from("profiles").select("display_name, handle, timezone")
        .eq("id", user_id).maybeSingle();
      if (profileError) throw profileError;
      const senderLabel = senderProfile?.display_name?.trim() ||
        (senderProfile?.handle
          ? `@${String(senderProfile.handle).trim()}`
          : "Someone");

      let sourceFlowId: number | null;
      let payloadJson: Record<string, unknown>;
      if (source_share_id) {
        const { data: source, error } = await supabaseUser.from("flow_shares")
          .select("flow_id,sender_id,recipient_id,payload_json,deleted_at")
          .eq("id", source_share_id).single();
        if (
          error || !source || source.deleted_at ||
          (source.sender_id !== user_id && source.recipient_id !== user_id) ||
          source.payload_json?.type === "message"
        ) {
          throw new Error("Shared flow is unavailable");
        }
        sourceFlowId = source.flow_id;
        payloadJson = source.payload_json;
      } else if (flow_post_id) {
        // Re-share only the published snapshot the sender can actually read.
        const { data: post, error } = await supabaseUser.from("flow_posts")
          .select(
            "flow_id,name,color,notes,rules,start_date,end_date,is_hidden,ai_metadata",
          )
          .eq("id", flow_post_id).single();
        if (error || !post || post.is_hidden) {
          throw new Error("Flow post is unavailable");
        }
        const snapshot = post.ai_metadata?.payload;
        if (!snapshot || !Array.isArray(snapshot.events)) {
          throw new Error("Flow post has no complete snapshot");
        }
        sourceFlowId = post.flow_id;
        payloadJson = {
          ...snapshot,
          name: post.name,
          color: post.color,
          notes: post.notes,
          rules: post.rules,
          flow_id: sourceFlowId,
          flow_post_id,
          start_date: post.start_date,
          end_date: post.end_date,
        };
      } else {
        const { data: flow, error: flowError } = await supabaseUser.from(
          "flows",
        )
          .select(
            "id,name,color,notes,rules,appearance,start_date,end_date,user_id",
          )
          .eq("id", flow_id).single();
        if (flowError || !flow || flow.user_id !== user_id) {
          return new Response(
            JSON.stringify({ error: "Flow not found or not owned" }),
            {
              status: 403,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        }
        // A failed or truncated read must never become a successful partial share.
        const events: Record<string, unknown>[] = [];
        const pageSize = 500;
        for (let offset = 0;; offset += pageSize) {
          const { data: page, error } = await supabaseUser
            .from("user_event_filing_items_client")
            .select(
              "id,title,detail,location,all_day,starts_at,ends_at,action_id,behavior_payload",
            )
            .eq("filed_flow_id", flow_id)
            .order("starts_at", { ascending: true }).order("id", {
              ascending: true,
            })
            .range(offset, offset + pageSize - 1);
          if (error || !page) {
            throw error ?? new Error("Flow events unavailable");
          }
          events.push(...page);
          if (page.length < pageSize) break;
        }
        sourceFlowId = flow.id;
        payloadJson = buildFlowShareSnapshot(
          flow,
          events,
          senderProfile?.timezone ?? "America/Los_Angeles",
        );
      }

      // 5. Create shares for each recipient with error handling
      const shares: any[] = [];
      const errors: Array<{ recipient: unknown; error: string }> = [];

      for (const recipient of recipients ?? []) {
        try {
          if (recipient.type === "user") {
            // 1️⃣ Try to resolve by userId (preferred)
            let profile = null;
            let profileError = null;

            const byId = await supabaseAdmin
              .from("profiles")
              .select("id, email")
              .eq("id", recipient.value)
              .maybeSingle();

            profile = byId.data;
            profileError = byId.error;

            // 2️⃣ If not found AND no error, fallback to treating value as handle
            if (!profile && !profileError) {
              const byHandle = await supabaseAdmin
                .from("profiles")
                .select("id, email")
                .eq("handle", recipient.value)
                .maybeSingle();

              profile = byHandle.data;
              profileError = byHandle.error;
            }

            if (profileError || !profile || !profile.id) {
              console.error(
                "create_flow_share: failed to resolve user recipient",
                {
                  value: recipient.value,
                  profileError,
                },
              );
              errors.push({
                recipient: recipient.value,
                error: "USER_NOT_FOUND",
              });
              continue;
            }

            const recipientId = profile.id as string;
            const recipientEmail = (profile.email ?? null) as string | null;

            const { data: inserted, error: insertError } = await supabaseUser
              .from("flow_shares")
              .insert({
                flow_id: sourceFlowId,
                sender_id: user_id,
                recipient_id: recipientId,
                // recipient_email removed - not in schema cache
                channel: "in_app",
                suggested_schedule: suggested_schedule || null,
                payload_json: payloadJson,
                status: "sent",
              })
              .select("id, status")
              .single();

            if (insertError || !inserted) {
              console.error("create_flow_share: insert error", insertError);
              errors.push({
                recipient: recipient.value,
                error: "INSERT_FAILED",
              });
              continue;
            }

            shares.push(inserted);
            await sendPush({
              authHeader,
              recipientId,
              senderId: user_id,
              senderLabel,
              flowName: String(payloadJson.name ?? "").trim(),
              shareId: inserted.id as string | undefined,
            });
            continue;
          }

          if (recipient.type === "email") {
            const email = String(recipient.value);
            const { data: inserted, error: insertError } = await supabaseUser
              .from("flow_shares")
              .insert({
                flow_id: sourceFlowId,
                sender_id: user_id,
                recipient_id: null,
                // recipient_email removed - email-only shares not supported in current inbox views
                channel: "email",
                suggested_schedule: suggested_schedule || null,
                payload_json: payloadJson,
                status: "sent",
              })
              .select("id, status")
              .single();

            if (insertError || !inserted) {
              console.error(
                "create_flow_share: email insert error",
                insertError,
              );
              errors.push({
                recipient: email,
                error: "INSERT_FAILED",
              });
              continue;
            }

            shares.push(inserted);
            continue;
          }

          // Unknown recipient type
          errors.push({
            recipient: recipient?.value ?? null,
            error: "UNKNOWN_RECIPIENT_TYPE",
          });
        } catch (err) {
          console.error("create_flow_share: unexpected error for recipient", {
            recipient,
            err,
          });
          errors.push({
            recipient: recipient?.value ?? null,
            error: "UNEXPECTED_ERROR",
          });
          continue;
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          shares,
          errors: errors.length > 0 ? errors : undefined,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  };
}

if (import.meta.main) serve(createFlowShareHandler());
