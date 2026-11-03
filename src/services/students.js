import { supabase } from "../lib/supabase";
import { queryResult } from "./profiles";
import { validatePhoto } from "../lib/studentValidation";
import { registrationErrorMessage } from "../lib/registrationErrors";
export const manage = (action, data) =>
  queryResult(supabase.rpc("manage_phase2", { action, data }));
export async function registerStudent(request_id, student, action) {
  const operation =
    action || (student ? "register" : "reset_temporary_password");
  const { data, error } = await supabase.functions.invoke(
    "student-registration",
    { body: { request_id, student, action: operation } },
  );
  if (error) {
    let detail;
    try {
      detail = await error.context.json();
    } catch {
      /* Network failures may have no JSON response. */
    }
    const failure = new Error(registrationErrorMessage(error, detail));
    failure.student_id = detail?.student_id;
    throw failure;
  }
  if (!data?.student_id || !data?.login_id || !data?.temporary_password) {
    const failure = new Error(
      "The deployed student-registration function has not been updated for temporary credentials. The request may already have created the student or sent the old invitation; do not resubmit it. Check the student directory, then deploy the reviewed function and migration before retrying.",
    );
    failure.student_id = data?.student_id;
    throw failure;
  }
  return data;
}
export async function listStudents({
  search = "",
  hostel = "",
  room = "",
  course = "",
  status = "",
  sort = "created_at",
  ascending = false,
  page = 0,
}) {
  let query = supabase
    .from("student_directory")
    .select("*", { count: "exact" });
  const term = search
    .replace(/[^\p{L}\p{N}@. _-]/gu, "")
    .trim()
    .slice(0, 100);
  if (term)
    query = query.or(
      `full_name.ilike.%${term}%,student_id.ilike.%${term}%,email.ilike.%${term}%`,
    );
  for (const [key, value] of Object.entries({
    hostel_id: hostel,
    room_id: room,
    course,
    status,
  }))
    if (value) query = query.eq(key, value);
  const { data, error, count } = await query
    .order(
      ["created_at", "full_name", "student_id"].includes(sort)
        ? sort
        : "created_at",
      { ascending },
    )
    .order("id")
    .range(page * 20, page * 20 + 19);
  if (error) throw error;
  return { rows: data, count };
}
async function allRows(table, selection = "*", active = false) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase
      .from(table)
      .select(selection)
      .order("id")
      .range(offset, offset + 499);
    if (active) query = query.eq("status", "active");
    const batch = await queryResult(query);
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
export async function getInventory() {
  const [hostels, rooms, beds, allocations] = await Promise.all([
    allRows("hostels"),
    allRows("rooms"),
    allRows("beds"),
    allRows(
      "bed_allocations",
      "id,student_id,bed_id,students(full_name,student_id)",
      true,
    ),
  ]);
  return { hostels, rooms, beds, allocations };
}
export async function getStudent(id, userId) {
  let query = supabase
    .from("students")
    .select("*,guardians(*),bed_allocations(*,beds(*,rooms(*,hostels(*))))");
  query = id ? query.eq("id", id) : query.eq("user_id", userId);
  const student = await queryResult(query.maybeSingle());
  if (!student) return null;
  if (id)
    student.invitation = await queryResult(
      supabase
        .from("student_registrations")
        .select("id,invitation_status,attempts,last_error,sent_at")
        .eq("student_id", id)
        .maybeSingle(),
    );
  return student;
}
export async function uploadAvatar(student, file) {
  validatePhoto(file);
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
    file.type
  ];
  const path = `${student.id}/${crypto.randomUUID()}.${ext}`;
  const bucket = supabase.storage.from("student-avatars");
  const { error } = await bucket.upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  try {
    await queryResult(
      supabase
        .from("students")
        .update({ profile_photo_path: path })
        .eq("id", student.id)
        .select("id")
        .single(),
    );
  } catch (error) {
    await bucket.remove([path]);
    throw error;
  }
  if (student.profile_photo_path)
    await bucket.remove([student.profile_photo_path]);
  return path;
}
export const updatePhone = (id, phone) =>
  queryResult(
    supabase
      .from("students")
      .update({ phone })
      .eq("id", id)
      .select("id")
      .single(),
  );
export const activeAllocation = (s) =>
  s?.bed_allocations?.find((a) => a.status === "active");
export function subscribePhase2(onChange) {
  let channel = supabase.channel(`phase2:${crypto.randomUUID()}`);
  for (const table of ["students", "rooms", "beds", "bed_allocations"])
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      onChange,
    );
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
