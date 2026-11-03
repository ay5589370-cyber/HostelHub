import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../contexts/AuthContext";
import { ThemeToggle, Logo } from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { QrScanner } from "../../components/gate/QrScanner";
import { verifyGatePassWithEdge } from "../../services/gate";

function dateTime(value) { return value ? new Date(value).toLocaleString() : "—"; }

export default function GateVerify({ scan = false }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const [searchParams] = useSearchParams();
  const passId = searchParams.get("pass_id") || "";
  const token = new URLSearchParams(routeLocation.hash.slice(1)).get("token") || searchParams.get("token") || "";
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [location, setLocation] = useState("Main Gate");
  const [remarks, setRemarks] = useState("");
  const readyToVerify = Boolean(passId && token);

  const loadPass = useCallback(async () => {
    if (!readyToVerify) return;
    setLoading(true); setError(""); setConfirmation("");
    try {
      const data = await verifyGatePassWithEdge({ action: "verify", pass_id: passId, token });
      setStudent(data);
    } catch (err) {
      setStudent(null);
      setError(err.message || "This QR pass is invalid or expired.");
    } finally { setLoading(false); }
  }, [readyToVerify, passId, token]);

  useEffect(() => { void loadPass(); }, [loadPass]);

  const nextAction = useMemo(() => student?.movement_status === "inside" ? "OUT" : student?.movement_status === "outside" ? "IN" : null, [student]);
  const recordMovement = async () => {
    if (!nextAction || busy) return;
    setBusy(true); setError(""); setConfirmation("");
    try {
      const result = await verifyGatePassWithEdge({ action: nextAction, pass_id: passId, token, location, remarks, idempotency_key: crypto.randomUUID() });
      setStudent((current) => ({ ...current, movement_status: result.movement_status }));
      setConfirmation(nextAction === "OUT" ? `OUT recorded for ${result.student_name}.` : `IN recorded for ${result.student_name}.`);
      toast.success(nextAction === "OUT" ? "Student marked OUT." : "Student marked IN.");
      setRemarks("");
      if (nextAction === "IN") window.setTimeout(() => navigate("/gate/scan", { replace: true }), 1400);
    } catch (err) {
      setError(err.message || `Could not record ${nextAction}.`);
    } finally { setBusy(false); }
  };

  const handleScan = (payload) => {
    if (!payload.pass_id || !payload.token) {
      setError("This QR code is not a secure HostelHub gate URL. Ask the student to reopen their current pass.");
      return;
    }
    const verifyUrl = new URL("/gate/verify", window.location.origin);
    verifyUrl.searchParams.set("pass_id", payload.pass_id);
    verifyUrl.hash = new URLSearchParams({ token: payload.token }).toString();
    navigate(`${verifyUrl.pathname}${verifyUrl.search}${verifyUrl.hash}`);
  };

  return <main className="gate-verify-page">
    <header className="gate-verify-header"><Logo /><div className="gate-verify-header-actions"><ThemeToggle /><Button variant="ghost" onClick={() => logout().then(() => navigate("/login")).catch(() => toast.error("Unable to sign out."))}><LogOut size={16} /> Sign out</Button></div></header>
    <section className="gate-verify-card">
      <div className="gate-verify-title"><span className="gate-verify-icon"><ShieldCheck size={24} /></span><div><span className="eyebrow">HOSTELHUB · SECURITY</span><h1>{readyToVerify ? "Gate pass verification" : "Student gate verification"}</h1><p>Confirm each movement at the gate. Every successful action is saved to the audit log.</p></div></div>
      {scan && <div className="gate-scan-start"><h2>Scan student QR pass</h2><p>Camera access requires a secure connection. Use the pass URL directly from Google Lens as well.</p><QrScanner onScan={handleScan} disabled={loading || busy} /></div>}
      {!readyToVerify && !scan && <p className="gate-verify-error" role="alert">No QR token was provided. Scan the student's current gate pass.</p>}
      {loading && <div className="gate-verify-loading" role="status">Checking the pass with HostelHub…</div>}
      {error && <div className="gate-verify-error" role="alert">{error}</div>}
      {confirmation && <div className="gate-verify-confirmation" role="status"><CheckCircle2 size={18} /> {confirmation}</div>}
      {student && <>
        <div className="gate-verify-student">{student.photo_url ? <img className="student-avatar" src={student.photo_url} alt="" /> : <div className="gate-verify-avatar">{student.student_name?.slice(0, 1)?.toUpperCase() || "S"}</div>}<div><h2>{student.student_name}</h2><p>Student ID: <strong>{student.student_id}</strong></p><p>{student.room_number} · {student.hostel_name}</p></div><span className={`movement-status ${student.movement_status}`}>{student.movement_status === "inside" ? "INSIDE" : "OUTSIDE"}</span></div>
        <div className="gate-verify-details">
          <div><small>Leave type</small><strong>{student.leave_type === "day_out" ? "Day-Out" : "Night-Out"}</strong></div>
          <div><small>Approval status</small><strong>{student.leave_status}</strong></div>
          <div><small>Approved departure</small><strong>{dateTime(student.departure_at)}</strong></div>
          <div><small>Approved return</small><strong>{dateTime(student.expected_return_at)}</strong></div>
        </div>
        <label className="gate-verify-field">Gate location<input className="input" value={location} maxLength={100} onChange={(event) => setLocation(event.target.value)} /></label>
        <label className="gate-verify-field">Remarks (optional)<textarea className="input" value={remarks} maxLength={500} rows={2} onChange={(event) => setRemarks(event.target.value)} /></label>
        <Button className={`gate-movement-action ${nextAction === "IN" ? "mark-in" : "mark-out"}`} disabled={!nextAction || busy || loading} onClick={() => void recordMovement()}>{nextAction === "OUT" ? <><ArrowUpFromLine size={19} /> MARK OUT</> : nextAction === "IN" ? <><ArrowDownToLine size={19} /> MARK IN</> : "Pass completed"}</Button>
      </>}
    </section>
    <p className="gate-verify-footer">Guard account required · Movements are timestamped by the HostelHub server.</p>
  </main>;
}
