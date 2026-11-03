import { supabase } from "../lib/supabase";
export async function queryResult(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
export const getProfile = (id) =>
  queryResult(supabase.from("profiles").select("*").eq("id", id).maybeSingle());
export const updateProfile = (id, values) =>
  queryResult(
    supabase
      .from("profiles")
      .update({ full_name: values.full_name, phone: values.phone })
      .eq("id", id)
      .select()
      .single(),
  );

async function optionalModule(fetcher) {
  try {
    return { available: true, data: await fetcher(), error: null };
  } catch (error) {
    const missingSchema = [
      "42P01",
      "42883",
      "42703",
      "PGRST200",
      "PGRST202",
      "PGRST204",
      "PGRST205",
    ].includes(error?.code);
    return {
      available: false,
      data: null,
      error: missingSchema
        ? "Required module migration is not available in this database."
        : "Module data could not be loaded with the current account and policies.",
    };
  }
}
async function exactCount(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export async function getDashboard() {
  const [phase2, leave, fees, complaints, mess] = await Promise.all([
    queryResult(supabase.rpc("phase2_dashboard")),
    optionalModule(() => queryResult(supabase.rpc("phase3_dashboard"))),
    optionalModule(async () => {
      const [pending, partially_paid, overdue] = await Promise.all(
        ["pending", "partially_paid", "overdue"].map((status) =>
          exactCount(
            supabase
              .from("fee_invoice_balances")
              .select("id", { count: "exact", head: true })
              .eq("payment_status", status),
          ),
        ),
      );
      return { pending, partially_paid: partially_paid, overdue };
    }),
    optionalModule(async () => {
      return queryResult(supabase.rpc("admin_operations_metrics"));
    }),
    optionalModule(() => queryResult(supabase.rpc("mess_admin_summary"))),
  ]);
  return {
    ...phase2,
    leave: leave.data,
    modules: {
      leave: { available: leave.available, error: leave.error },
      fees: { ...fees, data: fees.data },
      complaints: { ...complaints, data: complaints.data?.complaints },
      mess: { available: mess.available, error: mess.error, data: mess.data },
      gate: {
        available: false,
        error:
          "The current gate RLS policies do not grant administrator access to presence or event rows.",
      },
      maintenance: {
        available: complaints.available,
        error: complaints.error,
        data: complaints.data?.maintenance,
      },
    },
  };
}
