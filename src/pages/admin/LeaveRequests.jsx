import { useCallback, useEffect, useState } from "react";
import { Eye, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
} from "../../components/common/Feedback";
import { useQuery } from "../../hooks/useQuery";
import { formatLeaveStatus, leaveStatuses } from "../../lib/leaveValidation";
import {
  decideLeave,
  getLeave,
  getLeaveDashboard,
  listAdminLeaves,
  signedLeaveDocumentUrl,
  subscribeLeaves,
} from "../../services/leaves";

const leaveMetricFilters = {
  Pending: "pending",
  Approved: "approved",
  Rejected: "rejected",
};

export default function LeaveRequests() {
  const [filters, setFilters] = useState({
    status: "",
    leaveType: "",
    search: "",
    sort: "created_at",
    ascending: false,
    page: 0,
  });
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(() => listAdminLeaves(filters), [filters]);
  const requests = useQuery(fetcher);
  const dashboard = useQuery(getLeaveDashboard);
  const reloadRequests = requests.reload;
  const reloadDashboard = dashboard.reload;

  useEffect(
    () =>
      subscribeLeaves(() => {
        reloadRequests();
        reloadDashboard();
      }),
    [reloadRequests, reloadDashboard],
  );

  const change = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value, page: 0 }));

  const review = async () => {
    if (decision === "rejected" && remarks.trim().length < 3) {
      return toast.error("Please provide a rejection reason of at least 3 characters.");
    }
    setBusy(true);
    try {
      await decideLeave(selected.id, decision, remarks);
      toast.success(`Request ${selected.request_number} ${decision}`);
      setDecision(null);
      setSelected(null);
      setRemarks("");
      requests.reload();
      dashboard.reload();
    } catch (error) {
      toast.error(error.message || "Failed to update leave request");
      requests.reload();
      dashboard.reload();
      if (selected?.id) {
        try {
          setSelected(await getLeave(selected.id));
        } catch {
          setSelected(null);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const openRequest = async (request) => {
    setBusy(true);
    try {
      setSelected(await getLeave(request.id));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const viewDocument = async (path) => {
    try {
      window.open(
        await signedLeaveDocumentUrl(path),
        "_blank",
        "noopener,noreferrer",
      );
    } catch (error) {
      toast.error(error.message);
    }
  };

  const activeAllocation =
    selected?.students?.bed_allocations?.find((a) => a.status === "active") ||
    selected?.students?.bed_allocations?.[0];
  const roomBedDisplay = activeAllocation?.beds?.rooms
    ? `${activeAllocation.beds.rooms.hostels?.name || "Hostel"} ${activeAllocation.beds.rooms.hostels?.block || ""} · Room ${activeAllocation.beds.rooms.room_number}, Bed ${activeAllocation.beds.bed_number}`
    : "Unassigned";

  return (
    <div className="admin-leave-page">
      <PageHeader
        eyebrow="RESIDENT SERVICES"
        title="Leave requests"
        description="Review student day-out and night-out requests with a complete audit trail."
      />
      <section className="leave-summary-strip" aria-label="Leave request summary">
        {[
          ["Pending", dashboard.data?.pending],
          ["Approved", dashboard.data?.approved],
          ["Rejected", dashboard.data?.rejected],
          ["Upcoming departures", dashboard.data?.upcoming],
          ["Overdue", dashboard.data?.overdue],
        ].map(([label, value]) => (
          leaveMetricFilters[label] ? (
            <button
              key={label}
              type="button"
              className="leave-summary-item is-filter"
              aria-pressed={filters.status === leaveMetricFilters[label]}
              onClick={() => change("status", filters.status === leaveMetricFilters[label] ? "" : leaveMetricFilters[label])}
            >
              <span>{label}</span>
              <strong>{dashboard.loading ? "…" : value || 0}</strong>
            </button>
          ) : (
            <div key={label} className="leave-summary-item">
              <span>{label}</span>
              <strong>{dashboard.loading ? "…" : value || 0}</strong>
            </div>
          )
        ))}
      </section>

      <section className="panel phase-panel">
        <div className="directory-filters">
          <label>
            <span>
              <Search size={14} /> Search
            </span>
            <input
              value={filters.search}
              placeholder="Student name or ID"
              onChange={(e) => change("search", e.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="">All</option>
              {leaveStatuses.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Leave type
            <select
              value={filters.leaveType}
              onChange={(e) => change("leaveType", e.target.value)}
            >
              <option value="">All</option>
              <option value="day_out">Day-out</option>
              <option value="night_out">Night-out</option>
            </select>
          </label>
          <label>
            Sort
            <select
              value={`${filters.sort}:${filters.ascending}`}
              onChange={(e) => {
                const [sort, ascending] = e.target.value.split(":");
                setFilters((current) => ({
                  ...current,
                  sort,
                  ascending: ascending === "true",
                  page: 0,
                }));
              }}
            >
              <option value="created_at:false">Newest submitted</option>
              <option value="departure_at:true">Departure soonest</option>
              <option value="expected_return_at:true">Return soonest</option>
            </select>
          </label>
        </div>

        {requests.loading ? (
          <LoadingSkeleton />
        ) : requests.error ? (
          <ErrorState message={requests.error.message} onRetry={requests.reload} />
        ) : !requests.data.rows.length ? (
          <EmptyState
            title="No leave requests"
            description="Requests submitted by residents will appear here."
          />
        ) : (
          <div className="table-scroll">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Student</th>
                  <th>Leave</th>
                  <th>Departure</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {requests.data.rows.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <strong>{request.request_number}</strong>
                      <small>
                        {new Date(request.created_at).toLocaleString()}
                      </small>
                    </td>
                    <td>
                      <strong>{request.students?.full_name}</strong>
                      <small>{request.students?.student_id}</small>
                    </td>
                    <td>
                      {request.leave_type.replace("_", " ")}
                      <small>{request.destination}</small>
                    </td>
                    <td>{new Date(request.departure_at).toLocaleString()}</td>
                    <td>
                      <span className={`status-pill ${request.status}`}>
                        {formatLeaveStatus(request.status)}
                      </span>
                    </td>
                    <td>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void openRequest(request)}
                      >
                        <Eye size={15} /> Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="form-actions">
          <Button
            variant="outline"
            disabled={!filters.page || requests.loading}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                page: current.page - 1,
              }))
            }
          >
            Previous
          </Button>
          <span>
            {requests.data?.count ?? "…"} requests · Page {filters.page + 1}
          </span>
          <Button
            variant="outline"
            disabled={
              requests.loading ||
              !requests.data ||
              (filters.page + 1) * 20 >= requests.data.count
            }
            onClick={() =>
              setFilters((current) => ({
                ...current,
                page: current.page + 1,
              }))
            }
          >
            Next
          </Button>
        </div>
      </section>

      {selected && (
        <aside className="leave-review panel">
          <div className="section-title">
            <div>
              <div className="eyebrow">REQUEST REVIEW</div>
              <h2>{selected.request_number}</h2>
            </div>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <div className="review-grid">
            <p>
              <b>Student</b>
              {selected.students?.full_name} · {selected.students?.student_id}
            </p>
            <p>
              <b>Academic</b>
              {selected.students?.course} · Semester {selected.students?.semester}
            </p>
            <p>
              <b>Hostel & Bed</b>
              {roomBedDisplay}
            </p>
            <p>
              <b>Status</b>
              <span className={`status-pill ${selected.status}`}>
                {formatLeaveStatus(selected.status)}
              </span>
            </p>
            <p className="wide">
              <b>Schedule</b>
              {new Date(selected.departure_at).toLocaleString()} →{" "}
              {new Date(selected.expected_return_at).toLocaleString()}
            </p>
            <p>
              <b>Destination</b>
              {selected.destination}
            </p>
            <p>
              <b>Emergency contact</b>
              {selected.emergency_contact || "—"}
            </p>
            <p className="wide">
              <b>Reason</b>
              {selected.reason}
            </p>
            {selected.admin_remarks && (
              <p className="wide leave-remarks">
                <b>Reviewer remarks</b>
                {selected.admin_remarks}
              </p>
            )}
          </div>

          {selected.leave_request_documents?.length > 0 && (
            <div className="leave-detail-documents">
              <b>
                SUPPORTING DOCUMENTS
              </b>
              <div className="leave-detail-actions">
                {selected.leave_request_documents.map((doc) => (
                  <Button
                    key={doc.id}
                    variant="outline"
                    onClick={() => void viewDocument(doc.object_path)}
                  >
                    Open {doc.original_name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {selected.leave_request_history?.length > 0 && (
            <div className="leave-detail-history">
              <b>
                STATUS HISTORY & AUDIT TRAIL
              </b>
              <div className="leave-detail-history-list">
                {selected.leave_request_history.map((h) => (
                  <div key={h.id} className="leave-detail-history-item">
                    <div className="leave-detail-history-heading">
                      <span className={`status-pill ${h.new_status}`}>
                        {h.previous_status
                          ? `${formatLeaveStatus(h.previous_status)} → `
                          : ""}
                        {formatLeaveStatus(h.new_status)}
                      </span>
                      <small>
                        {new Date(h.created_at).toLocaleString()}
                      </small>
                    </div>
                    {h.remarks && (
                      <p>
                        {h.remarks}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selected.status === "pending" && (
            <div className="form-actions" style={{ marginTop: "20px" }}>
              <Button onClick={() => setDecision("approved")}>Approve</Button>
              <Button variant="danger" onClick={() => setDecision("rejected")}>
                Reject
              </Button>
            </div>
          )}

          {selected.status === "approved" && (
            <div className="form-actions" style={{ marginTop: "20px" }}>
              <Button variant="danger" onClick={() => setDecision("cancelled")}>
                Revoke approval
              </Button>
            </div>
          )}
        </aside>
      )}

      <ConfirmDialog
        open={!!decision}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
            setRemarks("");
          }
        }}
        title={
          decision === "rejected"
            ? "Reject this leave request?"
            : decision === "approved"
              ? "Approve this leave request?"
              : "Revoke approval for this request?"
        }
        description={
          decision === "rejected"
            ? "A reason is required and will be displayed to the student in their leave history."
            : "This action will be recorded in the audit trail with your administrator identity and timestamp."
        }
        confirmLabel={
          decision === "rejected"
            ? "Reject request"
            : decision === "approved"
              ? "Approve request"
              : "Revoke"
        }
        confirmVariant={decision === "approved" ? "default" : "danger"}
        confirmDisabled={decision === "rejected" && remarks.trim().length < 3}
        busy={busy}
        onConfirm={review}
      >
        <div style={{ marginTop: "14px", marginBottom: "14px" }}>
          <label className="form-field">
            Administrative remarks{" "}
            {decision === "rejected" && <span className="required">*</span>}
            <textarea
              autoFocus
              rows={3}
              style={{ width: "100%", marginTop: "6px" }}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={
                decision === "rejected"
                  ? "Explain why this request is rejected (minimum 3 characters)..."
                  : "Optional note for the student..."
              }
            />
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
}
