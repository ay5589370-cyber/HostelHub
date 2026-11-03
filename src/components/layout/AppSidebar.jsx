import { NavLink } from "react-router-dom";
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "../common/Feedback";
import { Button } from "../ui/Button";
import { navigation } from "../../routes/navigation";
export function AppSidebar({
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen,
  onLogout,
}) {
  return (
    <>
      <button
        className={`mobile-backdrop ${mobileOpen ? "visible" : ""}`}
        aria-label="Close navigation"
        onClick={() => setMobileOpen(false)}
      />
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
      >
        <div className="sidebar-top">
          <Logo />
          <Button
            variant="ghost"
            className="mobile-only icon-button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </Button>
        </div>
        <div className="workspace">
          <span className="workspace-icon">H</span>
          <span className="nav-copy">
            <strong>Campus workspace</strong>
            <small>Administration</small>
          </span>
          <span className="status-dot" />
        </div>
        <div className="nav-heading nav-copy">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ label, path, icon: Icon, phase }) => (
            <NavLink
              key={path}
              to={`/admin/${path}`}
              title={label}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} />
              <span className="nav-copy">{label}</span>
              {phase && path !== "fees" && path !== "complaints" && (
                <span className="nav-soon nav-copy">Soon</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note nav-copy">
            <ShieldCheck size={21} />
            <strong>A foundation you can trust</strong>
            <p>
              Connected campus.
              <br />
              Thoughtfully managed.
            </p>
            <span>
              PHASE 02 <i />
            </span>
          </div>
          <Button
            variant="ghost"
            onClick={onLogout}
            className="sidebar-logout"
            title="Sign out"
          >
            <LogOut size={18} />
            <span className="nav-copy">Sign out</span>
          </Button>
          <Button
            variant="ghost"
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <>
                <PanelLeftClose size={18} />
                <span>Collapse sidebar</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}
