import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  PageHeader,
  ErrorState,
  LoadingSkeleton,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { useQuery } from "../../hooks/useQuery";
import {
  addFeeAdjustment,
  generateFeeInvoices,
  loadAdminFees,
  recordFeePayment,
  reviewFeePayment,
  saveFeePlan,
  subscribeFees,
} from "../../services/fees";

const money = (value, currency, digits) =>
  `${currency} ${Number(value || 0).toFixed(Number.isInteger(digits) ? digits : 2)}`;
const currencyTotals = (rows, field) => {
  const totals = new Map();
  for (const row of rows) {
    const key = `${row.currency_code}:${row.currency_minor_units}`;
    totals.set(key, (totals.get(key) || 0) + Number(row[field] || 0));
  }
  return (
    [...totals.entries()]
      .map(([key, value]) => {
        const [currency, digits] = key.split(":");
        return money(value, currency, Number(digits));
      })
      .join(" · ") || "—"
  );
};
const today = new Date().toISOString().slice(0, 10);
function exportCsv(rows) {
  const cols = [
    "student_number",
    "student_name",
    "room_label",
    "plan_name",
    "academic_term",
    "amount_due",
    "amount_paid",
    "balance",
    "currency_code",
    "due_date",
    "payment_status",
  ];
  const csv = [
    cols.join(","),
    ...rows.map((r) =>
      cols
        .map((key) => `"${String(r[key] ?? "").replaceAll('"', '""')}"`)
        .join(","),
    ),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "hostel-fees.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function Fees() {
  const query = useQuery(loadAdminFees);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState("");
  const run = async (fn, success) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await fn();
      setMessage(success(result));
      await query.reload();
    } catch (e) {
      setMessage(e.message || "Fee operation failed.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => subscribeFees(query.reload), [query.reload]);
  const rows = useMemo(
    () =>
      (query.data?.invoices || []).filter(
        (r) =>
          (!status || r.payment_status === status) &&
          (!search ||
            `${r.student_name} ${r.student_number} ${r.room_label}`
              .toLowerCase()
              .includes(search.toLowerCase())),
      ),
    [query.data, search, status],
  );
  const allInvoices = query.data?.invoices || [];
  const overdueCount = allInvoices.filter(
    (r) => r.payment_status === "overdue",
  ).length;
  if (query.loading) return <LoadingSkeleton />;
  if (query.error)
    return <ErrorState message={query.error.message} onRetry={query.reload} />;
  return (
    <>
      <PageHeader
        eyebrow="FINANCIAL MANAGEMENT"
        title="Fees & payments"
        description="Configure hostel charges, generate invoices from current allocations, and track verified payments."
      />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <section className="stats-grid fee-metrics">
        <article className="stat-card">
          <span className="stat-top">Total invoiced (gross)</span>
          <strong className="stat-value">
            {currencyTotals(allInvoices, "base_amount")}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-top">Verified payments</span>
          <strong className="stat-value">
            {currencyTotals(allInvoices, "amount_paid")}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-top">Outstanding</span>
          <strong className="stat-value">
            {currencyTotals(allInvoices, "balance")}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-top">Overdue invoices</span>
          <strong className="stat-value">{overdueCount}</strong>
        </article>
      </section>
      <section className="panel phase-panel">
        <h2>Fee structure</h2>
        <p>
          Enter the currency used by your institution. No currency is
          preselected.
        </p>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            void run(
              () =>
                saveFeePlan({
                  ...data,
                  currency_minor_units: Number(data.currency_minor_units),
                  amount: Number(data.amount),
                }),
              () => "Fee plan saved.",
            );
          }}
        >
          <label>
            Plan name *<input name="name" required maxLength="100" />
          </label>
          <label>
            Room type *<input name="room_type" required maxLength="100" />
          </label>
          <label>
            Amount *
            <input
              name="amount"
              type="number"
              min="0.001"
              step="0.001"
              required
            />
          </label>
          <label>
            Currency code *
            <input
              name="currency_code"
              required
              pattern="[A-Z]{3}"
              maxLength="3"
              placeholder="ISO 4217"
            />
          </label>
          <label>
            Currency decimal places *
            <select name="currency_minor_units" defaultValue="2">
              <option value="0">0</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <label>
            Billing period *
            <select name="billing_period" defaultValue="term">
              <option value="monthly">Monthly</option>
              <option value="term">Academic term</option>
              <option value="annual">Annual</option>
              <option value="one_time">One time</option>
            </select>
          </label>
          <label>
            Academic term *
            <input
              name="academic_term"
              required
              maxLength="100"
              placeholder="e.g. 2026-27 Term 1"
            />
          </label>
          <label>
            Due date *<input name="due_date" type="date" required />
          </label>
          <Button disabled={busy}>Save fee structure</Button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Room type</th>
                <th>Amount</th>
                <th>Term / period</th>
                <th>Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data.plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.room_type}</td>
                  <td>
                    {money(p.amount, p.currency_code, p.currency_minor_units)}
                  </td>
                  <td>
                    {p.academic_term} · {p.billing_period}
                  </td>
                  <td>{p.due_date}</td>
                  <td>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => generateFeeInvoices(p.id),
                          (n) =>
                            `${n} invoice(s) generated; existing invoices were left unchanged.`,
                        )
                      }
                    >
                      Generate invoices
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel phase-panel">
        <div className="section-heading">
          <div>
            <h2>Invoices</h2>
            <p>
              Due, paid, partially paid and overdue balances are calculated from
              verified ledger records.
            </p>
          </div>
          <Button variant="outline" onClick={() => exportCsv(rows)}>
            <Download size={15} /> Export CSV
          </Button>
        </div>
        <div className="form-grid">
          <label>
            Search students
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, registration ID, room"
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {["pending", "partially_paid", "overdue", "paid"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <Button variant="outline" onClick={query.reload}>
            <RefreshCw size={15} /> Refresh
          </Button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student / registration</th>
                <th>Room</th>
                <th>Plan / term</th>
                <th>Due</th>
                <th>Invoiced</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.student_name}
                    <small>{r.student_number}</small>
                  </td>
                  <td>{r.room_label}</td>
                  <td>
                    {r.plan_name}
                    <small>{r.academic_term}</small>
                  </td>
                  <td>{r.due_date}</td>
                  <td>
                    {money(
                      r.amount_due,
                      r.currency_code,
                      r.currency_minor_units,
                    )}
                  </td>
                  <td>
                    {money(
                      r.amount_paid,
                      r.currency_code,
                      r.currency_minor_units,
                    )}
                  </td>
                  <td>
                    {money(r.balance, r.currency_code, r.currency_minor_units)}
                  </td>
                  <td>{r.payment_status.replaceAll("_", " ")}</td>
                  <td>
                    <Button
                      variant="outline"
                      onClick={() => setSelected(selected === r.id ? "" : r.id)}
                    >
                      Adjust / record
                    </Button>
                    {selected === r.id && (
                      <div className="fee-actions">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void run(
                              () =>
                                addFeeAdjustment(
                                  r.id,
                                  Number(f.get("amount")),
                                  f.get("reason"),
                                ),
                              () => "Adjustment recorded with audit history.",
                            );
                          }}
                        >
                          <input
                            name="amount"
                            type="number"
                            min="0.001"
                            step="0.001"
                            max={r.balance}
                            required
                            placeholder="Waiver amount"
                          />
                          <input
                            name="reason"
                            required
                            minLength="5"
                            maxLength="500"
                            placeholder="Reason"
                          />
                          <Button disabled={busy}>Apply waiver</Button>
                        </form>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void run(
                              () =>
                                recordFeePayment(
                                  r.id,
                                  Number(f.get("amount")),
                                  f.get("method"),
                                  f.get("reference"),
                                  f.get("paid_on"),
                                  f.get("notes"),
                                ),
                              () =>
                                "Payment recorded pending independent admin verification.",
                            );
                          }}
                        >
                          <input
                            name="amount"
                            type="number"
                            min="0.001"
                            step="0.001"
                            max={r.balance}
                            required
                            placeholder="Amount received"
                          />
                          <input
                            name="method"
                            required
                            minLength="2"
                            placeholder="Method"
                          />
                          <input
                            name="reference"
                            required
                            minLength="2"
                            placeholder="Evidence/reference"
                          />
                          <input
                            name="paid_on"
                            type="date"
                            defaultValue={today}
                            required
                          />
                          <input
                            name="notes"
                            maxLength="1000"
                            placeholder="Notes"
                          />
                          <Button disabled={busy}>
                            Record pending payment
                          </Button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel phase-panel">
        <h2>Recent payment activity</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Amount / method</th>
                <th>Reference</th>
                <th>Date</th>
                <th>Status</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {query.data.payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.fee_invoices?.student_name}
                    <small>{p.fee_invoices?.student_number}</small>
                  </td>
                  <td>
                    {money(
                      p.amount,
                      p.fee_invoices?.currency_code,
                      p.fee_invoices?.currency_minor_units,
                    )}{" "}
                    · {p.payment_method}
                  </td>
                  <td>{p.reference_number}</td>
                  <td>{p.paid_on}</td>
                  <td>{p.status.replaceAll("_", " ")}</td>
                  <td>
                    {p.status === "pending_verification" ? (
                      <>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => reviewFeePayment(p.id, "verified"),
                              () => "Payment verified.",
                            )
                          }
                        >
                          Verify
                        </Button>{" "}
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                reviewFeePayment(
                                  p.id,
                                  "rejected",
                                  "Evidence rejected by administrator",
                                ),
                              () => "Payment rejected.",
                            )
                          }
                        >
                          Reject
                        </Button>
                      </>
                    ) : p.status === "verified" ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              reviewFeePayment(
                                p.id,
                                "reversed",
                                "Reversal recorded by administrator",
                              ),
                            () =>
                              "Payment reversed; invoice balance recalculated.",
                          )
                        }
                      >
                        Reverse
                      </Button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Payment verification requires a different active administrator than
          the recorder. Pending entries do not reduce balances.
        </p>
      </section>
    </>
  );
}
