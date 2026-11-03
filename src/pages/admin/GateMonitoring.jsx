import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ErrorState, LoadingSkeleton } from "../../components/common/Feedback";
import { getAdminGateMonitoring, subscribeGate } from "../../services/gate";

const dateValue = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function GateMonitoring() {
  const [date, setDate] = useState(dateValue);
  const [studentId, setStudentId] = useState("");
  const [eventType, setEventType] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setData(await getAdminGateMonitoring({ date: new Date(`${date}T12:00:00`), studentId, eventType }));
    } catch (err) {
      setError(err.message || "Gate monitoring data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [date, studentId, eventType]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);
  useEffect(() => subscribeGate(() => void refresh()), [refresh]);

  return (
    <section className="panel gate-monitoring" aria-labelledby="gate-monitoring-title">
      <div className="panel-heading">
        <div><span className="eyebrow">LIVE OPERATIONS</span><h2 id="gate-monitoring-title">Gate monitoring</h2><p>Current campus presence and verified student movements.</p></div>
        <Link className="badge subtle" to="/admin/gate">OPEN GATE MANAGEMENT</Link>
      </div>
      <div className="gate-monitoring-filters">
        <label>Date<input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Student ID<input className="input" value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="Filter student ID" /></label>
        <label>Movement<select className="input" value={eventType} onChange={(event) => setEventType(event.target.value)}><option value="">All movements</option><option value="exit">OUT</option><option value="entry">IN</option></select></label>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Refresh</Button>
      </div>
      {loading && !data ? <LoadingSkeleton /> : error ? <ErrorState message={error} onRetry={refresh} /> : data && <>
        <div className="gate-monitoring-stats">
          <div><small>Inside</small><strong>{data.inside}</strong></div>
          <div><small>Outside</small><strong>{data.outside}</strong></div>
          <div><small>Today’s exits</small><strong>{data.exits}</strong></div>
          <div><small>Today’s entries</small><strong>{data.entries}</strong></div>
          <div className={data.overdue ? "is-overdue" : ""}><small>Past return time</small><strong>{data.overdue}</strong></div>
        </div>
        {data.overdueStudents.length > 0 && <div className="gate-overdue-list"><h3><AlertTriangle size={16} /> Students past approved return</h3>{data.overdueStudents.map((row) => <p key={row.student_id}><strong>{row.students?.full_name || "Student"}</strong> · {row.students?.student_id} · Return due {new Date(row.expected_return_at).toLocaleString()}</p>)}</div>}
        <div className="gate-monitoring-table-wrap"><table><thead><tr><th>Time</th><th>Student</th><th>Movement</th><th>Gate</th><th>Recorded by</th></tr></thead><tbody>
          {data.movements.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td>{row.students?.full_name || "—"}<small>{row.students?.student_id || ""}</small></td><td>{row.event_type === "exit" ? <span className="movement-label out"><ArrowUpFromLine size={14} /> OUT</span> : <span className="movement-label in"><ArrowDownToLine size={14} /> IN</span>}</td><td>{row.gate_location || "Main Gate"}</td><td><ShieldCheck size={14} /> {row.guard?.full_name || "Unknown guard"}</td></tr>)}
          {!data.movements.length && <tr><td colSpan="5">No movements match these filters.</td></tr>}
        </tbody></table></div>
      </>}
    </section>
  );
}
