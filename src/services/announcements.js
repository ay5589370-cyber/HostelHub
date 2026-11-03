import { supabase } from "../lib/supabase";

export async function listAnnouncements({ page = 0, pageSize = 20 } = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("hostel_announcement_list", {
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw error;
  return data;
}

export async function saveAnnouncement({ id = null, title, body, action }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("hostel_announcement_save", {
    p_id: id,
    p_title: title,
    p_body: body,
    p_action: action,
  });
  if (error) throw error;
  return data;
}
