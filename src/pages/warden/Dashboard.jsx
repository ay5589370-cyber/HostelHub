import { toast } from "sonner";
import { useAuth } from "../../contexts/AuthContext";
import {
  Logo,
  ThemeToggle,
  EmptyState,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { Link } from "react-router-dom";
export function RolePlaceholder({ role, phase, children }) {
  const { logout } = useAuth();
  return (
    <main className="role-page">
      <header>
        <Logo />
        <div>
          <ThemeToggle />
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
        </div>
      </header>
      <section className="panel">
        <span className="badge">{role.toUpperCase()} WORKSPACE</span>
        <EmptyState
          title={`Welcome to your ${role.toLowerCase()} workspace`}
          description={`Your account is connected. This dashboard arrives in Phase ${phase}, with tools designed for your role.`}
        />
        {children}
      </section>
    </main>
  );
}
export default function WardenDashboard() {
  return (
    <RolePlaceholder role="Warden" phase="5">
      <Link className="button button-primary" to="/warden/complaints">
        Open complaints queue
      </Link>
      <Link className="button button-outline" to="/warden/visitors">
        Review visitor approvals
      </Link>
    </RolePlaceholder>
  );
}
