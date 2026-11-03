import { supabase } from "../lib/supabase";
import { messComplaintCategories } from "../lib/messValidation";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function loadAdminMess({
  from,
  to,
  menuFrom,
  menuTo,
  mealSlot = "",
  search = "",
}) {
  let menusQuery = supabase
    .from("mess_menus")
    .select(
      "id,meal_date,meal_slot,title,description,items,serving_start,serving_end,status,announcement,published_at,updated_at",
    )
    .gte("meal_date", menuFrom)
    .lte("meal_date", menuTo)
    .order("meal_date", { ascending: true })
    .order("serving_start", { ascending: true });
  if (mealSlot) menusQuery = menusQuery.eq("meal_slot", mealSlot);
  const term = search.trim().slice(0, 100);
  if (term) menusQuery = menusQuery.ilike("title", `%${term}%`);

  const [menus, summary, policy] = await Promise.all([
    menusQuery,
    supabase.rpc("mess_admin_summary", { p_from: from, p_to: to }),
    supabase
      .from("mess_feedback_policy")
      .select("edit_window_hours")
      .eq("singleton", true)
      .single(),
  ]);
  return {
    menus: unwrap(menus) || [],
    summary: unwrap(summary),
    policy: unwrap(policy),
  };
}

export async function loadStudentMess({ from, to, mealSlot = "" }) {
  let menusQuery = supabase
    .from("mess_menus")
    .select(
      "id,meal_date,meal_slot,title,description,items,serving_start,serving_end,status,announcement,published_at,updated_at",
    )
    .gte("meal_date", from)
    .lte("meal_date", to)
    .in("status", ["published", "cancelled"])
    .order("meal_date", { ascending: true })
    .order("serving_start", { ascending: true });
  if (mealSlot) menusQuery = menusQuery.eq("meal_slot", mealSlot);
  const [menus, feedback, notifications, editWindow] = await Promise.all([
    menusQuery,
    supabase
      .from("mess_feedback")
      .select(
        "id,meal_date,meal_slot,rating,category,comments,submitted_at,updated_at",
      )
      .gte("meal_date", from)
      .lte("meal_date", to),
    supabase
      .from("mess_notifications")
      .select("id,menu_id,event_type,title,message,read_at,created_at")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.rpc("mess_feedback_edit_window"),
  ]);
  const noticeRows = unwrap(notifications) || [];
  if (noticeRows.length) {
    const { error } = await supabase
      .from("mess_notifications")
      .update({ read_at: new Date().toISOString() })
      .in(
        "id",
        noticeRows.map((notice) => notice.id),
      );
    if (error) throw error;
  }
  return {
    menus: unwrap(menus) || [],
    feedback: unwrap(feedback) || [],
    notifications: noticeRows,
    editWindowHours: unwrap(editWindow) ?? 0,
  };
}

export const saveMessMenu = (data) =>
  supabase.rpc("mess_save_menu", { p_data: data }).then(unwrap);

export const setMessMenuStatus = (menuId, status, announcement = "") =>
  supabase
    .rpc("mess_set_menu_status", {
      p_menu_id: menuId,
      p_status: status,
      p_announcement: announcement,
    })
    .then(unwrap);

export const setMessFeedbackPolicy = (hours) =>
  supabase
    .rpc("mess_set_feedback_policy", { p_hours: Number(hours) })
    .then(unwrap);

export async function loadWeeklyMessRoutine() {
  const [routine, times] = await Promise.all([
    supabase
      .from("mess_weekly_routine")
      .select("weekday,meal_slot,menu_text,updated_at")
      .order("weekday")
      .order("meal_slot"),
    supabase
      .from("mess_meal_times")
      .select("meal_slot,serving_start,serving_end,updated_at")
      .order("meal_slot"),
  ]);
  return { routine: unwrap(routine) || [], times: unwrap(times) || [] };
}

export const saveWeeklyMessRoutine = ({ routine, times }) =>
  supabase
    .rpc("mess_save_weekly_routine", {
      p_routine: routine,
      p_times: times,
    })
    .then(unwrap);

export const submitMealFeedback = (data) =>
  supabase.rpc("mess_submit_feedback", { p_data: data }).then(unwrap);

export async function submitMessComplaint(data, nonce) {
  const { data: result, error } = await supabase.rpc("complaint_submit", {
    p_data: data,
    p_nonce: nonce,
  });
  if (error) throw error;
  return result;
}

export async function listStudentMessComplaints() {
  const { data, error } = await supabase
    .from("complaints")
    .select("id,complaint_number,title,category,status,created_at,updated_at")
    .in("category", messComplaintCategories)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}
