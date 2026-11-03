import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FilePlus2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Logo,
  PageHeader,
  ThemeToggle,
} from "../../components/common/Feedback";
import { useAuth } from "../../contexts/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import {
  complaintCategories,
  complaintSchema,
  complaintStatuses,
  formatComplaintStatus,
  validateComplaintFiles,
} from "../../lib/complaintValidation";
import {
  listStudentComplaints,
  submitComplaint,
} from "../../services/complaints";

const categoryLabel = (category) =>
  category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function StudentComplaints() {
  const { logout } = useAuth();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const form = useForm({
    resolver: zodResolver(complaintSchema),
    defaultValues: {
      title: "",
      category: "other",
      description: "",
      location_detail: "",
    },
  });
  const fetcher = useCallback(
    () => listStudentComplaints({ status, search, page }),
    [status, search, page],
  );
  const query = useQuery(fetcher);
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
  const onSubmit = async (values) => {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    try {
      const result = await submitComplaint(values, nonce, files);
      toast.success(
        `Complaint ${result.complaint_number} submitted. You can follow progress below.`,
      );
      form.reset({
        title: "",
        category: "other",
        description: "",
        location_detail: "",
      });
      setFiles([]);
      setNonce(crypto.randomUUID());
      setPage(0);
      await query.reload();
    } catch (error) {
      if (error.complaint)
        toast.error(
          `Complaint ${error.complaint.complaint_number} was created, but its attachment could not be saved: ${error.message}`,
        );
      else toast.error(error.message || "Unable to submit complaint.");
      await query.reload();
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };
  const pageCount = Math.max(1, Math.ceil((query.data?.count || 0) / 20));
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
        <PageHeader
          eyebrow="RESIDENT SERVICES"
          title="Complaints & maintenance"
          description="Report a hostel issue and follow staff updates in one place."
        />
        <form
          className="panel phase-panel complaint-form"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <div className="complaint-form-heading">
            <span className="complaint-form-icon"><FilePlus2 size={19} /></span>
            <div>
              <span className="eyebrow">REPORT A HOSTEL ISSUE</span>
              <h2>Submit a complaint</h2>
              <p>Share the details so hostel staff can review and follow up.</p>
            </div>
          </div>
          <div className="complaint-form-grid">
            <label className="complaint-field">
              <span>Title <b>*</b></span>
              <input
                {...form.register("title")}
                maxLength={120}
                aria-invalid={Boolean(form.formState.errors.title)}
                placeholder="Briefly describe the issue"
              />
              {form.formState.errors.title && <small className="complaint-field-error">{form.formState.errors.title.message}</small>}
            </label>
            <label className="complaint-field">
              <span>Category <b>*</b></span>
              <select {...form.register("category")}>
                {complaintCategories.map((category) => (
                  <option key={category} value={category}>
                    {categoryLabel(category)}
                  </option>
                ))}
              </select>
              {form.formState.errors.category && <small className="complaint-field-error">{form.formState.errors.category.message}</small>}
            </label>
            <label className="complaint-field complaint-full">
              <span>Description <b>*</b></span>
              <textarea
                rows={4}
                maxLength={3000}
                placeholder="Describe what happened, when you noticed it, and any details that may help staff."
                aria-invalid={Boolean(form.formState.errors.description)}
                {...form.register("description")}
              />
              <small className="complaint-field-hint">{form.watch("description")?.length || 0} / 3000 characters</small>
              {form.formState.errors.description && <small className="complaint-field-error">{form.formState.errors.description.message}</small>}
            </label>
            <label className="complaint-field">
              <span>Location detail</span>
              <input
                {...form.register("location_detail")}
                maxLength={200}
                placeholder="Optional area detail, e.g. washroom beside stairs"
              />
              <small className="complaint-field-hint">Your current room and bed are attached automatically.</small>
            </label>
            <label className="complaint-field">
              <span>Photo attachments</span>
              <span className="complaint-upload">
                <span className="complaint-upload-copy"><strong>Choose photos</strong><small>JPEG, PNG, or WebP · up to 3 images · 5 MB each</small></span>
                <span className="complaint-upload-button">Browse</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => {
                    selectFiles(event);
                    event.target.value = "";
                  }}
                />
              </span>
              {files.length > 0 && (
                <span className="complaint-selected-files">
                  {files.map((file, index) => (
                    <span key={`${file.name}-${file.size}-${index}`}>
                      <span>{file.name}</span>
                      <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>×</button>
                    </span>
                  ))}
                </span>
              )}
            </label>
          </div>
          <div className="complaint-submit-row">
            <small>Staff will review your report and reply on its progress page.</small>
            <Button disabled={busy}>
              {busy ? "Submitting…" : "Submit complaint"}
            </Button>
          </div>
        </form>
        <section className="panel phase-panel">
          <div className="section-heading">
            <div>
              <h2>Your complaints</h2>
              <p>
                Only complaints linked to your signed-in student profile appear
                here.
              </p>
            </div>
          </div>
          <div className="complaint-filters">
            <label>
              <Search size={16} />
              <input
                aria-label="Search complaints"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Search number or title"
              />
            </label>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              {complaintStatuses.map((value) => (
                <option key={value} value={value}>
                  {formatComplaintStatus(value)}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={query.reload}>
              Refresh
            </Button>
          </div>
          {query.loading ? (
            <LoadingSkeleton />
          ) : query.error ? (
            <ErrorState message={query.error.message} onRetry={query.reload} />
          ) : query.data.rows.length ? (
            <>
              <div className="complaint-list">
                {query.data.rows.map((item) => (
                  <Link
                    className="complaint-list-item"
                    to={`/student/complaints/${item.id}`}
                    key={item.id}
                  >
                    <div className="complaint-list-top">
                      <strong>{item.title}</strong>
                      <span
                        className={`complaint-status status-${item.status}`}
                      >
                        {formatComplaintStatus(item.status)}
                      </span>
                    </div>
                    <p>
                      {item.complaint_number} · {categoryLabel(item.category)} ·{" "}
                      {item.room_label}
                    </p>
                    <small>
                      Priority: {item.priority} · Submitted{" "}
                      {new Date(item.created_at).toLocaleString()}
                    </small>
                  </Link>
                ))}
              </div>
              <div className="pagination">
                <span>
                  {query.data.count} complaint(s) · Page {page + 1} of{" "}
                  {pageCount}
                </span>
                <Button
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              title="No complaints found"
              description={
                search || status
                  ? "Try changing your search or status filter."
                  : "When you submit a complaint, its progress will appear here."
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}
