import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { toast } from "sonner";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useAuth } from "../../contexts/AuthContext";
export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { logout } = useAuth();
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);
  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
    } catch {
      toast.error("Unable to sign out. Please try again.");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <div className={`app-shell ${collapsed ? "sidebar-is-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AppSidebar
        {...{ collapsed, setCollapsed, mobileOpen, setMobileOpen }}
        onLogout={() => setConfirm(true)}
      />
      <div className="main-shell">
        <AppHeader
          onMenu={() => setMobileOpen(true)}
          onLogout={() => setConfirm(true)}
        />
        <main id="main-content" className="main-content">
          <Outlet />
        </main>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        onConfirm={signOut}
        title="Sign out of HostelHub?"
        description="You can sign in again to return to your workspace."
        busy={busy}
      />
    </div>
  );
}
