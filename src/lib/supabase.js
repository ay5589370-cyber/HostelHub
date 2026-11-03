import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
let client = null;
export let setupError = "";
try {
  if (!url || !key || url.includes("YOUR_PROJECT"))
    throw new Error("Missing configuration");
  if (!/^https?:$/.test(new URL(url).protocol)) throw new Error("Invalid URL");
  if (key.startsWith("sb_secret_")) throw new Error("Secret key");
  if (
    key.startsWith("eyJ") &&
    JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
      .role === "service_role"
  )
    throw new Error("Secret key");
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
} catch {
  setupError =
    "Connect your Supabase project with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, then restart the development server. Use only an anon or publishable key.";
}
export const supabase = client;
