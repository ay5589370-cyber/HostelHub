import { useCallback, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
} from "../../components/common/Feedback";
import { useQuery } from "../../hooks/useQuery";
import { downloadCsv } from "../../lib/csvExport";
import { loadReport } from "../../services/reports";

const reports = [
  ["students", "Student directory & admissions"],
  ["occupancy", "Occupancy & allocations"],
  ["leaves", "Leave history"],
  ["fees", "Invoices & balances"],
  ["payments", "Payment records"],
  ["complaints", "Complaints & resolution"],
  ["mess", "Mess feedback"],
  ["audit", "Operational audit activity"],
  ["gate", "Gate events"],
];
const columnsByReport = {
  students: [
    ["student_id", "Student ID"],
    ["full_name", "Name"],
    ["course", "Course"],
    ["branch", "Branch"],
    ["semester", "Semester"],
    ["status", "Admission status"],
    ["admission_date", "Admission date"],
    ["hostel_name", "Hostel"],
    ["block", "Block"],
    ["room_number", "Room"],
    ["bed_number", "Bed"],
    ["invitation_status", "Invitation status"],
    ["created_at", "Created"],
  ],
  occupancy: [
    ["hostel", "Hostel"],
    ["block", "Block"],
    ["room_type", "Room type"],
    ["room", "Room"],
    ["bed", "Bed"],
    ["hostel_status", "Hostel status"],
    ["room_status", "Room status"],
    ["bed_status", "Bed status"],
    ["allocation_status", "Allocation"],
    ["student_number", "Student ID"],
    ["student_name", "Student"],
  ],
  leaves: [
    ["request_number", "Request"],
    ["student_number", "Student ID"],
    ["student_name", "Student"],
    ["leave_type", "Type"],
    ["status", "Status"],
    ["departure_at", "Departure"],
    ["expected_return_at", "Expected return"],
    ["destination", "Destination"],
    ["history_count", "History entries"],
  ],
  fees: [
    ["student_number", "Student ID"],
    ["student_name", "Student"],
    ["room_label", "Room"],
    ["plan_name", "Fee plan"],
    ["academic_term", "Term"],
    ["billing_period", "Period"],
    ["base_amount", "Original charge"],
    ["amount_due", "Amount due"],
    ["amount_paid", "Verified paid"],
    ["balance", "Balance"],
    ["currency_code", "Currency"],
    ["due_date", "Due date"],
    ["payment_status", "Status"],
  ],
  payments: [
    ["paid_on", "Paid on"],
    ["student_number", "Student ID"],
    ["student_name", "Student"],
    ["academic_term", "Term"],
    ["amount", "Amount"],
    ["currency_code", "Currency"],
    ["payment_method", "Method"],
    ["status", "Verification status"],
  ],
  complaints: [
    ["complaint_number", "Complaint"],
    ["student_number", "Student ID"],
    ["student_name", "Student"],
    ["title", "Title"],
    ["category", "Category"],
    ["priority", "Priority"],
    ["status", "Status"],
    ["room_label", "Room"],
    ["created_at", "Submitted"],
    ["resolved_at", "Resolved"],
    ["resolution_hours", "Resolution hours"],
  ],
  mess: [
    ["meal_date", "Meal date"],
    ["meal_slot", "Meal"],
    ["rating", "Rating"],
    ["category", "Category"],
    ["comments", "Comment"],
    ["submitted_at", "Submitted"],
  ],
  audit: [
    ["source", "Module"],
    ["event", "Event"],
    ["created_at", "Recorded"],
  ],
};
const statusOptions = {
  students: ["active", "inactive", "archived"],
  leaves: [
    "pending",
    "approved",
    "rejected",
    "cancelled",
    "completed",
    "overdue",
  ],
  fees: ["pending", "partially_paid", "paid", "overdue"],
  payments: ["pending_verification", "verified", "rejected", "reversed"],
  complaints: [
    "submitted",
    "acknowledged",
    "in_progress",
    "on_hold",
    "resolved",
    "closed",
  ],
};
const initialFilters = {
  from: "",
  to: "",
  status: "",
  category: "",
  search: "",
  hostel: "",
  roomType: "",
  mealSlot: "",
  rating: "",
};
const asColumns = (columns = []) =>
  columns.map(([key, label]) => ({ key, label }));
const dateTime = (v) => (v ? new Date(v).toLocaleString() : "—");

export default function AdminReports() {
  const [report, setReport] = useState("students");
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(0);
  const fetcher = useCallback(
    () => loadReport(report, filters),
    [report, filters],
  );
  const query = useQuery(fetcher);
  const allRows = useMemo(() => query.data?.rows || [], [query.data]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(allRows.length / pageSize));
  const rows = useMemo(
    () => allRows.slice(page * pageSize, (page + 1) * pageSize),
    [allRows, page],
  );
  const columns = asColumns(columnsByReport[report]);
  const filterReport = (event) => {
    event.preventDefault();
    setFilters({ ...draft });
    setPage(0);
  };
  const changeReport = (value) => {
    setReport(value);
    setDraft(initialFilters);
    setFilters(initialFilters);
    setPage(0);
  };
  const exportReport = () => {
    if (
      !columns.length ||
      !query.data?.available ||
      (query.data?.truncated && report !== "audit")
    )
      return;
    downloadCsv(
      `hostelhub-${report}-${new Date().toISOString().slice(0, 10)}.csv`,
      allRows,
      columns,
      {
        Report: reports.find(([id]) => id === report)?.[1],
        Filters: JSON.stringify(filters),
        Records: allRows.length,
      },
    );
  };
  const grouped = query.data?.summary || [];
  return (
    <>
      <PageHeader
        eyebrow="CAMPUS OPERATIONS"
        title="Reports & analytics"
        description="Review authorized operational records and export filtered CSV reports. Metrics come from existing hostel records and module workflows."
      />
      <section className="panel phase-panel">
        <div className="report-toolbar">
          <label>
            Report
            <select
              value={report}
              onChange={(e) => changeReport(e.target.value)}
            >
              {reports.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() => void query.reload()}
            disabled={query.loading}
          >
            <RefreshCw size={15} /> Refresh
          </Button>
          <Button
            onClick={exportReport}
            disabled={
              query.loading ||
              !columns.length ||
              !query.data?.available ||
              (query.data?.truncated && report !== "audit")
            }
          >
            <Download size={15} /> Export CSV
          </Button>
        </div>
        <form className="report-filters" onSubmit={filterReport}>
          {!["occupancy", "gate"].includes(report) && (
            <>
              <label>
                From
                <input
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </label>
            </>
          )}
          {statusOptions[report] && (
            <label>
              Status
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="">All statuses</option>
                {statusOptions[report].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {report === "complaints" && (
            <label>
              Category
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
              >
                <option value="">All categories</option>
                {[
                  "plumbing",
                  "electrical",
                  "cleanliness",
                  "furniture",
                  "internet",
                  "security",
                  "other",
                  "mess_food_quality",
                  "mess_hygiene",
                  "mess_menu_mismatch",
                  "mess_meal_timing",
                  "mess_service_issue",
                  "mess_other",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {report === "occupancy" && (
            <>
              <label>
                Hostel
                <input
                  value={draft.hostel}
                  onChange={(e) =>
                    setDraft({ ...draft, hostel: e.target.value })
                  }
                  placeholder="Hostel name contains"
                />
              </label>
              <label>
                Room type
                <input
                  value={draft.roomType}
                  onChange={(e) =>
                    setDraft({ ...draft, roomType: e.target.value })
                  }
                  placeholder="Exact room type"
                />
              </label>
            </>
          )}
          {report === "mess" && (
            <>
              <label>
                Meal slot
                <select
                  value={draft.mealSlot}
                  onChange={(e) =>
                    setDraft({ ...draft, mealSlot: e.target.value })
                  }
                >
                  <option value="">All meals</option>
                  {["breakfast", "lunch", "evening_snacks", "dinner"].map(
                    (value) => (
                      <option key={value} value={value}>
                        {value.replaceAll("_", " ")}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Rating
                <select
                  value={draft.rating}
                  onChange={(e) =>
                    setDraft({ ...draft, rating: e.target.value })
                  }
                >
                  <option value="">Any rating</option>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {!["audit", "gate"].includes(report) && (
            <label>
              Search
              <input
                value={draft.search}
                onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                placeholder="Search report records"
              />
            </label>
          )}
          <Button type="submit">Apply filters</Button>
        </form>
        {query.loading ? (
          <LoadingSkeleton />
        ) : query.error ? (
          <ErrorState message={query.error.message} onRetry={query.reload} />
        ) : query.data?.available === false ? (
          <EmptyState
            title="Report unavailable"
            description={
              query.data.notice ||
              "The required module is not available or the current policies do not authorize this report."
            }
          />
        ) : (
          <>
            {query.data?.notice && (
              <p className="notice" role="status">
                {query.data.notice}
              </p>
            )}
            {report === "complaints" && query.data?.analytics && (
              <>
                <p className="report-footnote">
                  Complaint counts and response/resolution averages use the
                  selected date range. Status, category, and search filters
                  apply to the report rows. Open maintenance task counts use
                  task creation dates in that range; upcoming visits count the
                  next seven days.
                </p>
                <div className="report-metrics">
                  <article>
                    <span>Open maintenance tasks</span>
                    <strong>{query.data.analytics.maintenance.open}</strong>
                  </article>
                  <article>
                    <span>Upcoming maintenance visits · 7 days</span>
                    <strong>
                      {query.data.analytics.maintenance.upcoming_visits_7_days}
                    </strong>
                  </article>
                  <article>
                    <span>Average first staff reply · minutes</span>
                    <strong>
                      {query.data.analytics.complaints
                        .average_first_staff_reply_minutes ?? "—"}
                    </strong>
                  </article>
                  <article>
                    <span>Average resolution · hours</span>
                    <strong>
                      {query.data.analytics.complaints
                        .average_resolution_hours ?? "—"}
                    </strong>
                  </article>
                </div>
              </>
            )}
            {query.data?.truncated && report !== "audit" && (
              <p className="notice" role="status">
                The report reached its local 20,000-row safety limit. The
                displayed/exported subset is incomplete; narrow the filters
                before exporting.
              </p>
            )}
            {report === "occupancy" && (
              <section className="report-summary">
                <h2>Occupancy by hostel and room type</h2>
                {grouped.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Hostel</th>
                          <th>Block</th>
                          <th>Room type</th>
                          <th>Beds</th>
                          <th>Occupied</th>
                          <th>Available</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped.map((row, i) => (
                          <tr
                            key={`${row.hostel}-${row.block}-${row.room_type}-${i}`}
                          >
                            <td>{row.hostel}</td>
                            <td>{row.block}</td>
                            <td>{row.room_type}</td>
                            <td>{row.beds}</td>
                            <td>{row.occupied}</td>
                            <td>{row.available}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>No bed records match these filters.</p>
                )}
                <p>
                  Occupied means an active allocation references the bed.
                  Available means the bed is marked available and has no active
                  allocation.
                </p>
              </section>
            )}
            {report === "mess" && allRows.length > 0 && (
              <p className="notice">
                Mean rating{" "}
                {(
                  allRows.reduce((sum, row) => sum + Number(row.rating), 0) /
                  allRows.length
                ).toFixed(2)}{" "}
                / 5 from {allRows.length} feedback submissions in the filtered
                range. Feedback rows do not include student identity.
              </p>
            )}
            <div className="report-count">
              {allRows.length} record(s)
              {query.data?.truncated ? " · partial result" : ""} · Page{" "}
              {page + 1} of {pageCount}
            </div>
            {rows.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={
                          row.id ||
                          row.request_number ||
                          row.complaint_number ||
                          `${row.created_at || row.meal_date || "row"}-${i}`
                        }
                      >
                        {columns.map((column) => (
                          <td key={column.key}>
                            {column.key.endsWith("_at")
                              ? dateTime(row[column.key])
                              : (row[column.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No records found"
                description="No authorized records match the selected report and filters."
              />
            )}
            <div className="form-actions">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>
      <p className="report-footnote">
        CSV files include the export timestamp and applied filters. Spreadsheet
        formula-leading values are escaped. No PDF export is implemented. Gate
        events are unavailable to admins under the current Phase 4 RLS rules.
      </p>
    </>
  );
}
