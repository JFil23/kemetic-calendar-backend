import { serve } from "https://deno.land/std@0.168.0/http/server.ts"; import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"; import { jwtDecode } from "https://esm.sh/jwt-decode@4.0.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!; const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing authorization header" }), { status: 401, headers: { "Content-Type": "application/json" } });
    const token = authHeader.replace("Bearer ", ""); const claims: any = jwtDecode(token); const user_id = claims?.sub ?? null;
    if (!user_id) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { "Content-Type": "application/json" } });
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { share_id } = await req.json();
    if (!share_id) return new Response(JSON.stringify({ error: "Missing share_id" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const { data: profile } = await supabase.from("profiles").select("email").eq("id", user_id).single();
    if (!profile?.email) return new Response(JSON.stringify({ error: "User profile not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    const { data: share, error: shareError } = await supabase.from("flow_shares").select("*, ma_at_flows(*)").eq("id", share_id).eq("recipient_email", profile.email).single();
    if (shareError || !share) return new Response(JSON.stringify({ error: "Share not found or not authorized" }), { status: 404, headers: { "Content-Type": "application/json" } });
    const { error: updateError } = await supabase.from("flow_shares").update({ accepted_at: new Date().toISOString() }).eq("id", share_id);
    if (updateError) return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ success: true, flow: share.ma_at_flows }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } }); }
});
