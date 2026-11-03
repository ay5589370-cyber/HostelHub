import { supabase } from "../lib/supabase";

const BATCH = 500;
const MAX_ROWS = 20000;
const fail = ({ data, error }) => {
  if (error) throw error;
  return data;
};

async function allRows(queryFactory) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += BATCH) {
    const { data, error } = await queryFactory().range(
      offset,
      offset + BATCH - 1,
    );
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < BATCH) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const normalized = (rows) =>
  rows.map((row) => ({
    ...row,
    student_number:
      row.student_number || row.student_id || row.students?.student_id || "",
    student_name:
      row.student_name || row.full_name || row.students?.full_name || "",
    hostel_label:
      row.hostel_label ||
      [
        row.hostel_name || row.rooms?.hostels?.name,
        row.block || row.rooms?.hostels?.block,
      ]
        .filter(Boolean)
        .join(" / "),
  }));

function searchRows(rows, search, keys) {
  const term = search.trim().toLowerCase();
  return term
    ? rows.filter((row) =>
        keys.some((key) =>
          String(row[key] ?? "")
            .toLowerCase()
            .includes(term),
        ),
      )
    : rows;
}

async function studentDirectory(filters) {
  const { rows, truncated } = await allRows(() => {
    let q = supabase
      .from("student_directory")
      .select(
        "id,student_id,full_name,course,branch,semester,status,admission_date,hostel_name,block,room_number,bed_number,invitation_status,created_at",
      )
      .order("created_at", { ascending: false })
      .order("id");
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.from) q = q.gte("admission_date", filters.from);
    if (filters.to) q = q.lte("admission_date", filters.to);
    return q;
  });
  return {
    rows: normalized(
      searchRows(rows, filters.search, [
        "student_id",
        "full_name",
        "course",
        "branch",
      ]),
    ),
    truncated,
  };
}

async function occupancy(filters) {
  const result = await allRows(() =>
    supabase
      .from("beds")
      .select(
        "id,bed_number,status,rooms!inner(id,room_number,room_type,status,hostel_id,hostels(name,block,status)),bed_allocations(id,status,student_id,students(student_id,full_name,status))",
      )
      .order("id"),
  );
  let rows = result.rows.map((bed) => {
    const allocation = (bed.bed_allocations || []).find(
      (a) => a.status === "active",
    );
    return {
      hostel: bed.rooms?.hostels?.name || "—",
      block: bed.rooms?.hostels?.block || "—",
      room_type: bed.rooms?.room_type || "—",
      room: bed.rooms?.room_number || "—",
      room_status: bed.rooms?.status || "—",
      hostel_status: bed.rooms?.hostels?.status || "—",
      bed: bed.bed_number,
      bed_status: bed.status,
      allocation_status: allocation ? "occupied" : "unallocated",
      student_number: allocation?.students?.student_id || "",
      student_name: allocation?.students?.full_name || "",
    };
  });
  if (filters.hostel)
    rows = rows.filter((row) =>
      row.hostel.toLowerCase().includes(filters.hostel.trim().toLowerCase()),
    );
  if (filters.roomType)
    rows = rows.filter(
      (row) =>
        row.room_type.toLowerCase() === filters.roomType.trim().toLowerCase(),
    );
  rows = searchRows(rows, filters.search, [
    "hostel",
    "block",
    "room_type",
    "room",
    "bed",
    "student_number",
    "student_name",
  ]);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.hostel}\0${row.block}\0${row.room_type}`;
    const group = groups.get(key) || {
      hostel: row.hostel,
      block: row.block,
      room_type: row.room_type,
      beds: 0,
      occupied: 0,
      available: 0,
    };
    group.beds++;
    if (row.allocation_status === "occupied") group.occupied++;
    if (
      row.bed_status === "available" &&
      row.room_status === "available" &&
      row.hostel_status === "active" &&
      row.allocation_status !== "occupied"
    )
      group.available++;
    groups.set(key, group);
  }
  return { rows, summary: [...groups.values()], truncated: result.truncated };
}

async function leaveHistory(filters) {
  const result = await allRows(() => {
    let q = supabase
      .from("leave_requests")
      .select(
        "id,request_number,leave_type,status,departure_at,expected_return_at,destination,created_at,updated_at,students(full_name,student_id),leave_request_history(id,event_type,old_status,new_status,created_at)",
      )
      .order("created_at", { ascending: false });
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.from) q = q.gte("departure_at", `${filters.from}T00:00:00`);
    if (filters.to) q = q.lt("departure_at", `${filters.to}T23:59:59.999999Z`);
    return q;
  });
  const withHistory = result.rows.map((row) => ({
    ...row,
    history_count: row.leave_request_history?.length || 0,
  }));
  return {
    rows: normalized(
      searchRows(withHistory, filters.search, [
        "request_number",
        "student_id",
        "student_name",
        "destination",
      ]),
    ),
    truncated: result.truncated,
  };
}

async function feeLedger(filters) {
  const result = await allRows(() => {
    let q = supabase
      .from("fee_invoice_balances")
      .select(
        "id,student_number,student_name,room_label,plan_name,academic_term,billing_period,due_date,base_amount,amount_due,amount_paid,balance,currency_code,payment_status",
      )
      .order("due_date", { ascending: true });
    if (filters.status) q = q.eq("payment_status", filters.status);
    if (filters.from) q = q.gte("due_date", filters.from);
    if (filters.to) q = q.lte("due_date", filters.to);
    return q;
  });
  return {
    rows: searchRows(result.rows, filters.search, [
      "student_number",
      "student_name",
      "room_label",
      "plan_name",
    ]),
    truncated: result.truncated,
  };
}

async function complaintReport(filters) {
  const rows = [];
  let page = 0;
  let count = 0;
  let summary = {};
  while (rows.length < MAX_ROWS) {
    const result = fail(
      await supabase.rpc("complaint_staff_list", {
        p_search: filters.search || "",
        p_status: filters.status || "",
        p_category: filters.category || "",
        p_priority: "",
        p_page: page,
        p_page_size: 100,
        p_sort: "created_at",
        p_ascending: false,
      }),
    );
    count = result.count || 0;
    summary = result.summary || summary;
    rows.push(...(result.rows || []));
    if (rows.length >= count || !(result.rows || []).length) break;
    page++;
  }
  const inRange = rows.filter(
    (row) =>
      (!filters.from || row.created_at.slice(0, 10) >= filters.from) &&
      (!filters.to || row.created_at.slice(0, 10) <= filters.to),
  );
  const analytics = fail(
    await supabase.rpc("admin_operations_metrics", {
      p_from: filters.from || null,
      p_to: filters.to || null,
    }),
  );
  return {
    rows: inRange.map((row) => ({
      complaint_number: row.complaint_number,
      student_number: row.registration_id,
      student_name: row.student_name,
      title: row.title,
      category: row.category,
      priority: row.priority,
      status: row.status,
      room_label: row.room_label,
      created_at: row.created_at,
      updated_at: row.updated_at,
      resolved_at: row.resolved_at,
      resolution_hours: row.resolved_at
        ? Math.round(
            (new Date(row.resolved_at).getTime() -
              new Date(row.created_at).getTime()) /
              360000,
          ) / 10
        : "",
    })),
    summary,
    analytics,
    truncated: rows.length < count,
    notice:
      "Resolution duration is calculated from submitted to resolved_at. First staff response time counts the first student-visible reply posted by active staff.",
  };
}

async function messFeedback(filters) {
  const result = await allRows(() => {
    let q = supabase
      .from("mess_feedback")
      .select(
        "meal_date,meal_slot,rating,category,comments,submitted_at,updated_at",
      )
      .order("meal_date", { ascending: false });
    if (filters.from) q = q.gte("meal_date", filters.from);
    if (filters.to) q = q.lte("meal_date", filters.to);
    if (filters.mealSlot) q = q.eq("meal_slot", filters.mealSlot);
    if (filters.rating) q = q.eq("rating", Number(filters.rating));
    return q;
  });
  return {
    rows: searchRows(result.rows, filters.search, [
      "category",
      "comments",
      "meal_slot",
    ]),
    truncated: result.truncated,
  };
}

async function financePayments(filters) {
  const result = await allRows(() => {
    let q = supabase
      .from("fee_payments")
      .select(
        "id,invoice_id,amount,payment_method,paid_on,status,created_at,fee_invoices(student_number,student_name,academic_term,currency_code)",
      )
      .order("paid_on", { ascending: false });
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.from) q = q.gte("paid_on", filters.from);
    if (filters.to) q = q.lte("paid_on", filters.to);
    return q;
  });
  const rows = result.rows.map((r) => ({
    paid_on: r.paid_on,
    student_number: r.fee_invoices?.student_number,
    student_name: r.fee_invoices?.student_name,
    academic_term: r.fee_invoices?.academic_term,
    amount: r.amount,
    currency_code: r.fee_invoices?.currency_code,
    payment_method: r.payment_method,
    status: r.status,
  }));
  return {
    rows: searchRows(rows, filters.search, [
      "student_number",
      "student_name",
      "academic_term",
      "payment_method",
    ]),
    truncated: result.truncated,
  };
}

async function auditActivity(filters) {
  const [registrations, allocations, leaves, fees, mess] = await Promise.all([
    supabase
      .from("student_registrations")
      .select("student_number,invitation_status,created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("bed_allocations")
      .select(
        "status,allocated_at,vacated_at,students(student_id,full_name),beds(bed_number,rooms(room_number,hostels(name,block)))",
      )
      .order("allocated_at", { ascending: false })
      .limit(50),
    supabase
      .from("leave_request_history")
      .select("new_status,created_at,leave_requests(request_number)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("fee_audit_log")
      .select("entity_type,action,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("mess_events")
      .select("event_type,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const baseError = registrations.error || allocations.error || leaves.error;
  if (baseError) throw baseError;
  let rows = [
    ...(registrations.data || []).map((r) => ({
      source: "Admission",
      event: `Registration ${r.invitation_status}: ${r.student_number}`,
      created_at: r.created_at,
    })),
    ...(allocations.data || []).map((r) => ({
      source: "Allocation",
      event: `${r.status}: ${r.students?.student_id || "student"} · ${r.beds?.rooms?.hostels?.name || "hostel"} ${r.beds?.rooms?.room_number || ""} bed ${r.beds?.bed_number || ""}`,
      created_at: r.status === "vacated" ? r.vacated_at : r.allocated_at,
    })),
    ...(leaves.data || []).map((r) => ({
      source: "Leave",
      event: `${r.leave_requests?.request_number || "request"}: ${r.new_status}`,
      created_at: r.created_at,
    })),
    ...(fees.data || []).map((r) => ({
      source: "Fees",
      event: `${r.entity_type}: ${r.action}`,
      created_at: r.created_at,
    })),
    ...(mess.data || []).map((r) => ({
      source: "Mess",
      event: r.event_type,
      created_at: r.created_at,
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (filters.from)
    rows = rows.filter((row) => row.created_at.slice(0, 10) >= filters.from);
  if (filters.to)
    rows = rows.filter((row) => row.created_at.slice(0, 10) <= filters.to);
  rows = rows.slice(0, 100);
  return {
    rows,
    truncated: true,
    notice: `Recent admission, allocation, leave, fee and mess records only. ${fees.error || mess.error ? "Some optional fee or mess audit sources could not be read. " : ""}Complaint timelines are available in complaint details; gate events are security-scoped. This is not a single complete audit log.`,
  };
}

export async function loadReport(report, filters = {}) {
  try {
    let result;
    if (report === "students") result = await studentDirectory(filters);
    else if (report === "occupancy") result = await occupancy(filters);
    else if (report === "leaves") result = await leaveHistory(filters);
    else if (report === "fees") result = await feeLedger(filters);
    else if (report === "payments") result = await financePayments(filters);
    else if (report === "complaints") result = await complaintReport(filters);
    else if (report === "mess") result = await messFeedback(filters);
    else if (report === "audit") result = await auditActivity(filters);
    else if (report === "gate")
      result = {
        rows: [],
        available: false,
        notice:
          "Current gate RLS policies grant event and presence access to security staff and each student's own records, not admins. No gate records are queried or exported from this page.",
      };
    else throw new Error("Unknown report type.");
    return { available: result.available ?? true, ...result };
  } catch (error) {
    if (
      [
        "42P01",
        "42883",
        "42703",
        "PGRST200",
        "PGRST202",
        "PGRST204",
        "PGRST205",
      ].includes(error?.code)
    ) {
      return {
        rows: [],
        available: false,
        notice:
          "Required module schema or RPC is not available in the connected database. Verify migration status before enabling this report.",
      };
    }
    throw error;
  }
}
