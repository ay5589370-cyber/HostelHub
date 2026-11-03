import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../../components/ui/Button";
import { Logo, ThemeToggle } from "../../components/common/Feedback";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from "../../components/common/Feedback";
import { useQuery } from "../../hooks/useQuery";
import {
  formatComplaintStatus,
  validateComplaintFiles,
} from "../../lib/complaintValidation";
import {
  addComplaintMessage,
  getStudentComplaint,
  signedComplaintAttachmentUrl,
} from "../../services/complaints";

export default function StudentComplaintDetail() {
  const { id } = useParams();
  const { logout } = useAuth();
  const fetcher = useCallback(() => getStudentComplaint(id), [id]);
  const query = useQuery(fetcher);
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState("");
  const selectFiles = (event) => {
    const chosen = Array.from(event.target.files || []);
    try {
      validateComplaintFiles(chosen);
      setFiles(chosen);
    } catch (error) {
      event.target.value = "";
      toast.error(error.message);
    }
  };
  const send = async (event) => {
    event.preventDefault();
    if (!message.trim()) return toast.error("Write a message before sending.");
    setBusy(true);
    try {
      await addComplaintMessage(id, message, files);
      setMessage("");
      setFiles([]);
      await query.reload();
      toast.success("Your update was added.");
    } catch (error) {
      if (error.messageCreated) {
        setMessage("");
        setFiles([]);
        await query.reload();
        toast.error(
          `Your message was saved, but the attachment could not be saved: ${error.message}`,
        );
        return;
      }
      toast.error(error.message || "Unable to send update.");
    } finally {
      setBusy(false);
    }
  };
  const openAttachment = async (file) => {
    setOpening(file.id);
    try {
      window.open(
        await signedComplaintAttachmentUrl(file.object_path),
        "_blank",
        "noopener,noreferrer",
      );
    } catch (error) {
      toast.error(error.message || "Attachment unavailable.");
    } finally {
      setOpening("");
    }
  };
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
  const complaint = query.data;
  if (!complaint)
    return (
      <EmptyState
        title="Complaint not found"
        description="It may have been removed or is not available to this student."
      />
    );
  const timeline = [
    ...(complaint.complaint_events || []).map((event) => ({
      ...event,
      kind: "event",
    })),
    ...(complaint.complaint_messages || []).map((item) => ({
      ...item,
      kind: "message",
      event_type: "message_added",
    })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return (
    <main className="student-workspace">
      <header>
        <Logo />
        <nav>
          <Link to="/student/dashboard">Dashboard</Link>
          <Link to="/student/profile">My profile</Link>
          <Link to="/student/leave">Leave</Link>
          <Link to="/student/fees">Fees</Link>
          <Link to="/student/complaints">Complaints</Link>
          <ThemeToggle />
          <Button
            variant="outline"
            onClick={() =>
              logout().catch((error) => toast.error(error.message))
            }
          >
            Sign out
          </Button>
        </nav>
      </header>
      <div className="student-profile complaint-page">
        <div className="complaint-back">
          <Link className="button button-outline" to="/student/complaints">
            ← All complaints
          </Link>
          <Button variant="outline" onClick={query.reload}>
            Refresh
          </Button>
        </div>
        <header className="complaint-detail-heading">
          <div>
            <span className="eyebrow">{complaint.complaint_number}</span>
            <h1>{complaint.title}</h1>
            <p>
              {complaint.category} · {complaint.room_label} · Submitted{" "}
              {new Date(complaint.created_at).toLocaleString()}
            </p>
          </div>
          <span className={`complaint-status status-${complaint.status}`}>
            {formatComplaintStatus(complaint.status)}
          </span>
        </header>
        {complaint.notices?.length > 0 && (
          <section
            className="panel complaint-notices"
            aria-label="New complaint updates"
          >
            <h2>New updates</h2>
            {complaint.notices.map((notice) => (
              <article key={notice.id}>
                <strong>{notice.title}</strong>
                <p>{notice.message}</p>
                <time>{new Date(notice.created_at).toLocaleString()}</time>
              </article>
            ))}
          </section>
        )}
        <section className="panel phase-panel">
          <div className="complaint-meta">
            <span>
              Priority <strong>{complaint.priority}</strong>
            </span>
            <span>
              Updated{" "}
              <strong>{new Date(complaint.updated_at).toLocaleString()}</strong>
            </span>
            <span>
              Location detail{" "}
              <strong>{complaint.location_detail || "—"}</strong>
            </span>
          </div>
          <h2>Issue details</h2>
          <p className="complaint-description">{complaint.description}</p>
          {complaint.resolution && (
            <div className="complaint-resolution">
              <h3>Resolution</h3>
              <p>{complaint.resolution}</p>
              {complaint.resolved_at && (
                <small>
                  Resolved {new Date(complaint.resolved_at).toLocaleString()}
                </small>
              )}
            </div>
          )}
          {(complaint.complaint_attachments || []).length > 0 && (
            <>
              <h3>Attachments</h3>
              <ul className="complaint-attachments">
                {complaint.complaint_attachments.map((file) => (
                  <li key={file.id}>
                    <span>{file.original_name}</span>
                    <Button
                      variant="outline"
                      disabled={opening === file.id}
                      onClick={() => void openAttachment(file)}
                    >
                      {opening === file.id ? "Opening…" : "Open securely"}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="panel phase-panel">
          <h2>Progress timeline</h2>
          {timeline.length ? (
            <ol className="complaint-timeline">
              {timeline.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>
                      {item.kind === "message"
                        ? item.author_type === "student"
                          ? "You"
                          : "Hostel staff"
                        : item.event_type === "status_changed"
                          ? `Status changed to ${formatComplaintStatus(item.new_value)}`
                          : item.event_type === "assigned"
                            ? "Staff assigned"
                            : item.event_type === "submitted"
                              ? "Complaint submitted"
                              : item.event_type === "priority_changed"
                                ? `Priority changed to ${item.new_value}`
                                : item.event_type === "resolution_updated"
                                  ? "Resolution updated"
                                  : "Complaint updated"}
                    </strong>
                    {item.kind === "message" && <p>{item.message}</p>}
                    <time>{new Date(item.created_at).toLocaleString()}</time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No updates yet"
              description="The complaint timeline will show staff updates here."
            />
          )}
        </section>
        {complaint.status !== "closed" && (
          <form className="panel phase-panel complaint-form" onSubmit={send}>
            <h2>Add an update</h2>
            <label>
              Message
              <textarea
                rows={3}
                maxLength={3000}
                required
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Add useful details or answer a staff question."
              />
            </label>
            <label>
              Optional images
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={selectFiles}
              />
              <small>Up to 3 JPEG, PNG, or WebP images, 5 MB each.</small>
            </label>
            <Button disabled={busy}>{busy ? "Sending…" : "Send update"}</Button>
          </form>
        )}
        {complaint.status === "closed" && (
          <p className="notice">
            This complaint is closed. Reopening is not enabled by the current
            hostel policy.
          </p>
        )}
      </div>
    </main>
  );
}
