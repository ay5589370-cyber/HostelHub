import { useMemo } from "react";
import {
  PageHeader,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from "../../components/common/Feedback";
import { useQuery } from "../../hooks/useQuery";
import { loadStudentFees } from "../../services/fees";

const money = (value, currency, digits) =>
  `${currency} ${Number(value || 0).toFixed(Number.isInteger(digits) ? digits : 2)}`;

export default function StudentFees() {
  const query = useQuery(loadStudentFees);
  const history = useMemo(() => {
    if (!query.data) return new Map();
    const adjustments = new Map();
    for (const item of query.data.adjustments)
      adjustments.set(item.invoice_id, [
        ...(adjustments.get(item.invoice_id) || []),
        item,
      ]);
    const payments = new Map();
    for (const item of query.data.payments)
      payments.set(item.invoice_id, [
        ...(payments.get(item.invoice_id) || []),
        item,
      ]);
    return new Map(
      query.data.invoices.map((invoice) => [
        invoice.id,
        {
          adjustments: adjustments.get(invoice.id) || [],
          payments: payments.get(invoice.id) || [],
        },
      ]),
    );
  }, [query.data]);
  if (query.loading)
    return (
      <main className="student-workspace">
        <LoadingSkeleton />
      </main>
    );
  if (query.error)
    return (
      <main className="student-workspace">
        <ErrorState message={query.error.message} onRetry={query.reload} />
      </main>
    );
  return (
    <main className="student-workspace">
      <PageHeader
        eyebrow="YOUR ACCOUNT"
        title="My hostel fees"
        description="View your invoices, due dates, adjustments and payment history."
      />
      {!query.data.invoices.length ? (
        <EmptyState
          title="No invoices yet"
          description="Your hostel administration will publish invoices after assigning the applicable fee plan."
        />
      ) : (
        query.data.invoices.map((invoice) => {
          const details = history.get(invoice.id);
          return (
            <article className="panel phase-panel" key={invoice.id}>
              <header className="section-heading">
                <div>
                  <h2>
                    {invoice.plan_name}{" "}
                    <span className="badge subtle">
                      {invoice.payment_status.replaceAll("_", " ")}
                    </span>
                  </h2>
                  <p>
                    {invoice.student_number} · {invoice.room_label} ·{" "}
                    {invoice.academic_term}
                  </p>
                </div>
                <button
                  className="button button-outline"
                  onClick={() => window.print()}
                >
                  Print invoice
                </button>
              </header>
              <dl className="fee-breakdown">
                <div>
                  <dt>Billing period</dt>
                  <dd>{invoice.billing_period}</dd>
                </div>
                <div>
                  <dt>Due date</dt>
                  <dd>{invoice.due_date}</dd>
                </div>
                <div>
                  <dt>Original charge</dt>
                  <dd>
                    {money(
                      invoice.base_amount,
                      invoice.currency_code,
                      invoice.currency_minor_units,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Approved discounts / waivers</dt>
                  <dd>
                    {money(
                      invoice.base_amount - invoice.amount_due,
                      invoice.currency_code,
                      invoice.currency_minor_units,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Total due</dt>
                  <dd>
                    {money(
                      invoice.amount_due,
                      invoice.currency_code,
                      invoice.currency_minor_units,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Verified payments</dt>
                  <dd>
                    {money(
                      invoice.amount_paid,
                      invoice.currency_code,
                      invoice.currency_minor_units,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Outstanding balance</dt>
                  <dd>
                    <strong>
                      {money(
                        invoice.balance,
                        invoice.currency_code,
                        invoice.currency_minor_units,
                      )}
                    </strong>
                  </dd>
                </div>
              </dl>
              {details.adjustments.length > 0 && (
                <>
                  <h3>Adjustments</h3>
                  <ul>
                    {details.adjustments.map((a) => (
                      <li key={a.id}>
                        {money(
                          a.amount,
                          invoice.currency_code,
                          invoice.currency_minor_units,
                        )}{" "}
                        — {a.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3>Payment history</h3>
              {details.payments.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.paid_on}</td>
                          <td>
                            {money(
                              p.amount,
                              invoice.currency_code,
                              invoice.currency_minor_units,
                            )}
                          </td>
                          <td>{p.payment_method}</td>
                          <td>{p.status.replaceAll("_", " ")}</td>
                          <td>{p.reference_number}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No payments recorded.</p>
              )}
              <p>
                To make a payment or ask about a balance, contact your hostel
                administration. Pending payments are not included in the amount
                paid until verified.
              </p>
            </article>
          );
        })
      )}
    </main>
  );
}
