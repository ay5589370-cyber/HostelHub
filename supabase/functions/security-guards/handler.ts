import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { z } from "npm:zod@4.1.12";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("create"), email: z.email().max(320).transform((v) => v.toLowerCase()), full_name: z.string().trim().min(2).max(100) }).strict(),
  z.object({ action: z.literal("set_active"), guard_id: z.string().uuid(), is_active: z.boolean() }).strict(),
]);

export function createSecurityGuardsHandler(
  clientFactory: () => SupabaseClient = () => {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Supabase Edge Function secrets are missing.");
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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
    let originValid = false;
    try { const parsed = new URL(appOrigin); originValid = parsed.origin === appOrigin && ["https:", "http:"].includes(parsed.protocol); } catch { /* Checked below. */ }
    if (!originValid) return json(503, { error: "APP_ORIGIN must be the exact app origin." });
    if (requestOrigin && requestOrigin !== appOrigin) return json(403, { error: "Origin not allowed." });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return json(405, { error: "POST required." });
    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "Sign in to continue." });

    try {
      const client = clientFactory();
      const { data: { user }, error: authError } = await client.auth.getUser(jwt);
      if (authError || !user) return json(401, { error: "Invalid session." });
      const { data: actor, error: actorError } = await client.from("profiles")
        .select("role,is_active").eq("id", user.id).maybeSingle();
      if (actorError || actor?.role !== "admin" || !actor.is_active)
        return json(403, { error: "Administrator access required." });

      const raw = await req.text();
      if (raw.length > 4096) return json(413, { error: "Request too large." });
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return json(400, { error: "Invalid JSON request." }); }
      const validation = schema.safeParse(body);
      if (!validation.success) return json(400, { error: "Invalid security guard request." });
      const input = validation.data;

      if (input.action === "list") {
        const { data, error } = await client.from("profiles")
          .select("id,full_name,email,is_active,created_at")
          .eq("role", "security_guard").order("created_at", { ascending: false });
        if (error) throw error;
        return json(200, { guards: data || [] });
      }

      if (input.action === "set_active") {
        const { data, error } = await client.from("profiles")
          .update({ is_active: input.is_active }).eq("id", input.guard_id).eq("role", "security_guard")
          .select("id,full_name,email,is_active,created_at").single();
        if (error) return json(404, { error: "Security guard account not found." });
        return json(200, { guard: data });
      }

      const password = Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) => value.toString(16).padStart(2, "0")).join("");
      const { data: created, error: createError } = await client.auth.admin.createUser({
        email: input.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: input.full_name },
      });
      if (createError || !created.user) return json(409, { error: createError?.message || "Unable to create account." });

      const { data: profile, error: profileError } = await client.from("profiles")
        .update({ role: "security_guard", full_name: input.full_name, is_active: true })
        .eq("id", created.user.id).select("id,full_name,email,is_active,created_at").single();
      if (profileError) {
        await client.auth.admin.deleteUser(created.user.id);
        console.error("Security guard profile promotion failed", profileError);
        return json(500, { error: "Could not safely finish guard account creation." });
      }
      return json(201, { guard: profile, temporary_password: password });
    } catch (error) {
      console.error("Security guard management failure", error);
      return json(500, { error: "Security guard management is temporarily unavailable." });
    }
  };
}
