import { supabase } from "../lib/supabase";

const PAGE_SIZE = 25;

async function invokeGateFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const response = error.context instanceof Response ? await error.context.clone().json().catch(() => null) : null;
    throw new Error(response?.error || error.message || "The server request failed.");
  }
  return data;
}

export async function getOrCreateGatePass(leaveRequestId) {
  const { data, error } = await supabase.rpc("get_or_create_gate_pass", {
    p_leave_request_id: leaveRequestId,
  });
  if (error) throw error;
  return data;
}

export async function verifyGatePassWithEdge(input) {
  return invokeGateFunction("gate-verification", input);
}

function localDayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getAdminGateMonitoring({ date = new Date(), studentId = "", eventType = "" } = {}) {
  const { start, end } = localDayBounds(date);
  const [inside, outside, exits, entries, overdue, overdueStudents] = await Promise.all([
    supabase.from("student_presence").select("student_id", { count: "exact", head: true }).eq("status", "inside"),
    supabase.from("student_presence").select("student_id", { count: "exact", head: true }).eq("status", "outside"),
    supabase.from("gate_events").select("id", { count: "exact", head: true }).eq("event_type", "exit").eq("outcome", "accepted").gte("created_at", start).lt("created_at", end),
    supabase.from("gate_events").select("id", { count: "exact", head: true }).eq("event_type", "entry").eq("outcome", "accepted").gte("created_at", start).lt("created_at", end),
    supabase.from("student_presence").select("student_id", { count: "exact", head: true }).eq("status", "outside").lt("expected_return_at", new Date().toISOString()),
    supabase.from("student_presence").select("student_id,expected_return_at,students(full_name,student_id),leave_requests!active_leave_id(request_number)").eq("status", "outside").lt("expected_return_at", new Date().toISOString()).order("expected_return_at", { ascending: true }).limit(25),
  ]);
  const failures = [inside, outside, exits, entries, overdue, overdueStudents].find((result) => result.error);
  if (failures?.error) throw failures.error;

  let query = supabase.from("gate_events").select(`id,event_type,outcome,created_at,gate_location,remarks,
    students!inner(full_name,student_id), guard:profiles!gate_events_verified_by_fkey(full_name)`).gte("created_at", start).lt("created_at", end);
  if (eventType) query = query.eq("event_type", eventType);
  if (studentId.trim()) query = query.eq("students.student_id", studentId.trim());
  const { data: movements, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return {
    inside: inside.count || 0,
    outside: outside.count || 0,
    exits: exits.count || 0,
    entries: entries.count || 0,
    overdue: overdue.count || 0,
    overdueStudents: overdueStudents.data || [],
    movements: movements || [],
  };
}

export async function listStudentsCurrentlyOutside() {
  const { data, error } = await supabase
    .from("student_presence")
    .select(`student_id,expected_return_at,
      students!inner(full_name,student_id),
      leave_requests!active_leave_id(request_number,leave_type,departure_at,expected_return_at,status)`)
    .eq("status", "outside")
    .order("expected_return_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export function manageSecurityGuards(payload) {
  return invokeGateFunction("security-guards", payload);
}

export async function listMyGatePasses() {
  const { data, error } = await supabase
    .from("gate_passes")
    .select("id, leave_request_id, status, expires_at, exit_used_at, entry_used_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function verifyGateScan({ pass_id, token, pass_code, event_type, idempotency_key }) {
  const { data, error } = await supabase.rpc("verify_gate_scan", {
    p_data: {
      pass_id: pass_id || null,
      token: token || null,
      pass_code: pass_code || null,
      event_type,
      idempotency_key: idempotency_key || crypto.randomUUID(),
    },
  });
  if (error) throw error;
  return data;
}

export async function manualGateOverride({ student_id, event_type, override_reason, leave_request_id }) {
  return invokeGateFunction("gate-verification", {
    action: "manual_override", student_id, event_type,
    override_reason: override_reason.trim(), leave_request_id,
  });
}

export async function revokeGatePass(passId, reason) {
  const { data, error } = await supabase.rpc("revoke_gate_pass", {
    p_pass_id: passId,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data;
}

export async function getGateDashboardMetrics() {
  const { data, error } = await supabase.rpc("gate_dashboard_metrics");
  if (error) throw error;
  return data;
}

export async function listGateEvents({
  eventType = "",
  outcome = "",
  search = "",
  page = 0,
  pageSize = PAGE_SIZE,
} = {}) {
  let query = supabase
    .from("gate_events")
    .select(
      `*,
       students(id, full_name, student_id, phone, profile_photo_path,
         bed_allocations!left(status, beds!left(bed_number, rooms!left(room_number, hostels!left(name, block))))
       ),
       gate_passes(id, pass_code, expires_at),
       leave_requests(id, request_number, destination)`,
      { count: "exact" },
    );

  if (eventType) query = query.eq("event_type", eventType);
  if (outcome) query = query.eq("outcome", outcome);

  const term = search.replace(/[^a-zA-Z0-9@. _-]/g, "").trim().slice(0, 100);
  if (term) {
    const { data: matchedStudents } = await supabase
      .from("students")
      .select("id")
      .or(`full_name.ilike.%${term}%,student_id.ilike.%${term}%`)
      .limit(100);

    const studentIds = (matchedStudents || []).map((s) => s.id);
    if (studentIds.length > 0) {
      query = query.or(
        `student_id.in.(${studentIds.join(",")}),override_reason.ilike.%${term}%,rejection_reason.ilike.%${term}%`,
      );
    } else {
      query = query.or(
        `override_reason.ilike.%${term}%,rejection_reason.ilike.%${term}%`,
      );
    }
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  if (error) throw error;
  return { rows: data || [], count: count || 0 };
}

export async function listStudentPresence({
  status = "",
  search = "",
  overdueOnly = false,
  page = 0,
  pageSize = PAGE_SIZE,
} = {}) {
  let query = supabase
    .from("student_presence")
    .select(
      `*,
       students(id, full_name, student_id, phone, profile_photo_path,
         bed_allocations!left(status, beds!left(bed_number, rooms!left(room_number, hostels!left(name, block))))
       ),
       leave_requests!active_leave_id(id, request_number, destination, departure_at, expected_return_at, emergency_contact),
       gate_passes!active_pass_id(id, pass_code, expires_at, status)`,
      { count: "exact" },
    );

  if (status) query = query.eq("status", status);
  if (overdueOnly) {
    query = query.eq("status", "outside").lt("expected_return_at", new Date().toISOString());
  }

  const term = search.replace(/[^a-zA-Z0-9@. _-]/g, "").trim().slice(0, 100);
  if (term) {
    const { data: matchedStudents } = await supabase
      .from("students")
      .select("id")
      .or(`full_name.ilike.%${term}%,student_id.ilike.%${term}%,phone.ilike.%${term}%`)
      .limit(100);

    const studentIds = (matchedStudents || []).map((s) => s.id);
    if (studentIds.length > 0) {
      query = query.in("student_id", studentIds);
    } else {
      return { rows: [], count: 0 };
    }
  }

  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  if (error) throw error;
  return { rows: data || [], count: count || 0 };
}

export function subscribeGate(onChange) {
  const channel = supabase
    .channel(`gate:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "gate_events" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "student_presence" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "gate_passes" },
      onChange,
    )
    .subscribe();

  return () => void supabase.removeChannel(channel);
}
