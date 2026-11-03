import { supabase } from "../lib/supabase";
import {
  complaintImageTypes,
  validateComplaintFiles,
} from "../lib/complaintValidation";

const PAGE_SIZE = 20;

async function uploadImages(complaintId, messageId, files) {
  validateComplaintFiles(files);
  const bucket = supabase.storage.from("complaint-attachments");
  const uploaded = [];
  try {
    const metadata = [];
    for (const file of files) {
      const path = `${complaintId}/${crypto.randomUUID()}.${complaintImageTypes[file.type]}`;
      const { error } = await bucket.upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      uploaded.push(path);
      metadata.push({
        path,
        name: file.name,
        type: file.type,
        size: file.size,
      });
    }
    const { error: metadataError } = await supabase.rpc(
      "complaint_register_attachments",
      {
        p_complaint_id: complaintId,
        p_message_id: messageId,
        p_items: metadata,
      },
    );
    if (metadataError) throw metadataError;
  } catch (error) {
    if (uploaded.length) await bucket.remove(uploaded);
    throw error;
  }
}

export async function submitComplaint(values, nonce, files = []) {
  const { data, error } = await supabase.rpc("complaint_submit", {
    p_data: values,
    p_nonce: nonce,
  });
  if (error) throw error;
  try {
    if (files.length) await uploadImages(data.id, null, files);
  } catch (uploadError) {
    uploadError.complaint = data;
    throw uploadError;
  }
  return data;
}

export async function addComplaintMessage(complaintId, message, files = []) {
  const { data: messageId, error } = await supabase.rpc(
    "complaint_add_message",
    {
      p_complaint_id: complaintId,
      p_message: message,
      p_visibility: "student",
    },
  );
  if (error) throw error;
  if (files.length) {
    try {
      await uploadImages(complaintId, messageId, files);
    } catch (uploadError) {
      uploadError.messageCreated = true;
      throw uploadError;
    }
  }
  return messageId;
}

export async function listStudentComplaints({
  search = "",
  status = "",
  page = 0,
} = {}) {
  let query = supabase
    .from("complaints")
    .select(
      "id,complaint_number,title,category,priority,status,room_label,created_at,updated_at,resolution,resolved_at,complaint_events(id,event_type,visibility,old_value,new_value,created_at),complaint_messages(id,author_type,visibility,message,created_at),complaint_attachments(id,message_id,object_path,original_name,content_type,byte_size,created_at)",
      { count: "exact" },
    );
  if (status) query = query.eq("status", status);
  const term = search
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 80);
  if (term)
    query = query.or(`complaint_number.ilike.%${term}%,title.ilike.%${term}%`);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data || [], count: count || 0 };
}

export async function getStudentComplaint(id) {
  const [complaint, notices] = await Promise.all([
    supabase
      .from("complaints")
      .select(
        "id,complaint_number,title,category,description,location_detail,room_label,priority,status,resolution,resolved_at,created_at,updated_at,complaint_events(id,event_type,visibility,old_value,new_value,created_at),complaint_messages(id,author_type,visibility,message,created_at),complaint_attachments(id,message_id,object_path,original_name,content_type,byte_size,created_at)",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("complaint_notifications")
      .select("id,event_type,title,message,created_at,read_at")
      .eq("complaint_id", id)
      .is("read_at", null),
  ]);
  if (complaint.error) throw complaint.error;
  if (notices.error) throw notices.error;
  if (notices.data?.length) {
    await supabase
      .from("complaint_notifications")
      .update({ read_at: new Date().toISOString() })
      .in(
        "id",
        notices.data.map((notice) => notice.id),
      );
  }
  return { ...complaint.data, notices: notices.data || [] };
}

export async function listStaffComplaints(filters) {
  const { data, error } = await supabase.rpc("complaint_staff_list", {
    p_search: filters.search || "",
    p_status: filters.status || "",
    p_category: filters.category || "",
    p_priority: filters.priority || "",
    p_page: filters.page || 0,
    p_page_size: PAGE_SIZE,
    p_sort: filters.sort || "updated_at",
    p_ascending: Boolean(filters.ascending),
  });
  if (error) throw error;
  return data;
}

export async function getStaffComplaint(id) {
  const { data, error } = await supabase.rpc("complaint_staff_detail", {
    p_id: id,
  });
  if (error) throw error;
  return data;
}

export async function getComplaintStaffDirectory() {
  const { data, error } = await supabase.rpc("complaint_staff_directory");
  if (error) throw error;
  return data || [];
}

export const assignComplaint = (id, staffId) =>
  supabase.rpc("complaint_assign", { p_complaint_id: id, p_staff_id: staffId });

export const transitionComplaint = (id, status, resolution, priority) =>
  supabase.rpc("complaint_transition", {
    p_complaint_id: id,
    p_status: status,
    p_resolution: resolution || null,
    p_priority: priority || null,
  });

export const addStaffComplaintMessage = (id, message, internal) =>
  supabase.rpc("complaint_add_message", {
    p_complaint_id: id,
    p_message: message,
    p_visibility: internal ? "internal" : "student",
  });

export const createMaintenanceTask = (
  complaintId,
  staffId,
  visit,
  cost,
  currency,
) =>
  supabase.rpc("complaint_create_maintenance", {
    p_complaint_id: complaintId,
    p_staff_id: staffId || null,
    p_visit: visit || null,
    p_estimated_cost: cost === "" ? null : Number(cost),
    p_currency: currency || null,
  });

export const updateMaintenanceTask = (task, values) =>
  supabase.rpc("complaint_update_maintenance", {
    p_task_id: task.id,
    p_status: values.status,
    p_staff_id: values.staff_id || null,
    p_visit: values.visit || null,
    p_notes: values.notes || "",
    p_actual_cost:
      values.actual_cost === "" ? null : Number(values.actual_cost),
    p_currency: values.currency || null,
  });

export async function signedComplaintAttachmentUrl(path) {
  const { data, error } = await supabase.storage
    .from("complaint-attachments")
    .createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}
