import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import {
  ErrorState,
  LoadingSkeleton,
  PageHeader,
} from "../../components/common/Feedback";
import StaffFrame from "../../components/complaints/StaffFrame";
import { useAuth } from "../../contexts/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import {
  complaintStatuses,
  formatComplaintStatus,
} from "../../lib/complaintValidation";
import {
  addStaffComplaintMessage,
  assignComplaint,
  createMaintenanceTask,
  getComplaintStaffDirectory,
  getStaffComplaint,
  signedComplaintAttachmentUrl,
  transitionComplaint,
  updateMaintenanceTask,
} from "../../services/complaints";

const categoryLabel = (value) => value?.[0]?.toUpperCase() + value?.slice(1);
const datetimeLocal = (value) =>
  value ? new Date(value).toISOString().slice(0, 16) : "";
async function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

export default function StaffDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const [visibility, setVisibility] = useState("student");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fetcher = useCallback(() => getStaffComplaint(id), [id]);
  const query = useQuery(fetcher);
  const staffQuery = useQuery(getComplaintStaffDirectory);
  const staff = staffQuery.data || [];
  const run = async (operation, success) => {
    setBusy(true);
    try {
      await operation();
      await query.reload();
      toast.success(success);
    } catch (error) {
      toast.error(error.message || "Unable to update complaint.");
    } finally {
      setBusy(false);
    }
  };
  const openAttachment = async (file) => {
    try {
      window.open(
        await signedComplaintAttachmentUrl(file.object_path),
        "_blank",
        "noopener,noreferrer",
      );
    } catch (error) {
      toast.error(error.message || "Attachment unavailable.");
    }
  };
  if (query.loading)
    return (
      <StaffFrame>
        <LoadingSkeleton />
      </StaffFrame>
    );
  if (query.error)
    return (
      <StaffFrame>
        <ErrorState message={query.error.message} onRetry={query.reload} />
      </StaffFrame>
    );
  const complaint = query.data;
  const base = profile?.role === "warden" ? "/warden" : "/admin";
  const sendMessage = async (event) => {
    event.preventDefault();
    await run(
      async () => {
        await checked(
          await addStaffComplaintMessage(
            id,
            message,
            visibility === "internal",
          ),
        );
        setMessage("");
      },
      visibility === "internal"
        ? "Internal note added."
        : "Student-visible reply sent.",
    );
  };
  const updateStatus = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        checked(
          transitionComplaint(
            id,
            data.get("status"),
            data.get("resolution"),
            data.get("priority"),
          ),
        ),
      "Complaint status updated and audited.",
    );
  };
  const assign = async (event) => {
    const staffId = event.target.value || null;
    await run(
      () => checked(assignComplaint(id, staffId)),
      "Complaint assignment updated.",
    );
  };
  const createTask = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        checked(
          createMaintenanceTask(
            id,
            data.get("staff_id"),
            data.get("visit")
              ? new Date(data.get("visit")).toISOString()
              : null,
            data.get("estimated_cost"),
            data.get("currency"),
          ),
        ),
      "Maintenance task created or existing task retained.",
    );
  };
  const saveTask = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        checked(
          updateMaintenanceTask(complaint.maintenance, {
            status: data.get("status"),
            staff_id: data.get("staff_id"),
            visit: data.get("visit")
              ? new Date(data.get("visit")).toISOString()
              : null,
            notes: data.get("notes"),
            actual_cost: data.get("actual_cost"),
            currency: data.get("currency"),
          }),
        ),
      "Maintenance task updated.",
    );
  };
  const details = (
    <>
      <div className="complaint-back">
        <Link className="button button-outline" to={`${base}/complaints`}>
          ← Complaint queue
        </Link>
        <Button variant="outline" onClick={query.reload}>
          Refresh
        </Button>
      </div>
      <PageHeader
        eyebrow={complaint.complaint_number}
        title={complaint.title}
        description={`${categoryLabel(complaint.category)} · submitted ${new Date(complaint.created_at).toLocaleString()}`}
      />
      <div className="complaint-staff-grid">
        <section className="panel phase-panel">
          <h2>Student and issue</h2>
          <dl className="complaint-detail-meta">
            <div>
              <dt>Student</dt>
              <dd>{complaint.student.full_name}</dd>
            </div>
            <div>
              <dt>Registration ID</dt>
              <dd>{complaint.student.student_number}</dd>
            </div>
            <div>
              <dt>Student email</dt>
              <dd>{complaint.student.email}</dd>
            </div>
            <div>
              <dt>Room / bed</dt>
              <dd>{complaint.room_label || "Unassigned"}</dd>
            </div>
            <div>
              <dt>Location detail</dt>
              <dd>{complaint.location_detail || "—"}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <span className={`priority priority-${complaint.priority}`}>
                  {complaint.priority}
                </span>
              </dd>
            </div>
          </dl>
          <h3>Description</h3>
          <p className="complaint-description">{complaint.description}</p>
          {complaint.resolution && (
            <div className="complaint-resolution">
              <h3>Resolution details</h3>
              <p>{complaint.resolution}</p>
              <small>
                {complaint.resolved_at &&
                  new Date(complaint.resolved_at).toLocaleString()}
              </small>
            </div>
          )}
          <h3>Attachments</h3>
          {complaint.attachments.length ? (
            <ul className="complaint-attachments">
              {complaint.attachments.map((file) => (
                <li key={file.id}>
                  <span>
                    {file.original_name}{" "}
                    <small>{Math.ceil(file.byte_size / 1024)} KB</small>
                  </span>
                  <Button
                    variant="outline"
                    onClick={() => void openAttachment(file)}
                  >
                    Open securely
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No attachments submitted.</p>
          )}
        </section>
        <section className="panel phase-panel">
          <h2>Staff actions</h2>
          <p>
            Current status:{" "}
            <span className={`complaint-status status-${complaint.status}`}>
              {formatComplaintStatus(complaint.status)}
            </span>
          </p>
          <label>
            Assigned staff
            <select
              value={complaint.assigned_staff_id || ""}
              onChange={(event) => void assign(event)}
              disabled={busy}
            >
              <option value="">Unassigned</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.role}
                </option>
              ))}
            </select>
          </label>
          <form className="complaint-action-form" onSubmit={updateStatus}>
            <label>
              Status
              <select name="status" defaultValue={complaint.status}>
                {complaintStatuses.map((value) => (
                  <option key={value} value={value}>
                    {formatComplaintStatus(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue={complaint.priority}>
                {["low", "normal", "high", "urgent"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Resolution details
              <textarea
                name="resolution"
                rows={3}
                defaultValue={complaint.resolution || ""}
                maxLength={2000}
                placeholder="Required when resolving or closing"
              />
            </label>
            <Button disabled={busy}>Save status / resolution</Button>
          </form>
          <form className="complaint-action-form" onSubmit={sendMessage}>
            <div className="complaint-reply-heading">
              <h3>{visibility === "student" ? "Send a student reply" : "Add an internal note"}</h3>
              <p>Student-visible replies appear in the student's complaint timeline. Internal notes are visible only to authorized staff.</p>
            </div>
            <label>
              Visibility
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value)}
              >
                <option value="student">Visible to student</option>
                <option value="internal">Internal staff note</option>
              </select>
            </label>
            <label>
              {visibility === "student" ? "Remark / reply for the student" : "Staff-only note"}
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                maxLength={3000}
                required
                placeholder={visibility === "student" ? "Write an update or explain the next steps to the student…" : "Record context for other authorized staff…"}
              />
            </label>
            <Button disabled={busy || !message.trim()}>{busy ? "Saving…" : visibility === "student" ? "Send reply to student" : "Save internal note"}</Button>
          </form>
        </section>
      </div>
      <section className="panel phase-panel">
        <h2>Maintenance</h2>
        {complaint.maintenance ? (
          <form className="form-grid" onSubmit={saveTask}>
            <label>
              Task status
              <select name="status" defaultValue={complaint.maintenance.status}>
                {[
                  "open",
                  "scheduled",
                  "in_progress",
                  "completed",
                  "cancelled",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assigned technician
              <select
                name="staff_id"
                defaultValue={complaint.maintenance.assigned_staff_id || ""}
              >
                <option value="">Unassigned</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scheduled visit
              <input
                name="visit"
                type="datetime-local"
                defaultValue={datetimeLocal(
                  complaint.maintenance.scheduled_visit_at,
                )}
              />
            </label>
            <label>
              Actual cost
              <input
                name="actual_cost"
                type="number"
                min="0"
                step="0.001"
                defaultValue={complaint.maintenance.actual_cost ?? ""}
              />
            </label>
            <label>
              Currency code (required with cost)
              <input
                name="currency"
                pattern="[A-Z]{3}"
                maxLength={3}
                defaultValue={complaint.maintenance.cost_currency_code || ""}
              />
            </label>
            <label className="complaint-full">
              Work notes
              <textarea
                name="notes"
                rows={3}
                defaultValue={complaint.maintenance.work_notes}
                maxLength={3000}
              />
            </label>
            <Button disabled={busy}>Update task</Button>
            <p>
              Maintenance costs are tracked for reporting only and are never
              added to student fees.
            </p>
          </form>
        ) : (
          <form className="form-grid" onSubmit={createTask}>
            <p className="complaint-full">
              Create one maintenance task linked to this complaint. Retries
              return the existing task.
            </p>
            <label>
              Technician
              <select name="staff_id" defaultValue="">
                <option value="">Unassigned</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scheduled visit
              <input name="visit" type="datetime-local" />
            </label>
            <label>
              Estimated cost (optional)
              <input name="estimated_cost" type="number" min="0" step="0.001" />
            </label>
            <label>
              Currency code (required with cost)
              <input name="currency" pattern="[A-Z]{3}" maxLength={3} />
            </label>
            <Button disabled={busy}>Create maintenance task</Button>
          </form>
        )}
      </section>
      <section className="panel phase-panel">
        <h2>History and conversation</h2>
        <ol className="complaint-timeline">
          {[...complaint.events]
            .map((event) => ({ ...event, kind: "event" }))
            .concat(
              complaint.messages.map((item) => ({ ...item, kind: "message" })),
            )
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <span className="timeline-dot" />
                <div>
                  <strong>
                    {item.kind === "message"
                      ? `${item.author_role === "student" ? "Student" : "Staff"}${item.visibility === "internal" ? " · internal note" : ""}`
                      : item.event_type === "status_changed"
                        ? `Status: ${formatComplaintStatus(item.old_value)} → ${formatComplaintStatus(item.new_value)}`
                        : item.event_type === "assigned"
                          ? "Assignment changed"
                          : item.event_type.replaceAll("_", " ")}
                  </strong>
                  {item.kind === "message" && <p>{item.message}</p>}
                  <time>{new Date(item.created_at).toLocaleString()}</time>
                </div>
              </li>
            ))}
        </ol>
      </section>
    </>
  );
  return <StaffFrame>{details}</StaffFrame>;
}
