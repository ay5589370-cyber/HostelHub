import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import {
  getInventory,
  listStudents,
  subscribePhase2,
  registerStudent,
  manage,
} from "../../services/students";
import {
  PageHeader,
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "../../components/common/Feedback";
import { StudentAvatar } from "../../components/common/StudentAvatar";
import { Button } from "../../components/ui/Button";
import { CredentialsGmailDraft } from "../../components/common/CredentialsGmailDraft";
import { supabase } from "../../lib/supabase";
import { queryResult } from "../../services/profiles";
import { toast } from "sonner";
const getPending = () =>
  queryResult(
    supabase
      .from("student_registrations")
      .select("id,student_id,invitation_status,attempts,last_error,created_at")
      .is("student_id", null)
      .order("created_at", { ascending: false })
      .limit(20),
  );
export default function Students() {
  const [filters, setFilters] = useState({
    search: "",
    hostel: "",
    room: "",
    course: "",
    status: "",
    sort: "created_at",
    ascending: false,
    page: 0,
  });
  const fetcher = useCallback(() => listStudents(filters), [filters]);
  const result = useQuery(fetcher);
  const inventory = useQuery(getInventory);
  const pending = useQuery(getPending);
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);
  useEffect(() => subscribePhase2(result.reload), [result.reload]);
  const change = (key, value) =>
    setFilters((f) => ({ ...f, [key]: value, page: 0 }));
  const retry = async (id, bed) => {
    setBusy(true);
    try {
      if (bed) await manage("pending_bed", { id, bed_id: bed });
      const issued = await registerStudent(id, null, "register");
      setCredentials(issued);
      toast.success("Registration completed");
      result.reload();
      pending.reload();
    } catch (e) {
      toast.error(e.message);
      pending.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="PEOPLE & COMMUNITY"
        title="Students"
        description="Every resident, connected. Manage admissions and campus life in one place."
      >
        <Link className="button button-primary" to="/admin/students/new">
          <Plus size={16} />
          Register student
        </Link>
      </PageHeader>
      <section className="panel phase-panel">
        <div className="directory-filters">
          <label>
            <span>
              <Search size={14} /> Search students
            </span>
            <input
              value={filters.search}
              placeholder="Name, student ID or email"
              onChange={(e) => change("search", e.target.value)}
            />
          </label>
          <label>
            Hostel / block
            <select
              value={filters.hostel}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  hostel: e.target.value,
                  room: "",
                  page: 0,
                }))
              }
            >
              <option value="">All hostels</option>
              {inventory.data?.hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.block}
                </option>
              ))}
            </select>
          </label>
          <label>
            Room
            <select
              value={filters.room}
              onChange={(e) => change("room", e.target.value)}
            >
              <option value="">All rooms</option>
              {inventory.data?.rooms
                .filter(
                  (r) => !filters.hostel || r.hostel_id === filters.hostel,
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.room_number}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Course
            <input
              value={filters.course}
              placeholder="Exact course name"
              onChange={(e) => change("course", e.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="">All statuses</option>
              {["active", "inactive", "archived"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select
              value={`${filters.sort}:${filters.ascending}`}
              onChange={(e) => {
                const [sort, asc] = e.target.value.split(":");
                setFilters((f) => ({
                  ...f,
                  sort,
                  ascending: asc === "true",
                  page: 0,
                }));
              }}
            >
              <option value="created_at:false">Newest first</option>
              <option value="created_at:true">Oldest first</option>
              <option value="full_name:true">Name A–Z</option>
              <option value="student_id:true">Student ID</option>
            </select>
          </label>
        </div>
        {inventory.error && (
          <p className="form-error">
            Room filters could not load.{" "}
            <button onClick={inventory.reload}>Retry</button>
          </p>
        )}
        {result.loading ? (
          <LoadingSkeleton />
        ) : result.error ? (
          <ErrorState message={result.error.message} onRetry={result.reload} />
        ) : !result.data.rows.length ? (
          <EmptyState
            title="No students found"
            description="Register your first student or adjust the filters."
          />
        ) : (
          <div className="table-scroll">
            <table className="student-table">
              <thead>
                <tr>
                  {[
                    "Student",
                    "Student ID",
                    "Phone",
                    "Course / department",
                    "Hostel / room / bed",
                    "Status",
                    "Invitation",
                    "Registered",
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link
                        className="student-cell"
                        to={`/admin/students/${s.id}`}
                      >
                        <StudentAvatar student={s} />
                        <span>
                          <strong>{s.full_name}</strong>
                          <small>{s.email}</small>
                        </span>
                      </Link>
                    </td>
                    <td>{s.student_id}</td>
                    <td>{s.phone}</td>
                    <td>
                      {s.course}
                      {s.branch ? ` / ${s.branch}` : ""}
                    </td>
                    <td>
                      {s.hostel_name
                        ? `${s.hostel_name} · ${s.block} / ${s.room_number} / ${s.bed_number}`
                        : "Unallocated"}
                    </td>
                    <td>
                      <span className={`status-pill ${s.status}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>{s.invitation_status || "—"}</td>
                    <td>
                      {new Date(s.created_at).toLocaleDateString("en-IN")}
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
            disabled={!filters.page || result.loading}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            Previous
          </Button>
          <span>
            {result.data?.count ?? "…"} students · Page {filters.page + 1}
          </span>
          <Button
            variant="outline"
            disabled={
              result.loading ||
              !result.data ||
              (filters.page + 1) * 20 >= result.data.count
            }
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            Next
          </Button>
        </div>
      </section>
      {pending.error && (
        <ErrorState
          message="Could not load pending registrations."
          onRetry={pending.reload}
        />
      )}
      {!!pending.data?.length && (
        <section className="panel phase-panel">
          <h2>Registrations needing attention</h2>
          <p>
            Retry interrupted requests using their original ID. If the bed is no
            longer available, choose a replacement. No duplicate account is
            created.
          </p>
          {pending.data.map((j) => (
            <form
              className="pending-row"
              key={j.id}
              onSubmit={(e) => {
                e.preventDefault();
                void retry(j.id, new FormData(e.currentTarget).get("bed"));
              }}
            >
              <span>
                Request {j.id.slice(0, 8)} · {j.invitation_status}
                <small>{j.last_error || "Registration pending"}</small>
              </span>
              <label>
                Replacement bed
                <select name="bed">
                  <option value="">Keep original bed</option>
                  {inventory.data?.beds
                    .filter(
                      (b) =>
                        b.status === "available" &&
                        !inventory.data.allocations.some(
                          (a) => a.bed_id === b.id,
                        ),
                    )
                    .filter((b) =>
                      inventory.data.rooms.some(
                        (r) => r.id === b.room_id && r.status === "available",
                      ),
                    )
                    .map((b) => {
                      const r = inventory.data.rooms.find(
                        (r) => r.id === b.room_id,
                      );
                      const h = inventory.data.hostels.find(
                        (h) => h.id === r.hostel_id,
                      );
                      return (
                        <option key={b.id} value={b.id}>
                          {h?.name} {h?.block} / {r.room_number} /{" "}
                          {b.bed_number}
                        </option>
                      );
                    })}
                </select>
              </label>
              <Button disabled={busy}>Retry</Button>
            </form>
          ))}
        </section>
      )}
      {credentials && (
        <div className="dialog-overlay" role="presentation">
          <section
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="retry-credentials-title"
          >
            <h2 id="retry-credentials-title">Registration completed</h2>
            <p>
              You can open a Gmail draft with the credentials and review it
              before sending. The password is cleared when you close this
              dialog.
            </p>
            <dl className="review-grid">
              <div>
                <small>Hostel ID</small>
                <strong>{credentials.student_id}</strong>
              </div>
              <div>
                <small>Email sign-in</small>
                <strong>{credentials.login_id}</strong>
              </div>
              <div>
                <small>Temporary password</small>
                <strong>
                  <code>{credentials.temporary_password}</code>
                </strong>
              </div>
            </dl>
            <CredentialsGmailDraft credentials={credentials} />
            <Button onClick={() => setCredentials(null)}>Done</Button>
          </section>
        </div>
      )}
    </>
  );
}
