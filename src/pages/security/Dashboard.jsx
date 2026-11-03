import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  ShieldAlert,
  LogOut,
  Clock,
  UserCheck,
  UserX,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Search,
  ScanLine,
  RefreshCw,
  DoorOpen,
  MapPin,
  FileEdit,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../contexts/AuthContext";
import { ThemeToggle, Logo } from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { StudentAvatar } from "../../components/common/StudentAvatar";
import { QrScanner } from "../../components/gate/QrScanner";
import {
  getGateDashboardMetrics,
  listStudentPresence,
  listGateEvents,
  verifyGateScan,
  manualGateOverride,
  subscribeGate,
} from "../../services/gate";
import { supabase } from "../../lib/supabase";

export default function SecurityDashboard() {
  const { profile, logout } = useAuth();
  const [currentTime, setCurrentTime] = useState(new Date());

  // Gate scanning direction
  const [direction, setDirection] = useState("exit"); // "exit" | "entry"
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [verificationError, setVerificationError] = useState(null);

  // Metrics & live lists
  const [metrics, setMetrics] = useState({
    total_students: 0,
    students_inside: 0,
    students_outside: 0,
    overdue_count: 0,
    departures_today: 0,
    returns_today: 0,
  });

  const [activeTab, setActiveTab] = useState("outside"); // "outside" | "events"
  const [outsideStudents, setOutsideStudents] = useState([]);
  const [outsideSearch, setOutsideSearch] = useState("");
  const [loadingOutside, setLoadingOutside] = useState(false);

  const [recentEvents, setRecentEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Manual Override Modal
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideStudentId, setOverrideStudentId] = useState("");
  const [overrideDirection, setOverrideDirection] = useState("exit");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [studentSearchResults, setStudentSearchResults] = useState([]);
  const [submittingOverride, setSubmittingOverride] = useState(false);

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch metrics
  const refreshMetrics = useCallback(async () => {
    try {
      const data = await getGateDashboardMetrics();
      if (data) setMetrics(data);
    } catch (err) {
      console.error("Failed to load gate metrics:", err);
    }
  }, []);

  // Fetch students outside
  const refreshOutside = useCallback(async () => {
    setLoadingOutside(true);
    try {
      const { rows } = await listStudentPresence({
        status: "outside",
        search: outsideSearch,
        pageSize: 50,
      });
      setOutsideStudents(rows || []);
    } catch (err) {
      console.error("Failed to load outside students:", err);
    } finally {
      setLoadingOutside(false);
    }
  }, [outsideSearch]);

  // Fetch recent gate events
  const refreshEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const { rows } = await listGateEvents({ pageSize: 25 });
      setRecentEvents(rows || []);
    } catch (err) {
      console.error("Failed to load gate events:", err);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // Initial load and Realtime sync
  useEffect(() => {
    refreshMetrics();
    refreshOutside();
    refreshEvents();

    const unsubscribe = subscribeGate(() => {
      refreshMetrics();
      refreshOutside();
      refreshEvents();
    });

    return () => unsubscribe();
  }, [refreshMetrics, refreshOutside, refreshEvents]);

  // Handle Scan Verification
  const handleScan = async (scanPayload) => {
    setVerifying(true);
    setVerificationResult(null);
    setVerificationError(null);

    try {
      const res = await verifyGateScan({
        ...scanPayload,
        event_type: direction,
      });
      setVerificationResult(res);
      toast.success(
        direction === "exit"
          ? `Exit verified for ${res.student_name}`
          : `Return recorded for ${res.student_name}`,
      );
      refreshMetrics();
      refreshOutside();
    } catch (err) {
      setVerificationError(err.message || "Gate scan verification failed.");
      toast.error(err.message || "Gate scan rejected.");
    } finally {
      setVerifying(false);
    }
  };

  const resetVerification = () => {
    setVerificationResult(null);
    setVerificationError(null);
  };

  // Search students for manual override
  useEffect(() => {
    if (!overrideSearch.trim() || overrideSearch.length < 2) {
      setStudentSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("students")
        .select("id, full_name, student_id")
        .or(
          `full_name.ilike.%${overrideSearch}%,student_id.ilike.%${overrideSearch}%`,
        )
        .limit(10);
      setStudentSearchResults(data || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [overrideSearch]);

  const handleManualOverrideSubmit = async (e) => {
    e.preventDefault();
    if (!overrideStudentId) {
      toast.error("Select a student for the override.");
      return;
    }
    if (overrideReason.trim().length < 5) {
      toast.error(
        "Please provide an override reason of at least 5 characters.",
      );
      return;
    }

    setSubmittingOverride(true);
    try {
      await manualGateOverride({
        student_id: overrideStudentId,
        event_type: overrideDirection,
        override_reason: overrideReason.trim(),
      });
      toast.success(
        `Manual ${overrideDirection} override recorded successfully.`,
      );
      setShowOverrideModal(false);
      setOverrideStudentId("");
      setOverrideReason("");
      setOverrideSearch("");
      refreshMetrics();
      refreshOutside();
      refreshEvents();
    } catch (err) {
      toast.error(err.message || "Manual override failed.");
    } finally {
      setSubmittingOverride(false);
    }
  };

  return (
    <div className="security-workspace">
      {/* Top Header */}
      <header className="security-header">
        <div className="flex-row items-center gap-3">
          <Logo />
          <div className="security-badge-tag">
            <ShieldCheck size={16} /> GATE SECURITY
          </div>
        </div>

        <div className="security-header-center">
          <Clock size={16} />
          <strong>
            {currentTime.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </strong>
          <span>
            {currentTime.toLocaleDateString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>

        <div className="security-header-right">
          <Link className="button button-outline" to="/security/visitors">
            Visitors
          </Link>
          <span className="security-officer-name">
            Officer <strong>{profile?.full_name || "Security"}</strong>
          </span>
          <ThemeToggle />
          <Button variant="ghost" onClick={logout} title="Sign Out">
            <LogOut size={16} /> Sign out
          </Button>
        </div>
      </header>

      {/* Metrics Bar */}
      <section className="security-metrics-bar">
        <div className="stat-card">
          <small>STUDENTS INSIDE</small>
          <strong>{metrics.students_inside}</strong>
          <span>of {metrics.total_students} campus residents</span>
        </div>
        <div
          className={`stat-card ${metrics.students_outside > 0 ? "highlight-blue" : ""}`}
        >
          <small>CURRENTLY OUTSIDE</small>
          <strong>{metrics.students_outside}</strong>
          <span>authorized leaves active</span>
        </div>
        <div
          className={`stat-card ${metrics.overdue_count > 0 ? "alert-card" : ""}`}
        >
          <small>OVERDUE RETURNS</small>
          <strong>{metrics.overdue_count}</strong>
          <span>past expected curfew</span>
        </div>
        <div className="stat-card">
          <small>DEPARTURES TODAY</small>
          <strong>{metrics.departures_today}</strong>
          <span>verified gate exits</span>
        </div>
        <div className="stat-card">
          <small>RETURNS TODAY</small>
          <strong>{metrics.returns_today}</strong>
          <span>verified gate entries</span>
        </div>
      </section>

      {/* Main Split Grid */}
      <main className="security-main-grid">
        {/* Left Column: Gate Scanner & Instant Verification */}
        <div className="security-scan-column panel">
          <div className="panel-header-row">
            <div>
              <h2>Checkpoint Verification</h2>
              <small>Choose event type and scan resident pass</small>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOverrideModal(true)}
              title="Manual override for emergency or offline scenarios"
            >
              <FileEdit size={14} /> Manual Override
            </Button>
          </div>

          {/* Direction Selector */}
          <div className="gate-direction-selector">
            <button
              type="button"
              className={`direction-btn exit-btn ${direction === "exit" ? "active" : ""}`}
              onClick={() => {
                setDirection("exit");
                resetVerification();
              }}
            >
              <ArrowRight size={18} />
              <div>
                <strong>EXIT / DEPARTURE</strong>
                <small>Resident leaving campus</small>
              </div>
            </button>
            <button
              type="button"
              className={`direction-btn entry-btn ${direction === "entry" ? "active" : ""}`}
              onClick={() => {
                setDirection("entry");
                resetVerification();
              }}
            >
              <ArrowLeft size={18} />
              <div>
                <strong>ENTRY / RETURN</strong>
                <small>Resident returning to campus</small>
              </div>
            </button>
          </div>

          {/* Verification Result Card or Scanner */}
          {verificationResult ? (
            <div className="gate-result-card accepted-result">
              <div className="result-header">
                <CheckCircle2 size={32} className="text-success" />
                <div>
                  <h3>
                    VERIFIED: {verificationResult.event_type?.toUpperCase()}{" "}
                    ACCEPTED
                  </h3>
                  <small>
                    Recorded at{" "}
                    {new Date(
                      verificationResult.timestamp,
                    ).toLocaleTimeString()}
                  </small>
                </div>
              </div>

              {verificationResult.is_late && (
                <div className="late-warning-banner">
                  <AlertTriangle size={18} />
                  <strong>
                    LATE RETURN NOTICE: Student returned after expected return
                    time!
                  </strong>
                </div>
              )}

              <div className="resident-verified-info">
                <div className="resident-photo-large">
                  {verificationResult.photo_path ? (
                    <img
                      src={
                        supabase.storage
                          .from("student-avatars")
                          .getPublicUrl(verificationResult.photo_path).data
                          ?.publicUrl
                      }
                      alt={verificationResult.student_name}
                      onError={(e) => {
                        e.target.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="avatar-initials-large">
                      {verificationResult.student_name?.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="resident-text-info">
                  <h4>{verificationResult.student_name}</h4>
                  <p>
                    <strong>Student ID:</strong> {verificationResult.student_id}
                  </p>
                  <p>
                    <strong>Room & Bed:</strong>{" "}
                    {verificationResult.hostel_name} · Room{" "}
                    {verificationResult.room_number} (Bed{" "}
                    {verificationResult.bed_number})
                  </p>
                  {verificationResult.destination && (
                    <p>
                      <strong>Destination:</strong>{" "}
                      {verificationResult.destination}
                    </p>
                  )}
                  {verificationResult.scheduled_return && (
                    <p>
                      <strong>Expected Return:</strong>{" "}
                      {new Date(
                        verificationResult.scheduled_return,
                      ).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <Button
                variant="primary"
                onClick={resetVerification}
                className="w-full"
              >
                Verify Next Student
              </Button>
            </div>
          ) : verificationError ? (
            <div className="gate-result-card rejected-result">
              <div className="result-header">
                <XCircle size={32} className="text-danger" />
                <div>
                  <h3>ACCESS DENIED</h3>
                  <small>Verification Rejected</small>
                </div>
              </div>
              <p className="rejection-reason-text">{verificationError}</p>
              <div className="form-actions">
                <Button variant="outline" onClick={resetVerification}>
                  Scan Again
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setShowOverrideModal(true)}
                >
                  Proceed via Manual Override
                </Button>
              </div>
            </div>
          ) : (
            <QrScanner onScan={handleScan} disabled={verifying} />
          )}
        </div>

        {/* Right Column: Outside Roster & Recent Activity */}
        <div className="security-roster-column panel">
          {/* Tabs */}
          <div className="security-tabs-header">
            <button
              type="button"
              className={`sec-tab ${activeTab === "outside" ? "active" : ""}`}
              onClick={() => setActiveTab("outside")}
            >
              <UserX size={16} /> Currently Outside ({outsideStudents.length})
            </button>
            <button
              type="button"
              className={`sec-tab ${activeTab === "events" ? "active" : ""}`}
              onClick={() => setActiveTab("events")}
            >
              <ScanLine size={16} /> Recent Gate Activity
            </button>
          </div>

          {activeTab === "outside" && (
            <div className="outside-roster-pane">
              <div className="search-bar-row">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search outside student by name or ID…"
                  value={outsideSearch}
                  onChange={(e) => setOutsideSearch(e.target.value)}
                />
              </div>

              <div className="outside-list-scroll">
                {loadingOutside ? (
                  <p className="loading-note">Loading roster…</p>
                ) : outsideStudents.length === 0 ? (
                  <div className="empty-roster-box">
                    <CheckCircle2 size={30} color="var(--success, #10b981)" />
                    <p>No students recorded outside campus right now.</p>
                  </div>
                ) : (
                  outsideStudents.map((entry) => {
                    const isOverdue =
                      entry.expected_return_at &&
                      new Date() > new Date(entry.expected_return_at);
                    const bedAlloc = entry.students?.bed_allocations?.[0];
                    const roomInfo = bedAlloc?.beds?.rooms;
                    const hostelInfo = roomInfo?.hostels;

                    return (
                      <div
                        key={entry.student_id}
                        className={`outside-student-card ${isOverdue ? "overdue-flagged" : ""}`}
                      >
                        <div className="flex-row items-center gap-3">
                          <StudentAvatar student={entry.students} />
                          <div>
                            <strong>{entry.students?.full_name}</strong>
                            <small className="block-sub">
                              {entry.students?.student_id} ·{" "}
                              {hostelInfo?.name || "Hostel"} Rm{" "}
                              {roomInfo?.room_number || "—"}
                            </small>
                          </div>
                        </div>

                        <div className="outside-times-box">
                          <div>
                            <small>LEFT AT</small>
                            <span>
                              {entry.last_exit_at
                                ? new Date(
                                    entry.last_exit_at,
                                  ).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <small>DUE BACK</small>
                            <span
                              className={isOverdue ? "text-danger bold" : ""}
                            >
                              {entry.expected_return_at
                                ? new Date(
                                    entry.expected_return_at,
                                  ).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "—"}
                            </span>
                          </div>
                        </div>

                        {isOverdue && (
                          <div className="overdue-chip">
                            <AlertTriangle size={12} /> OVERDUE
                          </div>
                        )}

                        <div className="outside-actions">
                          {entry.gate_passes?.pass_code && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setDirection("entry");
                                handleScan({
                                  pass_code: entry.gate_passes.pass_code,
                                });
                              }}
                            >
                              Verify Return
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === "events" && (
            <div className="events-stream-pane">
              <div className="outside-list-scroll">
                {loadingEvents ? (
                  <p className="loading-note">Loading activity log…</p>
                ) : recentEvents.length === 0 ? (
                  <p className="loading-note">No gate events logged today.</p>
                ) : (
                  recentEvents.map((evt) => (
                    <div key={evt.id} className="event-log-entry">
                      <div className="event-type-icon">
                        {evt.event_type === "exit" ? (
                          <ArrowRight
                            size={16}
                            color="var(--accent-solid, #6366f1)"
                          />
                        ) : (
                          <ArrowLeft
                            size={16}
                            color="var(--success, #10b981)"
                          />
                        )}
                      </div>
                      <div className="event-info-text">
                        <div>
                          <strong>
                            {evt.students?.full_name || "Resident"}
                          </strong>
                          <span className={`status-pill ${evt.outcome}`}>
                            {evt.event_type?.toUpperCase()} {evt.outcome}
                          </span>
                          {evt.is_manual_override && (
                            <span className="status-pill status-revoked">
                              OVERRIDE
                            </span>
                          )}
                        </div>
                        <small>
                          {new Date(evt.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          · Pass: {evt.gate_passes?.pass_code || "Manual"}
                        </small>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Manual Override Dialog */}
      {showOverrideModal && (
        <div
          className="gate-modal-backdrop"
          onClick={() => setShowOverrideModal(false)}
        >
          <div
            className="panel gate-override-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header-row">
              <h3>Manual Gate Override</h3>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowOverrideModal(false)}
              >
                ✕
              </button>
            </div>
            <p className="form-note">
              Authorized security personnel may manually record entry/exit when
              a resident is unable to present a digital pass. All overrides are
              audited.
            </p>

            <form
              onSubmit={handleManualOverrideSubmit}
              className="override-form"
            >
              <label>
                <strong>Find Resident</strong>
                <input
                  type="text"
                  placeholder="Type resident name or student ID…"
                  value={overrideSearch}
                  onChange={(e) => setOverrideSearch(e.target.value)}
                />
              </label>

              {studentSearchResults.length > 0 && (
                <div className="search-results-dropdown">
                  {studentSearchResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`search-result-item ${overrideStudentId === s.id ? "selected" : ""}`}
                      onClick={() => {
                        setOverrideStudentId(s.id);
                        setOverrideSearch(`${s.full_name} (${s.student_id})`);
                        setStudentSearchResults([]);
                      }}
                    >
                      <strong>{s.full_name}</strong>
                      <small>ID: {s.student_id}</small>
                    </button>
                  ))}
                </div>
              )}

              <label>
                <strong>Event Direction</strong>
                <select
                  value={overrideDirection}
                  onChange={(e) => setOverrideDirection(e.target.value)}
                >
                  <option value="exit">Exit (Leaving campus)</option>
                  <option value="entry">Entry (Returning to campus)</option>
                </select>
              </label>

              <label>
                <strong>
                  Reason for Manual Override{" "}
                  <span className="text-danger">*</span>
                </strong>
                <textarea
                  placeholder="Required: State why manual override is necessary (e.g. phone battery drained, emergency medical leave, paper permission slip verified)..."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={3}
                  required
                />
                <small>Minimum 5 characters</small>
              </label>

              <div className="form-actions" style={{ marginTop: "14px" }}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowOverrideModal(false)}
                  disabled={submittingOverride}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    submittingOverride ||
                    !overrideStudentId ||
                    overrideReason.trim().length < 5
                  }
                >
                  {submittingOverride ? "Recording…" : "Authorize & Record"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
