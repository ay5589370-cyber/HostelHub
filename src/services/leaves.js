import { supabase } from "../lib/supabase";
import { queryResult } from "./profiles";
import { leaveDocumentTypes, validateLeaveFiles } from "../lib/leaveValidation";

const PAGE_SIZE = 20;
const requestSelect = "*,students(id,user_id,full_name,student_id,course,branch,semester,profile_photo_path,bed_allocations!left(status,beds!left(bed_number,rooms!left(room_number,hostels!left(name,block)))))";

export async function submitLeave(values) {
  const { data, error } = await supabase.rpc("submit_leave", { p_data: {
    request_nonce: values.request_nonce || crypto.randomUUID(), leave_type: values.leave_type,
    departure_at: new Date(values.departure_local).toISOString(), expected_return_at: new Date(values.expected_return_local).toISOString(),
    destination: values.destination.trim(), reason: values.reason.trim(), emergency_contact: values.emergency_contact.trim(),
  }});
  if (error) throw error;
  return data;
}
export async function countStudentLeaves() {
  const statuses = ["pending", "approved", "rejected"];
  const queries = [
    supabase.from("leave_requests").select("id", { count: "exact", head: true }),
    ...statuses.map((status) =>
      supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", status),
    ),
  ];
  const results = await Promise.all(queries);
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  return {
    total: results[0].count || 0,
    pending: results[1].count || 0,
    approved: results[2].count || 0,
    rejected: results[3].count || 0,
  };
}
export async function uploadLeaveDocuments(request, files) {
  validateLeaveFiles(files);
  const bucket = supabase.storage.from("leave-documents"); const uploaded = [];
  try { for (const file of files) {
    const path = `${request.student_id}/${request.id}/${crypto.randomUUID()}.${leaveDocumentTypes[file.type]}`;
    const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false }); if (error) throw error;
    uploaded.push(path);
    const { error: metadataError } = await supabase.rpc("register_leave_document", { p_request_id: request.id, p_path: path, p_original_name: file.name, p_content_type: file.type, p_byte_size: file.size });
    if (metadataError) throw metadataError;
  }} catch (error) { if (uploaded.length) await bucket.remove(uploaded); throw error; }
}
export async function listStudentLeaves({ status = "", leaveType = "", search = "", page = 0 } = {}) {
  let query = supabase.from("leave_requests").select(
    "*,leave_request_documents(id,original_name,content_type,byte_size,object_path,created_at),leave_request_history(*)",
    { count: "exact" },
  );
  if (status) query = query.eq("status", status);
  if (leaveType) query = query.eq("leave_type", leaveType);
  const term = search.replace(/[^a-zA-Z0-9@. _-]/g, "").trim().slice(0, 100);
  if (term) query = query.or(`destination.ilike.%${term}%,request_number.ilike.%${term}%,reason.ilike.%${term}%`);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data, count: count || 0 };
}
export async function listRecentStudentLeaves() {
  const { data, error } = await supabase
    .from("leave_requests")
    .select(
      "id,request_number,leave_type,departure_at,expected_return_at,destination,status,admin_remarks,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return data || [];
}
export async function listAdminLeaves({ status = "", leaveType = "", search = "", sort = "created_at", ascending = false, page = 0 } = {}) {
  let query = supabase.from("leave_requests").select(requestSelect, { count: "exact" });
  if (status) query = query.eq("status", status); if (leaveType) query = query.eq("leave_type", leaveType);
  const term = search.replace(/[^a-zA-Z0-9@. _-]/g, "").trim().slice(0, 100);
  if (term) { const { data: students, error } = await supabase.from("students").select("id").or(`full_name.ilike.%${term}%,student_id.ilike.%${term}%`).limit(100); if (error) throw error; if (!students?.length) return { rows: [], count: 0 }; query = query.in("student_id", students.map((student) => student.id)); }
  const allowedSort = ["created_at", "departure_at", "expected_return_at", "status"];
  const { data, error, count } = await query.order(allowedSort.includes(sort) ? sort : "created_at", { ascending }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (error) throw error; return { rows: data, count: count || 0 };
}
export const getLeave = (id) => queryResult(supabase.from("leave_requests").select(`${requestSelect},leave_request_documents(*),leave_request_history(*)`).eq("id", id).single());
export const decideLeave = (id, status, remarks) => queryResult(supabase.rpc("review_leave", { p_request_id: id, p_status: status, p_remarks: remarks || null }));
export const cancelLeave = (id) => queryResult(supabase.rpc("cancel_leave", { p_request_id: id }));
export async function signedLeaveDocumentUrl(path) { const { data, error } = await supabase.storage.from("leave-documents").createSignedUrl(path, 60); if (error) throw error; return data.signedUrl; }
export async function getLeaveDashboard() {
  const [dashboard, rejected] = await Promise.all([
    supabase.rpc("phase3_dashboard"),
    supabase
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "rejected"),
  ]);
  if (dashboard.error) throw dashboard.error;
  if (rejected.error) throw rejected.error;
  return { ...dashboard.data, rejected: rejected.count || 0 };
}
export function subscribeLeaves(onChange) { const channel = supabase.channel(`leave:${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public", table: "leave_requests" }, onChange).on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, onChange).subscribe(); return () => void supabase.removeChannel(channel); }
