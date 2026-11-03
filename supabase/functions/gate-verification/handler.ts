import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { z } from "npm:zod@4.1.12";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["verify", "OUT", "IN"]), pass_id: z.string().uuid(), token: z.string().regex(/^[0-9a-fA-F]{64}$/), location: z.string().trim().max(100).optional(), remarks: z.string().trim().max(500).optional(), idempotency_key: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal("manual_override"), student_id: z.string().uuid(), leave_request_id: z.string().uuid(), event_type: z.enum(["exit", "entry"]), override_reason: z.string().trim().min(5).max(500), location: z.string().trim().max(100).optional() }).strict(),
]);

export function createGateHandler(
  clientFactory: () => SupabaseClient = () => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Supabase Edge Function secrets are missing.");
    return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  },
) {
  return async (req: Request) => {
    const appOrigin = Deno.env.get("APP_ORIGIN") || "";
    const requestOrigin = req.headers.get("origin");
    const headers = {
      "Access-Control-Allow-Origin": appOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
      Vary: "Origin",
    };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

    let configuredOrigin = false;
    try {
      const parsed = new URL(appOrigin);
      configuredOrigin = parsed.origin === appOrigin && ["https:", "http:"].includes(parsed.protocol);
    } catch { /* Deployment configuration is checked below. */ }
    if (!configuredOrigin) return json(503, { error: "APP_ORIGIN must be the exact app origin." });
    if (requestOrigin && requestOrigin !== appOrigin) return json(403, { error: "Origin not allowed." });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return json(405, { error: "POST required." });

    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "Sign in with a security guard account." });
    const requestApiKey = req.headers.get("apikey");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!requestApiKey || !supabaseUrl) return json(401, { error: "A valid signed-in session is required." });

    try {
      const client = clientFactory();
      // Validate the session with the request's public key; use the service
      // client only for the role lookup and transactional gate RPCs.
      const authClient = createClient(supabaseUrl, requestApiKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: { user }, error: authError } = await authClient.auth.getUser(jwt);
      if (authError || !user) return json(401, { error: "Invalid session." });

      const { data: guard, error: guardError } = await client
        .from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
      const raw = await req.text();
      if (raw.length > 4096) return json(413, { error: "Request too large." });
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return json(400, { error: "Invalid JSON request." }); }
      const validation = requestSchema.safeParse(parsed);
      if (!validation.success) return json(400, { error: "Invalid gate verification request." });
      const input = validation.data;
      const requiredRole = input.action === "manual_override" ? "admin" : "security_guard";
      if (guardError || guard?.role !== requiredRole || !guard.is_active)
        return json(403, { error: requiredRole === "admin" ? "Administrator access required." : "Active security guard access required." });

      if (input.action === "manual_override") {
        const { data, error } = await client.rpc("record_gate_override", {
          p_admin_id: user.id,
          p_student_id: input.student_id,
          p_leave_request_id: input.leave_request_id,
          p_event_type: input.event_type,
          p_reason: input.override_reason,
          p_location: input.location || "Main Gate",
        });
        if (error) return json(422, { error: error.message || "Administrative movement could not be recorded." });
        return json(200, data);
      }

      const { data, error } = await client.rpc("record_gate_movement", {
        p_guard_id: user.id,
        p_pass_id: input.pass_id,
        p_token: input.token.toLowerCase(),
        p_action: input.action === "verify" ? "VERIFY" : input.action,
        p_location: input.location || "Main Gate",
        p_remarks: input.remarks || null,
        p_idempotency_key: input.action === "verify" ? null : input.idempotency_key || crypto.randomUUID(),
      });
      if (error) return json(422, { error: error.message || "Gate pass validation failed." });

      if (input.action === "verify" && data?.photo_path) {
        const { data: signed, error: imageError } = await client.storage
          .from("student-avatars").createSignedUrl(data.photo_path, 300);
        data.photo_url = imageError ? null : signed?.signedUrl || null;
        delete data.photo_path;
      }
      return json(200, data);
    } catch (error) {
      console.error("Gate verification failure", error);
      return json(500, { error: "Gate verification is temporarily unavailable." });
    }
  };
}
