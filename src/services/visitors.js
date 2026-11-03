import { supabase } from "../lib/supabase";

async function call(name, args) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const searchVisitorStudents = (term) =>
  call("visitor_student_search", { p_term: term });

export const listVisitorVisits = (filters = {}) =>
  call("visitor_list", {
    p_search: filters.search || "",
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_status: filters.status || "",
    p_approval: filters.approval || "",
    p_page: filters.page || 0,
    p_page_size: filters.pageSize || 25,
  });

export const registerVisitor = (data) =>
  call("visitor_register", { p_data: data });

export const verifyVisitorIdentity = (id) =>
  call("visitor_verify_identity", { p_visit_id: id });

export const decideVisitorVisit = (id, decision, reason = null) =>
  call("visitor_decide", {
    p_visit_id: id,
    p_decision: decision,
    p_reason: reason,
  });

export const checkInVisitor = (id) =>
  call("visitor_check_in", { p_visit_id: id });

export const checkOutVisitor = (id) =>
  call("visitor_check_out", { p_visit_id: id });

export const markVisitorOverdueReviewed = (id) =>
  call("visitor_mark_overdue_reviewed", { p_visit_id: id });
