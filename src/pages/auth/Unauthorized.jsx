import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../contexts/AuthContext";
import { homeFor } from "../../utils/access";
import { EmptyState } from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
export default function Unauthorized() {
  const { profile, session, logout } = useAuth();
  return (
    <main className="center-page">
      <section className="panel">
        <EmptyState
          icon={ShieldAlert}
          title="This workspace isn’t available to you"
          description="Your account may be inactive, missing its profile, or assigned to a different role. Contact your institution if you need access."
        >
          {homeFor(profile) !== "/unauthorized" && (
            <Link className="button button-primary" to={homeFor(profile)}>
              Go to my dashboard
            </Link>
          )}
          {session ? (
            <Button
              variant="outline"
              onClick={() =>
                logout().catch(() =>
                  toast.error("Unable to sign out. Try again."),
                )
              }
            >
              Sign out
            </Button>
          ) : (
            <Link to="/login">Back to sign in</Link>
          )}
        </EmptyState>
      </section>
    </main>
  );
}
