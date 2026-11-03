import { supabase } from "../lib/supabase";
// RLS applies to changes. Enable profiles in the publication only when needed.
export function subscribeToProfiles(onChange, filter) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`profiles:${filter || "admin"}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "profiles",
        ...(filter ? { filter } : {}),
      },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
