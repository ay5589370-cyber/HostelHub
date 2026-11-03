import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Clock3,
  DoorOpen,
  FileDown,
  IdCard,
  Search,
  ShieldCheck,
  UserRoundPlus,
  UserRoundX,
} from "lucide-react";
import {
  PageHeader,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Logo,
  ThemeToggle,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import { makeCsv } from "../../lib/csvExport";
import {
  checkInVisitor,
  checkOutVisitor,
  decideVisitorVisit,
  listVisitorVisits,
  markVisitorOverdueReviewed,
  registerVisitor,
  searchVisitorStudents,
  verifyVisitorIdentity,
} from "../../services/visitors";

function getExport(rows, filters) {
  return makeCsv(
    rows.map((row) => ({
      visitor: row.visitor_full_name,
      registration_id: row.registration_id,
      student: row.student_name,
      purpose: row.visit_purpose,
      scheduled_entry: row.scheduled_entry_at,
      scheduled_exit: row.scheduled_exit_at,
      visitor_count: row.visitor_count,
      identity_verified: row.government_id_verified ? "yes" : "no",
      approval: row.approval_status,
      status: row.status,
      checked_in_at: row.entered_at || "",
      checked_out_at: row.exited_at || "",
    })),
    [
      { key: "visitor", label: "Visitor" },
      { key: "registration_id", label: "Student registration ID" },
      { key: "student", label: "Student" },
      { key: "purpose", label: "Purpose" },
      { key: "scheduled_entry", label: "Scheduled entry" },
      { key: "scheduled_exit", label: "Scheduled exit" },
      { key: "visitor_count", label: "Party size" },
      { key: "identity_verified", label: "ID verified" },
      { key: "approval", label: "Approval" },
      { key: "status", label: "Status" },
      { key: "checked_in_at", label: "Checked in at" },
      { key: "checked_out_at", label: "Checked out at" },
    ],
    {
      Filters: filters,
      Scope: "current filtered page; contact numbers excluded",
    },
  );
}

export default function Visitors({ mode = "admin" }) {
  const { profile, logout } = useAuth();
  const isStudent = mode === "student";
  const isSecurity = mode === "security";
  const isManager = mode === "admin" || mode === "warden";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [approval, setApproval] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [studentTerm, setStudentTerm] = useState("");
  const [matches, setMatches] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [visitorName, setVisitorName] = useState("");
  const [visitorContact, setVisitorContact] = useState("");
  const [purpose, setPurpose] = useState("");
  const [entryAt, setEntryAt] = useState("");
  const [exitAt, setExitAt] = useState("");
  const [partySize, setPartySize] = useState("1");
  const [rejectReason, setRejectReason] = useState("");
  const [busyId, setBusyId] = useState("");
  const fetcher = useCallback(
    () =>
      listVisitorVisits({
        search,
        from,
        to,
        status,
        approval,
        page,
        pageSize: 25,
      }),
    [search, from, to, status, approval, page],
  );
  const query = useQuery(fetcher);
  const rows = query.data?.rows || [];
  const filterSummary = `search=${search || "all"}; from=${from || "any"}; to=${to || "any"}; status=${status || "all"}; approval=${approval || "all"}`;

  const run = async (id, action, task) => {
    setBusyId(id);
    try {
      const result = await task();
      if (action) toast.success(action);
      await query.reload();
      return result;
    } catch (error) {
      toast.error(error?.message || "Visitor action failed. Please retry.");
      return null;
    } finally {
      setBusyId("");
    }
  };

  const findStudents = async (event) => {
    event.preventDefault();
    try {
      setMatches(await searchVisitorStudents(studentTerm.trim()));
    } catch (error) {
      toast.error(error?.message || "Student search is unavailable.");
    }
  };

  const submitVisitor = async (event) => {
    event.preventDefault();
    if (!selectedStudent) {
      toast.error("Select the student being visited.");
      return;
    }
    const result = await run(
      "new-visitor",
      "Visitor registered for approval.",
      () =>
        registerVisitor({
          student_id: selectedStudent.id,
          visitor_full_name: visitorName.trim(),
          visitor_contact: visitorContact.trim() || null,
          visit_purpose: purpose.trim(),
          scheduled_entry_at: new Date(entryAt).toISOString(),
          scheduled_exit_at: new Date(exitAt).toISOString(),
          visitor_count: Number(partySize),
        }),
    );
    if (result) {
      setVisitorName("");
      setVisitorContact("");
      setPurpose("");
      setEntryAt("");
      setExitAt("");
      setPartySize("1");
    }
  };

  const exportRows = () => {
    const csv = getExport(rows, filterSummary);
    const file = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hostel-visitors-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const main = (
    <div className="page-stack visitor-workspace">
      <PageHeader
        eyebrow={
          isStudent
            ? "My account"
            : isSecurity
              ? "Security desk"
              : "Hostel operations"
        }
        title={isStudent ? "Visitor records" : "Visitor management"}
        description={
          isStudent
            ? "Visit requests and check-in history associated with your student account."
            : "Register visitors, review approvals, verify identity at the desk, and record arrival and departure."
        }
      >
        {isManager && (
          <Button
            variant="outline"
            onClick={exportRows}
            disabled={!rows.length}
          >
            <FileDown size={16} /> Export filtered page
          </Button>
        )}
      </PageHeader>

      {isStudent && (
        <section className="panel visitor-policy-note">
          <h2>Visitor policy</h2>
          <p>
            Advance student requests are not enabled because this project has no
            configured visitor policy. Contact the security desk for current
            instructions. Only visits registered and approved by authorized
            staff appear below.
          </p>
        </section>
      )}

      {isSecurity && (
        <section className="panel visitor-register-panel">
          <h2>
            <UserRoundPlus size={19} /> Register a visitor
          </h2>
          <p>
            Every registration starts pending manager approval. Government ID
            numbers and images are not collected.
          </p>
          <form className="visitor-student-search" onSubmit={findStudents}>
            <label>
              Find student by name or registration ID
              <input
                value={studentTerm}
                onChange={(event) => setStudentTerm(event.target.value)}
                minLength={2}
                maxLength={100}
              />
            </label>
            <Button variant="outline" type="submit">
              <Search size={15} /> Search
            </Button>
          </form>
          {matches.length > 0 && (
            <div className="visitor-student-matches">
              {matches.map((student) => (
                <button
                  type="button"
                  key={student.id}
                  className={
                    selectedStudent?.id === student.id ? "selected" : ""
                  }
                  onClick={() => {
                    setSelectedStudent(student);
                    setMatches([]);
                  }}
                >
                  <strong>{student.full_name}</strong>
                  <small>{student.registration_id}</small>
                </button>
              ))}
            </div>
          )}
          {selectedStudent && (
            <p className="visitor-selected-student">
              Visiting: <strong>{selectedStudent.full_name}</strong> ·{" "}
              {selectedStudent.registration_id}{" "}
              <button
                type="button"
                className="text-action"
                onClick={() => setSelectedStudent(null)}
              >
                Change
              </button>
            </p>
          )}
          <form className="visitor-register-form" onSubmit={submitVisitor}>
            <label>
              Visitor full name
              <input
                required
                minLength={2}
                maxLength={120}
                value={visitorName}
                onChange={(event) => setVisitorName(event.target.value)}
              />
            </label>
            <label>
              Contact number (if required)
              <input
                type="tel"
                maxLength={20}
                value={visitorContact}
                onChange={(event) => setVisitorContact(event.target.value)}
              />
            </label>
            <label>
              Visit purpose
              <input
                required
                minLength={3}
                maxLength={500}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
              />
            </label>
            <label>
              Scheduled entry
              <input
                required
                type="datetime-local"
                value={entryAt}
                onChange={(event) => setEntryAt(event.target.value)}
              />
            </label>
            <label>
              Scheduled exit
              <input
                required
                type="datetime-local"
                value={exitAt}
                onChange={(event) => setExitAt(event.target.value)}
              />
            </label>
            <label>
              Number of visitors
              <input
                type="number"
                min="1"
                required
                value={partySize}
                onChange={(event) => setPartySize(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={busyId === "new-visitor" || !selectedStudent}
            >
              {busyId === "new-visitor"
                ? "Registering…"
                : "Register for approval"}
            </Button>
          </form>
        </section>
      )}

      {!isStudent && (
        <section className="panel visitor-filters">
          <label>
            Search visitor, student name, or registration ID
            <input
              value={search}
              maxLength={100}
              onChange={(event) => {
                setPage(0);
                setSearch(event.target.value);
              }}
            />
          </label>
          <label>
            From date
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setPage(0);
                setFrom(event.target.value);
              }}
            />
          </label>
          <label>
            To date
            <input
              type="date"
              value={to}
              onChange={(event) => {
                setPage(0);
                setTo(event.target.value);
              }}
            />
          </label>
          <label>
            Approval
            <select
              value={approval}
              onChange={(event) => {
                setPage(0);
                setApproval(event.target.value);
              }}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            Visit status
            <select
              value={status}
              onChange={(event) => {
                setPage(0);
                setStatus(event.target.value);
              }}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="checked_in">Checked in</option>
              <option value="checked_out">Checked out</option>
            </select>
          </label>
        </section>
      )}

      {query.loading && !query.data && <LoadingSkeleton />}
      {query.error && (
        <ErrorState
          message="Visitor records are unavailable. Verify the Phase 11 migration and the current account's role."
          onRetry={query.reload}
        />
      )}
      {query.data &&
        (rows.length ? (
          <div className="visitor-record-list">
            {rows.map((visit) => (
              <article className="panel visitor-record" key={visit.id}>
                <div className="visitor-record-main">
                  <div className="visitor-record-title">
                    <h2>{visit.visitor_full_name}</h2>
                    <span className={`visitor-status ${visit.status}`}>
                      {visit.status.replaceAll("_", " ")}
                    </span>
                    {visit.is_overdue && (
                      <span className="visitor-status overdue">Overdue</span>
                    )}
                  </div>
                  <p>
                    <strong>{visit.student_name}</strong> ·{" "}
                    {visit.registration_id}
                  </p>
                  <p>{visit.visit_purpose}</p>
                  <div className="visitor-record-meta">
                    <span>
                      <Clock3 size={14} />{" "}
                      {new Date(visit.scheduled_entry_at).toLocaleString()} –{" "}
                      {new Date(visit.scheduled_exit_at).toLocaleTimeString()}
                    </span>
                    <span>
                      <UserRoundPlus size={14} /> Party of {visit.visitor_count}
                    </span>
                    <span>
                      <IdCard size={14} /> ID{" "}
                      {visit.government_id_verified
                        ? "verified"
                        : "not verified"}
                    </span>
                  </div>
                  {!isStudent && visit.visitor_contact && (
                    <small>Visitor contact: {visit.visitor_contact}</small>
                  )}
                  {visit.entered_at && (
                    <small>
                      Entry recorded{" "}
                      {new Date(visit.entered_at).toLocaleString()}
                      {visit.checked_in_by_name
                        ? ` by ${visit.checked_in_by_name}`
                        : ""}
                    </small>
                  )}
                  {visit.exited_at && (
                    <small>
                      Exit recorded {new Date(visit.exited_at).toLocaleString()}
                      {visit.checked_out_by_name
                        ? ` by ${visit.checked_out_by_name}`
                        : ""}
                    </small>
                  )}
                  <div className="visitor-timeline">
                    {visit.events?.map((event, index) => (
                      <span
                        key={`${event.event_type}-${event.created_at}-${index}`}
                      >
                        {event.event_type.replaceAll("_", " ")} ·{" "}
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="visitor-record-actions">
                  {isManager && visit.status === "pending" && (
                    <>
                      <Button
                        disabled={busyId === visit.id}
                        onClick={() =>
                          void run(visit.id, "Visit approved.", () =>
                            decideVisitorVisit(visit.id, "approved"),
                          )
                        }
                      >
                        <Check size={14} /> Approve
                      </Button>
                      <input
                        aria-label="Rejection reason"
                        placeholder="Reason required to reject"
                        value={rejectReason}
                        onChange={(event) =>
                          setRejectReason(event.target.value)
                        }
                      />
                      <Button
                        variant="danger"
                        disabled={
                          busyId === visit.id || rejectReason.trim().length < 3
                        }
                        onClick={() =>
                          void run(visit.id, "Visit rejected.", () =>
                            decideVisitorVisit(
                              visit.id,
                              "rejected",
                              rejectReason.trim(),
                            ),
                          )
                        }
                      >
                        <UserRoundX size={14} /> Reject
                      </Button>
                    </>
                  )}
                  {(isSecurity || mode === "admin") &&
                    !visit.government_id_verified &&
                    ["pending", "approved"].includes(visit.status) && (
                      <Button
                        variant="outline"
                        disabled={busyId === visit.id}
                        onClick={() =>
                          void run(
                            visit.id,
                            "Visitor identity verification recorded.",
                            () => verifyVisitorIdentity(visit.id),
                          )
                        }
                      >
                        <IdCard size={14} /> Confirm ID in person
                      </Button>
                    )}
                  {(isSecurity || mode === "admin") &&
                    visit.status === "approved" &&
                    visit.government_id_verified && (
                      <Button
                        disabled={busyId === visit.id}
                        onClick={() =>
                          void run(visit.id, "Visitor entry recorded.", () =>
                            checkInVisitor(visit.id),
                          )
                        }
                      >
                        <DoorOpen size={14} /> Check in
                      </Button>
                    )}
                  {(isSecurity || mode === "admin") &&
                    visit.status === "checked_in" && (
                      <Button
                        disabled={busyId === visit.id}
                        onClick={() =>
                          void run(visit.id, "Visitor exit recorded.", () =>
                            checkOutVisitor(visit.id),
                          )
                        }
                      >
                        <ArrowLeft size={14} /> Check out
                      </Button>
                    )}
                  {isManager &&
                    visit.is_overdue &&
                    !visit.overdue_reviewed_at && (
                      <Button
                        variant="outline"
                        disabled={busyId === visit.id}
                        onClick={() =>
                          void run(
                            visit.id,
                            "Overdue visit marked reviewed.",
                            () => markVisitorOverdueReviewed(visit.id),
                          )
                        }
                      >
                        <ShieldCheck size={14} /> Mark reviewed
                      </Button>
                    )}
                  {isManager && visit.overdue_reviewed_at && (
                    <small>
                      Overdue review recorded{" "}
                      {new Date(visit.overdue_reviewed_at).toLocaleString()}
                    </small>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No visitor records"
            description={
              isStudent
                ? "No approved or completed visitor records are linked to your account."
                : "No visits match the selected filters. Register a visitor at the security desk."
            }
          />
        ))}
      {query.data && (
        <div className="pagination-row">
          <span>
            Page {page + 1} · {query.data.count} matching visits
          </span>
          <div>
            <Button
              variant="outline"
              disabled={page === 0 || query.loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Newer
            </Button>{" "}
            <Button
              variant="outline"
              disabled={(page + 1) * 25 >= query.data.count || query.loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Older
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (!isSecurity) return main;
  return (
    <div className="visitor-security-shell">
      <header>
        <Link to="/security/dashboard">
          <ArrowLeft size={18} /> Gate dashboard
        </Link>
        <Logo />
        <span>{profile?.full_name || "Security"}</span>
        <ThemeToggle />
        <Button variant="ghost" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>
      {main}
    </div>
  );
}
