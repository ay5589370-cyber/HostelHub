import { useCallback, useEffect, useState } from "react";
import { Copy, Shield, UserPlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ErrorState, LoadingSkeleton, PageHeader } from "../../components/common/Feedback";
import { manageSecurityGuards } from "../../services/gate";

export default function SecurityGuards() {
  const [guards, setGuards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [credential, setCredential] = useState(null);
  const [form, setForm] = useState({ full_name: "", email: "" });

  const refresh = useCallback(async () => {
    setError("");
    try {
      const result = await manageSecurityGuards({ action: "list" });
      setGuards(result.guards || []);
    } catch (err) {
      setError(err.message || "Unable to load guard accounts.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const createGuard = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(""); setError("");
    try {
      const result = await manageSecurityGuards({ action: "create", ...form });
      setCredential({ guard: result.guard, password: result.temporary_password });
      setForm({ full_name: "", email: "" });
      setNotice("Guard account created. Copy the temporary password now; it is shown only once.");
      await refresh();
    } catch (err) {
      setError(err.message || "Guard account could not be created.");
    } finally { setBusy(false); }
  };

  const setActive = async (guard) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await manageSecurityGuards({ action: "set_active", guard_id: guard.id, is_active: !guard.is_active });
      setNotice(`${guard.full_name} account ${guard.is_active ? "disabled" : "enabled"}.`);
      await refresh();
    } catch (err) { setError(err.message || "Guard account could not be updated."); }
    finally { setBusy(false); }
  };

  return <div className="security-guards-page">
    <PageHeader eyebrow="ACCESS CONTROL" title="Security guards" description="Each guard signs in with a separate account that can open only the gate scanning and verification pages." />
    <section className="panel">
      <h2><UserPlus size={20} /> Create guard account</h2>
      <form className="guard-create-form" onSubmit={createGuard}>
        <label>Full name<input className="input" value={form.full_name} maxLength={100} required onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label>
        <label>Email address<input className="input" type="email" value={form.email} maxLength={320} required onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <Button disabled={busy}><UserPlus size={16} /> Create guard</Button>
      </form>
      {notice && <p className="guard-success" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {credential && <div className="guard-credential"><strong>Temporary sign-in credential</strong><p>{credential.guard.full_name} · {credential.guard.email}</p><code>{credential.password}</code><Button variant="outline" onClick={() => navigator.clipboard.writeText(credential.password)}><Copy size={15} /> Copy password</Button><p>Share this password directly with the guard. The QR verification page will require this guard account.</p></div>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2><Shield size={20} /> Guard accounts</h2><p>Disabled accounts cannot load gate details or record movements.</p></div><Button variant="outline" onClick={() => void refresh()} disabled={loading}>Refresh</Button></div>
      {loading ? <LoadingSkeleton /> : error ? <ErrorState message={error} onRetry={refresh} /> : guards.length ? <div className="guard-table-wrap"><table><thead><tr><th>Guard</th><th>Account status</th><th>Created</th><th></th></tr></thead><tbody>{guards.map((guard) => <tr key={guard.id}><td><strong>{guard.full_name}</strong><small>{guard.email}</small></td><td><span className={`status-pill ${guard.is_active ? "active" : "revoked"}`}>{guard.is_active ? "Active" : "Disabled"}</span></td><td>{new Date(guard.created_at).toLocaleDateString()}</td><td><Button variant="outline" disabled={busy} onClick={() => void setActive(guard)}>{guard.is_active ? "Disable" : "Enable"}</Button></td></tr>)}</tbody></table></div> : <p>No security guard accounts yet.</p>}
    </section>
  </div>;
}
