import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Logo, ThemeToggle } from "../common/Feedback";
import { Button } from "../ui/Button";
import { useAuth } from "../../contexts/AuthContext";

export default function StaffFrame({ children }) {
  const { profile, logout } = useAuth();
  if (profile?.role !== "warden") return children;
  return (
    <main className="role-page">
      <header>
        <Logo />
        <nav className="warden-nav">
          <Link to="/warden/dashboard">Dashboard</Link>
          <Link to="/warden/complaints">Complaints</Link>
          <ThemeToggle />
          <Button
            variant="outline"
            onClick={() =>
              logout().catch((error) => toast.error(error.message))
            }
          >
            Sign out
          </Button>
        </nav>
      </header>
      <div className="warden-complaints">{children}</div>
    </main>
  );
}
