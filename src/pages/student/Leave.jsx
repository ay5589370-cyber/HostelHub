import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarClock,
  Clock3,
  FileUp,
  History,
  Search,
  Eye,
  QrCode,
} from "lucide-react";
import { toast } from "sonner";
import { QrPassModal } from "../../components/gate/QrPassModal";
import {
  Logo,
  ThemeToggle,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import {
  leaveFormSchema,
  leaveTypes,
  formatLeaveStatus,
  validateLeaveFiles,
} from "../../lib/leaveValidation";
import {
  listStudentLeaves,
  submitLeave,
  uploadLeaveDocuments,
  cancelLeave,
  subscribeLeaves,
  signedLeaveDocumentUrl,
} from "../../services/leaves";
import { useQuery } from "../../hooks/useQuery";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

const localValue = (hours) => {
  const d = new Date(Date.now() + hours * 3600000);
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

export default function Leave({ history = false }) {
  const { logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialType =
    searchParams.get("type") === "night_out" ? "night_out" : "day_out";
  const [type, setType] = useState(initialType);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [cancelId, setCancelId] = useState(null);
  const [status, setStatus] = useState("");
  const [leaveTypeFilter, setLeaveTypeFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [confirmPayload, setConfirmPayload] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [passRequestId, setPassRequestId] = useState(null);

  const form = useForm({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: {
      leave_type: initialType,
      departure_local: localValue(2),
      expected_return_local: localValue(10),
      destination: "",
      reason: "",
      emergency_contact: "",
      rules_confirmed: false,
    },
  });

  const fetcher = useCallback(
    () =>
      listStudentLeaves({
        status,
        leaveType: leaveTypeFilter,
        search: searchTerm,
        page,
      }),
    [status, leaveTypeFilter, searchTerm, page],
  );
  const requests = useQuery(fetcher);

  useEffect(() => subscribeLeaves(requests.reload), [requests.reload]);
  const requestFromUrl = searchParams.get("request");
  useEffect(() => {
    const match = requests.data?.rows?.find(
      (request) => request.id === requestFromUrl,
    );
    if (match) setSelectedRequest(match);
  }, [requestFromUrl, requests.data?.rows]);

  const chooseType = (next) => {
    setType(next);
    form.setValue("leave_type", next);
    form.setValue(
      "expected_return_local",
      localValue(next === "day_out" ? 10 : 48),
    );
  };

  const onPreSubmit = (values) => {
    setConfirmPayload({ ...values, request_nonce: crypto.randomUUID() });
  };

  const executeSubmit = async () => {
    if (!confirmPayload || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    try {
      const result = await submitLeave(confirmPayload);
      if (files.length) {
        await uploadLeaveDocuments(
          { id: result.id, student_id: result.student_id },
          files,
        );
      }
      toast.success(`Request ${result.request_number} submitted successfully`);
      form.reset({
        ...form.formState.defaultValues,
        leave_type: type,
        departure_local: localValue(2),
        expected_return_local: localValue(type === "day_out" ? 10 : 48),
      });
      setFiles([]);
      setConfirmPayload(null);
      requests.reload();
    } catch (error) {
      toast.error(error.message || "Failed to submit leave request");
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  const selectFiles = (event) => {
    const chosen = Array.from(event.target.files || []);
    try {
      validateLeaveFiles(chosen);
      setFiles(chosen);
    } catch (error) {
      event.target.value = "";
      toast.error(error.message);
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
  const closeRequestDetails = () => {
    setSelectedRequest(null);
    if (searchParams.has("request")) {
      const next = new URLSearchParams(searchParams);
      next.delete("request");
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <main className="student-workspace">
      <header>
        <Logo />
        <nav>
          <Link to="/student/dashboard">Dashboard</Link>
          <Link to="/student/profile">My profile</Link>
          <Link to="/student/leave">Leave</Link>
          <Link to="/student/complaints">Complaints</Link>
          <ThemeToggle />
          <Button
            variant="outline"
            onClick={() => logout().catch((e) => toast.error(e.message))}
          >
            Sign out
          </Button>
        </nav>
      </header>
      <section className="student-profile leave-page">
        <div className="page-header">
          <div>
            <div className="eyebrow">RESIDENT SERVICES</div>
            <h1>{history ? "Leave request history" : "Plan a leave"}</h1>
            <p>
              {history
                ? "Track every request and its review outcome."
                : "Submit a day-out or night-out request for hostel review."}
            </p>
          </div>
          {!history && (
            <Link className="button button-outline" to="/student/leave/history">
              <History size={16} /> View history
            </Link>
          )}
        </div>

        {!history && (
          <form
            className="panel phase-panel leave-form"
            onSubmit={form.handleSubmit(onPreSubmit)}
          >
            <div className="leave-form-heading">
              <span className="eyebrow">NEW APPLICATION</span>
              <h2>Leave application</h2>
              <p>Choose a leave type and provide the details for hostel review.</p>
            </div>
            <div className="leave-type-toggle" role="group" aria-label="Leave type">
              {leaveTypes.map((value) => (
                <Button
                  className={"leave-type-option" + (type === value ? " selected" : "")}
                  type="button"
                  key={value}
                  variant="outline"
                  aria-pressed={type === value}
                  onClick={() => chooseType(value)}
                >
                  {value === "day_out" ? <CalendarClock size={19} /> : <Clock3 size={19} />}
                  <span>
                    <strong>{value === "day_out" ? "Day-Out" : "Night-Out"}</strong>
                    <small>{value === "day_out" ? "Return the same day" : "Return on a later date"}</small>
                  </span>
                </Button>
              ))}
            </div>
            <div className="form-grid">
              <Field
                label="Departure"
                error={form.formState.errors.departure_local?.message}
              >
                <input
                  type="datetime-local"
                  {...form.register("departure_local")}
                />
              </Field>
              <Field
                label="Expected return"
                error={form.formState.errors.expected_return_local?.message}
              >
                <input
                  type="datetime-local"
                  {...form.register("expected_return_local")}
                />
              </Field>
              <Field
                label="Destination"
                error={form.formState.errors.destination?.message}
              >
                <input
                  placeholder="Where will you be?"
                  {...form.register("destination")}
                />
              </Field>
              <Field
                label="Emergency contact"
                error={form.formState.errors.emergency_contact?.message}
              >
                <input
                  inputMode="tel"
                  placeholder="Parent or guardian phone"
                  {...form.register("emergency_contact")}
                />
              </Field>
            </div>
            <Field
              label="Reason for leave"
              error={form.formState.errors.reason?.message}
            >
              <textarea
                className="leave-reason-input"
                rows="4"
                placeholder="Share the reason for your request"
                {...form.register("reason")}
              />
            </Field>
            <label className="upload-control">
              <span className="upload-control-icon"><FileUp size={18} /></span>
              <span className="upload-control-copy">
                <strong>Supporting documents <small>(optional)</small></strong>
                <small>PDF, JPG, PNG or WebP · up to 3 files · 5 MB each</small>
              </span>
              <span className="upload-control-action">Choose files</span>
              <input
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={selectFiles}
              />
            </label>
            {files.length > 0 && (
              <div className="leave-selected-files" aria-label="Selected files">
                {files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}
              </div>
            )}
            <label className="checkbox-row">
              <input type="checkbox" {...form.register("rules_confirmed")} />
              <span>I understand and will follow the hostel leave rules.</span>
            </label>
            {form.formState.errors.rules_confirmed && (
              <p className="form-error">
                {form.formState.errors.rules_confirmed.message}
              </p>
            )}
            <div className="form-actions leave-form-actions">
              <Button disabled={busy}>
                {busy ? "Submitting…" : "Review & Submit"}
              </Button>
            </div>
          </form>
        )}

        <section className="panel phase-panel">
          <div className="section-title">
            <div>
              <h2>{history ? "All requests" : "Recent requests"}</h2>
              <p>Times are shown in your local timezone.</p>
            </div>
            {history && (
              <div
                className="directory-filters"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  marginTop: "8px",
                  marginBottom: "8px",
                  width: "100%",
                }}
              >
                <label>
                  <span>
                    <Search size={14} /> Search
                  </span>
                  <input
                    value={searchTerm}
                    placeholder="Destination or request #"
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <label>
                  Status
                  <select
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">All statuses</option>
                    {[
                      "pending",
                      "approved",
                      "rejected",
                      "cancelled",
                      "completed",
                      "overdue",
                    ].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Leave type
                  <select
                    value={leaveTypeFilter}
                    onChange={(e) => {
                      setLeaveTypeFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">All types</option>
                    <option value="day_out">Day-out</option>
                    <option value="night_out">Night-out</option>
                  </select>
                </label>
              </div>
            )}
          </div>

      {requests.loading ? (
            <LoadingSkeleton />
          ) : requests.error ? (
            <ErrorState
              message={requests.error.message}
              onRetry={requests.reload}
            />
          ) : !requests.data.rows.length ? (
            <EmptyState
              icon={CalendarClock}
              title="No leave requests"
              description="Your submitted requests will appear here."
            />
          ) : (
            <div className="leave-list">
              {requests.data.rows
                .slice(0, history ? undefined : 5)
                .map((request) => (
                  <article className="leave-card" key={request.id}>
                    <div>
                      <strong>{request.request_number}</strong>
                      <span className={`status-pill ${request.status}`}>
                        {formatLeaveStatus(request.status)}
                      </span>
                    </div>
                    <p>
                      {request.leave_type.replace("_", " ")} ·{" "}
                      {new Date(request.departure_at).toLocaleString()} →{" "}
                      {new Date(request.expected_return_at).toLocaleString()}
                    </p>
                    <p>
                      <b>Destination:</b> {request.destination}
                    </p>
                    <small style={{ color: "var(--muted)" }}>
                      Submitted: {new Date(request.created_at).toLocaleString()}
                    </small>
                    {request.admin_remarks && (
                      <p className="leave-remarks">
                        <b>Remarks:</b> {request.admin_remarks}
                      </p>
                    )}
                    <div className="leave-card-actions">
                      <Button
                        variant="outline"
                        onClick={() => setSelectedRequest(request)}
                      >
                        <Eye size={14} /> View details
                      </Button>
                      {["approved", "completed"].includes(request.status) && (
                        <Button
                          variant="primary"
                          onClick={() => setPassRequestId(request.id)}
                        >
                          <QrCode size={14} /> Gate Pass
                        </Button>
                      )}
                      {request.status === "pending" && (
                        <Button
                          variant="danger"
                          onClick={() => setCancelId(request.id)}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
            </div>
          )}
          {history && requests.data && !requests.loading && (
            <div className="form-actions">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </Button>
              <span>
                {requests.data.count} requests · Page {page + 1}
              </span>
              <Button
                variant="outline"
                disabled={(page + 1) * 20 >= requests.data.count}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </section>
      </section>

      {/* Pre-submission Review & Confirmation Dialog */}
      <ConfirmDialog
        open={!!confirmPayload}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmPayload(null);
        }}
        title="Review & Confirm Leave Request"
        description="Please verify your details before submitting to hostel administration."
        confirmLabel="Confirm & Submit"
        confirmVariant="default"
        busy={busy}
        onConfirm={executeSubmit}
      >
        {confirmPayload && (
          <div
            style={{
              marginTop: "12px",
              marginBottom: "12px",
              display: "grid",
              gap: "8px",
              fontSize: "13px",
              background: "var(--surface)",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
            }}
          >
            <div>
              <b>Leave Type:</b>{" "}
              {confirmPayload.leave_type === "day_out"
                ? "Day-Out"
                : "Night-Out"}
            </div>
            <div>
              <b>Schedule:</b>{" "}
              {new Date(confirmPayload.departure_local).toLocaleString()} →{" "}
              {new Date(confirmPayload.expected_return_local).toLocaleString()}
            </div>
            <div>
              <b>Destination:</b> {confirmPayload.destination}
            </div>
            <div>
              <b>Emergency Contact:</b> {confirmPayload.emergency_contact}
            </div>
            <div>
              <b>Reason:</b> {confirmPayload.reason}
            </div>
            <div>
              <b>Attachments:</b>{" "}
              {files.length > 0 ? files.map((f) => f.name).join(", ") : "None"}
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* Request Details & History Modal */}
      {selectedRequest && (
        <aside className="leave-review panel">
          <div className="leave-review-title">
            <div>
              <div className="eyebrow">REQUEST DETAILS</div>
              <h2>{selectedRequest.request_number}</h2>
            </div>
            <Button variant="outline" onClick={closeRequestDetails}>
              Close
            </Button>
          </div>
          <div className="review-grid">
            <p>
              <b>Leave Type</b>
              <span className="leave-detail-value">
                {selectedRequest.leave_type.replace("_", " ")}
              </span>
            </p>
            <p>
              <b>Status</b>
              <span className={`status-pill ${selectedRequest.status}`}>
                {formatLeaveStatus(selectedRequest.status)}
              </span>
            </p>
            <p className="wide">
              <b>Schedule</b>
              <span className="leave-detail-value">
                {new Date(selectedRequest.departure_at).toLocaleString()} →{" "}
                {new Date(selectedRequest.expected_return_at).toLocaleString()}
              </span>
            </p>
            <p>
              <b>Submitted On</b>
              <span className="leave-detail-value">
                {new Date(selectedRequest.created_at).toLocaleString()}
              </span>
            </p>
            <p>
              <b>Destination</b>
              <span className="leave-detail-value">{selectedRequest.destination}</span>
            </p>
            <p>
              <b>Emergency Contact</b>
              <span className="leave-detail-value">
                {selectedRequest.emergency_contact || "—"}
              </span>
            </p>
            <p className="wide">
              <b>Reason</b>
              <span className="leave-detail-value">{selectedRequest.reason}</span>
            </p>
            {selectedRequest.admin_remarks && (
              <p className="wide leave-remarks">
                <b>Administrator Remarks</b>
                <span className="leave-detail-value">{selectedRequest.admin_remarks}</span>
              </p>
            )}
          </div>

          {selectedRequest.leave_request_documents?.length > 0 && (
            <div className="leave-detail-documents">
              <b>ATTACHED SUPPORTING DOCUMENTS</b>
              <div className="leave-detail-actions">
                {selectedRequest.leave_request_documents.map((doc) => (
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

          {selectedRequest.leave_request_history?.length > 0 && (
            <div className="leave-detail-history">
              <b>STATUS HISTORY</b>
              <div className="leave-history-list">
                {selectedRequest.leave_request_history.map((h) => (
                  <div key={h.id} className="leave-history-item">
                    <div className="leave-history-header">
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
                    {h.remarks && <p className="leave-history-remarks">{h.remarks}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {["approved", "completed"].includes(selectedRequest.status) && (
            <div className="leave-review-actions">
              <Button
                variant="primary"
                onClick={() => setPassRequestId(selectedRequest.id)}
              >
                <QrCode size={16} /> View Gate Pass & QR Code
              </Button>
            </div>
          )}

          {selectedRequest.status === "pending" && (
            <div className="leave-review-actions">
              <Button
                variant="danger"
                onClick={() => {
                  setCancelId(selectedRequest.id);
                  setSelectedRequest(null);
                }}
              >
                Cancel this request
              </Button>
            </div>
          )}
        </aside>
      )}

      {/* Cancellation confirmation */}
      <ConfirmDialog
        open={!!cancelId}
        onOpenChange={(open) => !open && setCancelId(null)}
        title="Cancel leave request?"
        description="Pending requests can be cancelled and this action will be recorded in the status history."
        confirmLabel="Cancel request"
        confirmVariant="danger"
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await cancelLeave(cancelId);
            toast.success("Leave request cancelled");
            setCancelId(null);
            requests.reload();
          } catch (error) {
            toast.error(error.message);
          } finally {
            setBusy(false);
          }
        }}
      />

      {/* Smart Gate Pass Modal */}
      <QrPassModal
        leaveRequestId={passRequestId}
        open={!!passRequestId}
        onClose={() => setPassRequestId(null)}
      />
    </main>
  );
}

function Field({ label, error, children }) {
  return (
    <label className="form-field">
      <span className="form-field-label">
        {label}<span className="required"> *</span>
      </span>
      {children}
      {error && <small className="form-error">{error}</small>}
    </label>
  );
}
