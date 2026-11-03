import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase, setupError } from "../lib/supabase";
import { canAccess, homeFor } from "../utils/access";
import {
  ErrorState,
  LoadingSkeleton,
  Logo,
} from "../components/common/Feedback";
export function SetupNotice() {
  return (
    <main className="setup-page">
      <Logo />
      <div className="panel">
        <span className="badge">SETUP REQUIRED</span>
        <h1>Your campus starts here.</h1>
        <p>{setupError}</p>
        <ol>
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code>.
          </li>
          <li>Add your Supabase project URL and public client key.</li>
          <li>
            Apply the SQL migration and provision your administrator using
            README.md.
          </li>
          <li>
            Restart with <code>npm run dev</code>.
          </li>
        </ol>
        <p>No account credentials are included in this project.</p>
      </div>
    </main>
  );
}
export function ProtectedRoute() {
  const { session, profile, loading, error, refreshProfile } = useAuth();
  if (!supabase) return <SetupNotice />;
  if (loading)
    return (
      <main className="loading-page">
        <LoadingSkeleton />
      </main>
    );
  if (error) return <ErrorState message={error} onRetry={refreshProfile} />;
  if (!session) return <Navigate to="/login" replace />;
  if (profile?.role === "student" && profile.must_change_password)
    return <Navigate to="/reset-password?first=1" replace />;
  return <Outlet />;
}
export function RoleGuard({ role }) {
  const { profile } = useAuth();
  return canAccess(profile, role) ? (
    <Outlet />
  ) : (
    <Navigate to="/unauthorized" replace />
  );
}
export function HomeRedirect() {
  const { profile, session, loading } = useAuth();
  if (loading) return <LoadingSkeleton />;
  return <Navigate to={session ? homeFor(profile) : "/login"} replace />;
}
