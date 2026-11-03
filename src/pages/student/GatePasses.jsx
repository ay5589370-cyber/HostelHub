import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { QrPassModal } from "../../components/gate/QrPassModal";
import { listMyGatePasses } from "../../services/gate";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, LoadingSkeleton, Logo, ThemeToggle } from "../../components/common/Feedback";
import { listStudentLeaves, subscribeLeaves } from "../../services/leaves";

export default function GatePasses() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [passRequestId, setPassRequestId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The leave request RLS policy limits this query to the signed-in student.
      const [result, passes] = await Promise.all([listStudentLeaves(), listMyGatePasses()]);
      const passesByRequest = new Map(passes.map((pass) => [pass.leave_request_id, pass]));
      setRows(result.rows
        .filter((row) => ["approved", "completed"].includes(row.status))
        .map((row) => ({ ...row, gatePass: passesByRequest.get(row.id) || null })));
    } catch (err) {
      setError(err.message || "Unable to load your gate passes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return subscribeLeaves(refresh);
  }, [refresh]);

  return (
    <main className="auth-page">
      <header className="auth-header"><Link to="/student/dashboard"><Logo /></Link><ThemeToggle /></header>
      <section className="auth-card" style={{ width: "min(760px, 100%)" }}>
        <div className="section-heading">
          <div><ShieldCheck size={22} /><h1>My Gate Passes</h1></div>
          <Button variant="outline" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</Button>
        </div>
        <p>Digital passes are available only for approved Day-Out and Night-Out requests. Gate staff must verify your identity at the checkpoint.</p>
        {loading ? <LoadingSkeleton /> : error ? <ErrorState message={error} onRetry={refresh} /> : rows.length === 0 ? (
          <EmptyState title="No approved passes" description="Approved Day-Out and Night-Out requests will appear here." />
        ) : (
          <div className="leave-list">
            {rows.map((request) => (
              <article className="leave-card" key={request.id}>
                <div><strong>{request.leave_type === "day_out" ? "Day-Out" : "Night-Out"}</strong><span className={`status-pill ${request.gatePass?.status || request.status}`}>{request.gatePass?.status ? request.gatePass.status.replaceAll("_", " ") : request.status === "completed" ? "Returned" : "Approved"}</span></div>
                <p>{new Date(request.departure_at).toLocaleString()} → {new Date(request.expected_return_at).toLocaleString()}</p>
                <p><b>Request:</b> {request.request_number}</p>
                {request.gatePass?.exit_used_at && <p><b>Actual exit:</b> {new Date(request.gatePass.exit_used_at).toLocaleString()}</p>}
                {request.gatePass?.entry_used_at && <p><b>Actual return:</b> {new Date(request.gatePass.entry_used_at).toLocaleString()}</p>}
                {request.status === "approved" && <Button variant="primary" onClick={() => setPassRequestId(request.id)}><QrCode size={15} /> Open digital pass</Button>}
                {request.status === "completed" && <small>Return recorded by gate staff. See Leave History for request details.</small>}
              </article>
            ))}
          </div>
        )}
        <p><Link to="/student/leave">Manage leave requests</Link></p>
      </section>
      <QrPassModal leaveRequestId={passRequestId} open={!!passRequestId} onClose={() => setPassRequestId(null)} />
    </main>
  );
}
