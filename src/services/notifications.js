import { supabase } from "../lib/supabase";

const sources = [
  {
    key: "leave",
    table: "notifications",
    columns:
      "id,event_type,title,message,leave_request_id,read_at,created_at,delivery_status",
    link: (row, role) =>
      role === "admin" ? "/admin/leave-requests" : "/student/leave",
  },
  {
    key: "complaint",
    table: "complaint_notifications",
    columns: "id,event_type,title,message,complaint_id,read_at,created_at",
    link: (row, role) =>
      role === "admin"
        ? "/admin/complaints"
        : `/student/complaints/${row.complaint_id}`,
  },
  {
    key: "mess",
    table: "mess_notifications",
    columns: "id,event_type,title,message,menu_id,read_at,created_at",
    link: (_row, role) => (role === "admin" ? "/admin/mess" : "/student/dashboard"),
  },
  {
    key: "announcement",
    table: "announcement_notifications",
    columns: "id,event_type,title,message,announcement_id,read_at,created_at",
    link: (_row, role) =>
      role === "admin" ? "/admin/notifications" : "/student/notifications",
  },
];

function unavailableTable(error) {
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code);
}

export async function loadNotifications({ role, page = 0, pageSize = 20 }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const safePage = Math.max(0, Math.floor(page));
  const safeSize = Math.min(50, Math.max(1, Math.floor(pageSize)));
  const end = (safePage + 1) * safeSize - 1;
  const results = await Promise.all(
    sources.map(async (source) => {
      const { data, error, count } = await supabase
        .from(source.table)
        .select(source.columns, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(0, end);
      if (error) {
        if (unavailableTable(error))
          return { source, rows: [], count: 0, unavailable: true };
        throw error;
      }
      const unread = await supabase
        .from(source.table)
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (unread.error && !unavailableTable(unread.error)) throw unread.error;
      return {
        source,
        rows: data || [],
        count: count ?? data?.length ?? 0,
        unreadCount: unread.error ? 0 : (unread.count ?? 0),
      };
    }),
  );
  const rows = results
    .flatMap(({ source, rows }) =>
      rows.map((row) => ({
        ...row,
        source: source.key,
        href: source.link(row, role),
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  const start = safePage * safeSize;
  return {
    rows: rows.slice(start, start + safeSize),
    unreadCount: results.reduce((sum, item) => sum + item.unreadCount, 0),
    total: results.reduce((sum, item) => sum + item.count, 0),
    hasMore:
      start + safeSize < results.reduce((sum, item) => sum + item.count, 0),
    unavailableSources: results
      .filter((item) => item.unavailable)
      .map((item) => item.source.key),
  };
}

export async function markNotificationRead(notification) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const source = sources.find((item) => item.key === notification?.source);
  if (!source || !notification?.id) throw new Error("Invalid notification.");
  const { error } = await supabase
    .from(source.table)
    .update({ read_at: new Date().toISOString() })
    .eq("id", notification.id)
    .is("read_at", null);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const outcomes = await Promise.all(
    sources.map(async (source) => {
      const { error } = await supabase
        .from(source.table)
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null);
      return { source: source.key, error };
    }),
  );
  const failures = outcomes.filter(
    (item) => item.error && !unavailableTable(item.error),
  );
  if (failures.length) throw failures[0].error;
}
