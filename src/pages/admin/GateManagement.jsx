import { useCallback, useEffect, useState } from "react";
import {
  ScanLine,
  UserCheck,
  AlertTriangle,
  Search,
  ArrowRight,
  ArrowLeft,
  Ban,
  FileEdit,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { StudentAvatar } from "../../components/common/StudentAvatar";
import {
  PageHeader,
  EmptyState,
  ErrorState,
} from "../../components/common/Feedback";
import {
  getGateDashboardMetrics,
  listStudentPresence,
  listGateEvents,
  revokeGatePass,
  manualGateOverride,
  subscribeGate,
} from "../../services/gate";
import { supabase } from "../../lib/supabase";

export default function GateManagement() {
  const [activeTab, setActiveTab] = useState("roster"); // "roster" | "audit"

  // Metrics
  const [metrics, setMetrics] = useState({
    total_students: 0,
    students_inside: 0,
    students_outside: 0,
    overdue_count: 0,
    departures_today: 0,
    returns_today: 0,
  });

  // Presence Roster State
  const [presenceList, setPresenceList] = useState([]);
  const [presenceCount, setPresenceCount] = useState(0);
  const [presenceStatusFilter, setPresenceStatusFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [presenceSearch, setPresenceSearch] = useState("");
  const [presencePage, setPresencePage] = useState(0);
  const [loadingPresence, setLoadingPresence] = useState(false);
  const [presenceError, setPresenceError] = useState("");

  // Audit Log State
  const [eventsList, setEventsList] = useState([]);
  const [eventsCount, setEventsCount] = useState(0);
  const [eventFilterType, setEventFilterType] = useState("");
  const [eventFilterOutcome, setEventFilterOutcome] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [eventsPage, setEventsPage] = useState(0);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState("");

  // Pass Revocation Modal
  const [revokingPassId, setRevokingPassId] = useState(null);
  const [revokingPassCode, setRevokingPassCode] = useState("");
  const [revocationReason, setRevocationReason] = useState("");
  const [busyRevoke, setBusyRevoke] = useState(false);

  // Manual Override Modal
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideStudentId, setOverrideStudentId] = useState("");
  const [overrideDirection, setOverrideDirection] = useState("exit");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [overrideSearchResults, setOverrideSearchResults] = useState([]);
  const [submittingOverride, setSubmittingOverride] = useState(false);

  // Load Metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const data = await getGateDashboardMetrics();
      if (data) setMetrics(data);
    } catch (err) {
      console.error("Failed to load metrics:", err);
    }
  }, []);

  // Load Presence Roster
  const fetchPresence = useCallback(async () => {
    setLoadingPresence(true);
    setPresenceError("");
    try {
      const { rows, count } = await listStudentPresence({
        status: presenceStatusFilter,
        overdueOnly,
        search: presenceSearch,
        page: presencePage,
        pageSize: 20,
      });
      setPresenceList(rows || []);
      setPresenceCount(count || 0);
    } catch (err) {
      setPresenceError(err.message || "Failed to load campus presence roster.");
    } finally {
      setLoadingPresence(false);
    }
  }, [presenceStatusFilter, overdueOnly, presenceSearch, presencePage]);

  // Load Audit Events
  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    setEventsError("");
    try {
      const { rows, count } = await listGateEvents({
        eventType: eventFilterType,
        outcome: eventFilterOutcome,
        search: eventSearch,
        page: eventsPage,
        pageSize: 20,
      });
      setEventsList(rows || []);
      setEventsCount(count || 0);
    } catch (err) {
      setEventsError(err.message || "Failed to load gate audit log.");
    } finally {
      setLoadingEvents(false);
    }
  }, [eventFilterType, eventFilterOutcome, eventSearch, eventsPage]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (activeTab === "roster") fetchPresence();
  }, [activeTab, fetchPresence]);

  useEffect(() => {
    if (activeTab === "audit") fetchEvents();
  }, [activeTab, fetchEvents]);

  // Realtime subscription
  useEffect(() => {
    const unsub = subscribeGate(() => {
      fetchMetrics();
      if (activeTab === "roster") fetchPresence();
      if (activeTab === "audit") fetchEvents();
    });
    return () => unsub();
  }, [activeTab, fetchMetrics, fetchPresence, fetchEvents]);

  // Student search for override modal
  useEffect(() => {
    if (!overrideSearch.trim() || overrideSearch.length < 2) {
      setOverrideSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("students")
        .select("id, full_name, student_id")
        .or(`full_name.ilike.%${overrideSearch}%,student_id.ilike.%${overrideSearch}%`)
        .limit(10);
      setOverrideSearchResults(data || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [overrideSearch]);

  const handleRevokePass = async (e) => {
    e.preventDefault();
    if (!revokingPassId) return;
    if (revocationReason.trim().length < 3) {
      toast.error("Please enter a revocation reason of at least 3 characters.");
      return;
    }

    setBusyRevoke(true);
    try {
      await revokeGatePass(revokingPassId, revocationReason.trim());
      toast.success("Gate pass revoked successfully.");
      setRevokingPassId(null);
      setRevocationReason("");
      fetchPresence();
      fetchEvents();
      fetchMetrics();
    } catch (err) {
      toast.error(err.message || "Failed to revoke pass.");
    } finally {
      setBusyRevoke(false);
    }
  };

  const handleManualOverride = async (e) => {
    e.preventDefault();
    if (!overrideStudentId) {
      toast.error("Please select a student.");
      return;
    }
    if (overrideReason.trim().length < 5) {
      toast.error("Please provide an override reason of at least 5 characters.");
      return;
    }

    setSubmittingOverride(true);
    try {
      await manualGateOverride({
        student_id: overrideStudentId,
        event_type: overrideDirection,
        override_reason: overrideReason.trim(),
      });
      toast.success(`Manual ${overrideDirection} override executed.`);
      setShowOverrideModal(false);
      setOverrideStudentId("");
      setOverrideReason("");
      setOverrideSearch("");
      fetchPresence();
      fetchEvents();
      fetchMetrics();
    } catch (err) {
      toast.error(err.message || "Manual override failed.");
    } finally {
      setSubmittingOverride(false);
    }
  };

  return (
    <div className="admin-gate-workspace">
      <PageHeader
        eyebrow="CAMPUS SAFETY"
        title="Gate management"
        description="Live campus presence, digital pass verification, and an immutable audit trail."
      >
        <Button
          variant="outline"
          onClick={() => setShowOverrideModal(true)}
        >
          <FileEdit size={16} /> Override
        </Button>
      </PageHeader>

      <div className="admin-gate-page">
      {/* Metrics Row */}
      <div className="gate-metrics-grid">
        <div className="stat-card gate-metric-card gate-occupancy-card">
          <div className="gate-metric-heading"><small>Campus occupancy</small><span className="gate-metric-icon"><UserCheck size={18} /></span></div>
          <strong className="gate-metric-value">
            {metrics.students_inside}{" "}
            <span style={{ fontSize: "14px", fontWeight: "normal", color: "var(--muted)" }}>
              / {metrics.total_students}
            </span>
          </strong>
          <span>Residents currently inside</span>
        </div>

        <div className={`stat-card gate-metric-card gate-outside-card ${metrics.students_outside > 0 ? "highlight-blue" : ""}`}>
          <div className="gate-metric-heading"><small>Currently outside</small><span className="gate-metric-icon"><ArrowRight size={18} /></span></div>
          <strong className="gate-metric-value">{metrics.students_outside}</strong>
          <span>Authorized departures</span>
        </div>

        <div className={`stat-card gate-metric-card gate-overdue-card ${metrics.overdue_count > 0 ? "alert-card" : ""}`}>
          <div className="gate-metric-heading"><small>Overdue returns</small><span className="gate-metric-icon"><AlertTriangle size={18} /></span></div>
          <strong className="gate-metric-value">{metrics.overdue_count}</strong>
          <span>Past curfew / expected return</span>
        </div>

        <div className="stat-card gate-metric-card gate-activity-card">
          <div className="gate-metric-heading"><small>Today's activity</small><span className="gate-metric-icon"><ScanLine size={18} /></span></div>
          <strong className="gate-metric-value gate-activity-value">
            {metrics.departures_today}{" "}
            <span style={{ fontSize: "14px", fontWeight: "normal", color: "var(--muted)" }}>out</span> ·{" "}
            {metrics.returns_today}{" "}
            <span style={{ fontSize: "14px", fontWeight: "normal", color: "var(--muted)" }}>in</span>
          </strong>
          <span>Verified gate events</span>
        </div>
      </div>

      {/* Primary Tab Navigation */}
      <div className="admin-gate-tabs">
        <button
          type="button"
          className={`gate-nav-tab ${activeTab === "roster" ? "active" : ""}`}
          onClick={() => setActiveTab("roster")}
        >
          <UserCheck size={16} /> Live Campus Presence ({presenceCount})
        </button>
        <button
          type="button"
          className={`gate-nav-tab ${activeTab === "audit" ? "active" : ""}`}
          onClick={() => setActiveTab("audit")}
        >
          <ScanLine size={16} /> Gate Event Audit Log ({eventsCount})
        </button>
      </div>

      {/* Tab 1: Live Presence Roster */}
      {activeTab === "roster" && (
        <section className="presence-section gate-content-panel">
          <div className="directory-filters">
            <div className="search-field">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search by student name or ID…"
                value={presenceSearch}
                onChange={(e) => {
                  setPresenceSearch(e.target.value);
                  setPresencePage(0);
                }}
              />
            </div>

            <select
              value={presenceStatusFilter}
              onChange={(e) => {
                setPresenceStatusFilter(e.target.value);
                setPresencePage(0);
              }}
            >
              <option value="">All Presence Statuses</option>
              <option value="inside">Inside Campus</option>
              <option value="outside">Outside Campus</option>
            </select>

            <label className="checkbox-filter-label">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(e) => {
                  setOverdueOnly(e.target.checked);
                  setPresencePage(0);
                }}
              />
              <span>Show Overdue Only</span>
            </label>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Resident</th>
                  <th>Room & Bed</th>
                  <th>Current Status</th>
                  <th>Last Movement</th>
                  <th>Expected Return</th>
                  <th>Active Pass</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingPresence ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: "30px" }}>
                      Loading campus presence roster…
                    </td>
                  </tr>
                ) : presenceError ? (
                  <tr>
                    <td colSpan="7">
                      <div className="gate-error-state">
                        <AlertTriangle size={20} color="#e11d48" />
                        <p>{presenceError}</p>
                        <Button variant="outline" onClick={fetchPresence}>
                          <RefreshCw size={14} /> Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : presenceList.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: "30px" }}>
                      No residents found matching the selected filter.
                    </td>
                  </tr>
                ) : (
                  presenceList.map((row) => {
                    const bedAlloc = row.students?.bed_allocations?.[0];
                    const room = bedAlloc?.beds?.rooms;
                    const hostel = room?.hostels;
                    const isOverdue =
                      row.status === "outside" &&
                      row.expected_return_at &&
                      new Date() > new Date(row.expected_return_at);

                    return (
                      <tr key={row.student_id}>
                        <td>
                          <div className="flex-row items-center gap-2">
                            <StudentAvatar student={row.students} />
                            <div>
                              <strong>{row.students?.full_name}</strong>
                              <small className="block-sub">{row.students?.student_id}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {hostel ? (
                            <span>
                              {hostel.name} · Rm {room.room_number} ({bedAlloc?.beds?.bed_number})
                            </span>
                          ) : (
                            <span className="text-muted">Unassigned</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`status-pill status-${row.status} ${
                              isOverdue ? "status-rejected" : ""
                            }`}
                          >
                            {isOverdue ? "OVERDUE" : row.status?.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          {row.status === "outside" && row.last_exit_at ? (
                            <span title={new Date(row.last_exit_at).toLocaleString()}>
                              Left: {new Date(row.last_exit_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          ) : row.last_entry_at ? (
                            <span title={new Date(row.last_entry_at).toLocaleString()}>
                              Entered: {new Date(row.last_entry_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {row.status === "outside" && row.expected_return_at ? (
                            <span className={isOverdue ? "text-danger bold" : ""}>
                              {new Date(row.expected_return_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (
                              {new Date(row.expected_return_at).toLocaleDateString([], { month: "short", day: "numeric" })})
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {row.gate_passes ? (
                            <div className="flex-row items-center gap-1">
                              <code>{row.gate_passes.pass_code}</code>
                              {row.gate_passes.status === "active" && (
                                <button
                                  type="button"
                                  className="icon-link-btn"
                                  title="Revoke Gate Pass"
                                  onClick={() => {
                                    setRevokingPassId(row.gate_passes.id);
                                    setRevokingPassCode(row.gate_passes.pass_code);
                                  }}
                                >
                                  <Ban size={14} color="var(--danger)" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setOverrideStudentId(row.student_id);
                              setOverrideDirection(row.status === "inside" ? "exit" : "entry");
                              setOverrideSearch(
                                `${row.students?.full_name} (${row.students?.student_id})`,
                              );
                              setShowOverrideModal(true);
                            }}
                          >
                            Override
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination-row">
            <span>
              Showing {presenceList.length} of {presenceCount} residents
            </span>
            <div className="flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={presencePage === 0}
                onClick={() => setPresencePage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(presencePage + 1) * 20 >= presenceCount}
                onClick={() => setPresencePage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Tab 2: Gate Audit Log */}
      {activeTab === "audit" && (
        <section className="audit-section gate-content-panel">
          <div className="directory-filters">
            <div className="search-field">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search audit log by student or reason…"
                value={eventSearch}
                onChange={(e) => {
                  setEventSearch(e.target.value);
                  setEventsPage(0);
                }}
              />
            </div>

            <select
              value={eventFilterType}
              onChange={(e) => {
                setEventFilterType(e.target.value);
                setEventsPage(0);
              }}
            >
              <option value="">All Movement Types</option>
              <option value="exit">Exits Only</option>
              <option value="entry">Entries Only</option>
            </select>

            <select
              value={eventFilterOutcome}
              onChange={(e) => {
                setEventFilterOutcome(e.target.value);
                setEventsPage(0);
              }}
            >
              <option value="">All Outcomes</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Resident</th>
                  <th>Direction</th>
                  <th>Outcome</th>
                  <th>Pass Code</th>
                  <th>Override & Notes</th>
                </tr>
              </thead>
              <tbody>
                {loadingEvents ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center", padding: "30px" }}>
                      Loading audit events…
                    </td>
                  </tr>
                ) : eventsError ? (
                  <tr>
                    <td colSpan="6">
                      <div className="gate-error-state">
                        <AlertTriangle size={20} color="#e11d48" />
                        <p>{eventsError}</p>
                        <Button variant="outline" onClick={fetchEvents}>
                          <RefreshCw size={14} /> Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : eventsList.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center", padding: "30px" }}>
                      No gate verification events logged.
                    </td>
                  </tr>
                ) : (
                  eventsList.map((evt) => (
                    <tr key={evt.id}>
                      <td>
                        <strong>{new Date(evt.created_at).toLocaleDateString()}</strong>
                        <small className="block-sub">
                          {new Date(evt.created_at).toLocaleTimeString()}
                        </small>
                      </td>
                      <td>
                        <strong>{evt.students?.full_name}</strong>
                        <small className="block-sub">{evt.students?.student_id}</small>
                      </td>
                      <td>
                        <div className="flex-row items-center gap-1">
                          {evt.event_type === "exit" ? (
                            <ArrowRight size={14} color="var(--accent-solid)" />
                          ) : (
                            <ArrowLeft size={14} color="#10b981" />
                          )}
                          <strong>{evt.event_type?.toUpperCase()}</strong>
                        </div>
                      </td>
                      <td>
                        <span className={`status-pill status-${evt.outcome}`}>
                          {evt.outcome?.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {evt.gate_passes?.pass_code ? (
                          <code>{evt.gate_passes.pass_code}</code>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {evt.is_manual_override ? (
                          <div>
                            <span className="status-pill status-revoked">MANUAL OVERRIDE</span>
                            <p style={{ margin: "4px 0 0", fontSize: "12px" }}>
                              {evt.override_reason}
                            </p>
                          </div>
                        ) : evt.rejection_reason ? (
                          <span className="text-danger">{evt.rejection_reason}</span>
                        ) : (
                          <span className="text-muted">Standard scan verification</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination-row">
            <span>
              Showing {eventsList.length} of {eventsCount} events
            </span>
            <div className="flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={eventsPage === 0}
                onClick={() => setEventsPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(eventsPage + 1) * 20 >= eventsCount}
                onClick={() => setEventsPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Revocation Modal */}
      {revokingPassId && (
        <div className="gate-modal-backdrop" onClick={() => setRevokingPassId(null)}>
          <div className="panel gate-override-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header-row">
              <h3>Revoke Gate Pass</h3>
              <button
                type="button"
                className="icon-button"
                onClick={() => setRevokingPassId(null)}
              >
                ✕
              </button>
            </div>
            <p className="form-note">
              Revoking pass <strong>{revokingPassCode}</strong> will immediately invalidate the QR
              code and prevent gate verification.
            </p>

            <form onSubmit={handleRevokePass} className="override-form">
              <label>
                <strong>Reason for Revocation <span className="text-danger">*</span></strong>
                <textarea
                  placeholder="State the reason for pass revocation (e.g. Leave cancelled by admin, disciplinary action)..."
                  value={revocationReason}
                  onChange={(e) => setRevocationReason(e.target.value)}
                  rows={3}
                  required
                />
                <small>Minimum 3 characters</small>
              </label>

              <div className="form-actions" style={{ marginTop: "14px" }}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRevokingPassId(null)}
                  disabled={busyRevoke}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  disabled={busyRevoke || revocationReason.trim().length < 3}
                >
                  {busyRevoke ? "Revoking…" : "Revoke Pass"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Override Modal */}
      {showOverrideModal && (
        <div className="gate-modal-backdrop" onClick={() => setShowOverrideModal(false)}>
          <div className="panel gate-override-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header-row">
              <h3>Admin Gate Movement Override</h3>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowOverrideModal(false)}
              >
                ✕
              </button>
            </div>
            <p className="form-note">
              Direct administrative movement log. Records movement and updates student presence.
            </p>

            <form onSubmit={handleManualOverride} className="override-form">
              <label>
                <strong>Find Resident</strong>
                <input
                  type="text"
                  placeholder="Type resident name or student ID…"
                  value={overrideSearch}
                  onChange={(e) => setOverrideSearch(e.target.value)}
                />
              </label>

              {overrideSearchResults.length > 0 && (
                <div className="search-results-dropdown">
                  {overrideSearchResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`search-result-item ${overrideStudentId === s.id ? "selected" : ""}`}
                      onClick={() => {
                        setOverrideStudentId(s.id);
                        setOverrideSearch(`${s.full_name} (${s.student_id})`);
                        setOverrideSearchResults([]);
                      }}
                    >
                      <strong>{s.full_name}</strong>
                      <small>ID: {s.student_id}</small>
                    </button>
                  ))}
                </div>
              )}

              <label>
                <strong>Movement Direction</strong>
                <select
                  value={overrideDirection}
                  onChange={(e) => setOverrideDirection(e.target.value)}
                >
                  <option value="exit">Exit (Leaving campus)</option>
                  <option value="entry">Entry (Returning to campus)</option>
                </select>
              </label>

              <label>
                <strong>Override Reason <span className="text-danger">*</span></strong>
                <textarea
                  placeholder="Provide an audit justification for this administrative override..."
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
                  disabled={submittingOverride || !overrideStudentId || overrideReason.trim().length < 5}
                >
                  {submittingOverride ? "Recording…" : "Confirm Override"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
