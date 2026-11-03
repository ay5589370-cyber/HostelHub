import { supabase } from "../lib/supabase";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function loadAdminFees() {
  const [invoices, plans, payments] = await Promise.all([
    supabase
      .from("fee_invoice_balances")
      .select("*")
      .order("due_date", { ascending: true }),
    supabase
      .from("fee_plans")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("fee_payments")
      .select(
        "*,fee_invoices(student_name,student_number,currency_code,currency_minor_units)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  return {
    invoices: unwrap(invoices),
    plans: unwrap(plans),
    payments: unwrap(payments),
  };
}

export async function loadStudentFees() {
  const [invoices, adjustments, payments] = await Promise.all([
    supabase
      .from("fee_invoice_balances")
      .select("*")
      .order("due_date", { ascending: false }),
    supabase
      .from("fee_adjustments")
      .select("*")
      .order("created_at", { ascending: true }),
    supabase
      .from("fee_payments")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);
  return {
    invoices: unwrap(invoices),
    adjustments: unwrap(adjustments),
    payments: unwrap(payments),
  };
}

export const saveFeePlan = (data) =>
  supabase.rpc("fee_save_plan", { p_data: data }).then(unwrap);
export const generateFeeInvoices = (planId) =>
  supabase.rpc("fee_generate_invoices", { p_plan_id: planId }).then(unwrap);
export const addFeeAdjustment = (invoiceId, amount, reason) =>
  supabase
    .rpc("fee_add_adjustment", {
      p_invoice_id: invoiceId,
      p_amount: amount,
      p_reason: reason,
    })
    .then(unwrap);
export const recordFeePayment = (
  invoiceId,
  amount,
  method,
  reference,
  paidOn,
  notes,
) =>
  supabase
    .rpc("fee_record_payment", {
      p_invoice_id: invoiceId,
      p_amount: amount,
      p_method: method,
      p_reference: reference,
      p_paid_on: paidOn,
      p_notes: notes,
    })
    .then(unwrap);
export const reviewFeePayment = (paymentId, decision, reason = "") =>
  supabase
    .rpc("fee_review_payment", {
      p_payment_id: paymentId,
      p_decision: decision,
      p_reason: reason,
    })
    .then(unwrap);

export function subscribeFees(onChange) {
  const channel = supabase
    .channel(`fees:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "fee_invoices" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "fee_payments" },
      onChange,
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}
