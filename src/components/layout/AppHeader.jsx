import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  ChevronDown,
  Search,
  Menu as MenuIcon,
  Settings,
  LogOut,
  Check,
} from "lucide-react";
import { ThemeToggle, UserAvatar } from "../common/Feedback";
import { Button } from "../ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { navigation } from "../../routes/navigation";
import { useQuery } from "../../hooks/useQuery";
import {
  loadNotifications,
  markNotificationRead,
} from "../../services/notifications";
import { toast } from "sonner";
export function NotificationDropdown() {
  const { profile } = useAuth();
  const role = profile?.role === "admin" ? "admin" : "student";
  const fetcher = useCallback(
    () => loadNotifications({ role, page: 0, pageSize: 5 }),
    [role],
  );
  const query = useQuery(fetcher);
  const rows = query.data?.rows || [];
  const read = async (item) => {
    try {
      await markNotificationRead(item);
      await query.reload();
    } catch {
      toast.error("Could not update this notification.");
    }
  };
  const inbox =
    role === "admin" ? "/admin/notifications" : "/student/notifications";
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          className="icon-button"
          aria-label="Notifications"
        >
          <Bell size={20} />
          {query.data?.unreadCount > 0 && (
            <span className="notification-count">
              {query.data.unreadCount > 99 ? "99+" : query.data.unreadCount}
            </span>
          )}
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="dropdown notification-dropdown"
          align="end"
          sideOffset={12}
        >
          <div className="notification-dropdown-heading">
            <h3>Notifications</h3>
            <Link to={inbox}>View all</Link>
          </div>
          {query.loading && !query.data && <p>Loading notifications…</p>}
          {query.error && (
            <p role="alert">Notifications are temporarily unavailable.</p>
          )}
          {!query.loading && !query.error && rows.length === 0 && (
            <p>You’re all caught up.</p>
          )}
          {rows.map((item) => (
            <div
              className={`notification-dropdown-row ${item.read_at ? "" : "unread"}`}
              key={`${item.source}:${item.id}`}
            >
              <Link
                to={item.href}
                onClick={() => !item.read_at && void read(item)}
              >
                <strong>{item.title}</strong>
                <small>{item.message}</small>
              </Link>
              {!item.read_at && (
                <button
                  aria-label="Mark notification as read"
                  onClick={() => void read(item)}
                >
                  <Check size={15} />
                </button>
              )}
            </div>
          ))}
          <Link className="notification-dropdown-footer" to={inbox}>
            Open notification center
          </Link>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function AppHeader({ onMenu, onLogout }) {
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const results = search.trim()
    ? navigation.filter((n) =>
        n.label.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : [];
  return (
    <header className="app-header">
      <Button
        variant="ghost"
        className="mobile-only icon-button"
        aria-label="Open navigation"
        onClick={onMenu}
      >
        <MenuIcon size={21} />
      </Button>
      <div className="header-breadcrumb">
        Workspace <span>/</span> <strong>Administration</strong>
      </div>
      <div className="header-tools">
        <div className="search-wrap">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (results[0]) {
                navigate(`/admin/${results[0].path}`);
                setSearch("");
              }
            }}
          >
            <Search size={17} />
            <input
              aria-label="Search navigation"
              placeholder="Search workspace…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearch("");
              }}
            />
          </form>
          {search && (
            <div className="search-results">
              <small>NAVIGATE TO</small>
              {results.length ? (
                results.map((n) => (
                  <Link
                    key={n.path}
                    to={`/admin/${n.path}`}
                    onClick={() => setSearch("")}
                  >
                    {n.label}
                    {n.phase &&
                      n.path !== "fees" &&
                      n.path !== "complaints" && <span>Phase {n.phase}</span>}
                  </Link>
                ))
              ) : (
                <p>No matching pages.</p>
              )}
            </div>
          )}
        </div>
        <ThemeToggle />
        <NotificationDropdown />
        <span className="header-divider" />
        <Menu.Root>
          <Menu.Trigger asChild>
            <button className="profile-trigger" aria-label="Open account menu">
              <UserAvatar name={profile?.full_name || "Admin"} />
              <span>
                <strong>{profile?.full_name || "Administrator"}</strong>
                <small>Administrator</small>
              </span>
              <ChevronDown size={15} />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="dropdown" align="end" sideOffset={12}>
              <Menu.Label className="menu-label">{profile?.email}</Menu.Label>
              <Menu.Item asChild>
                <Link to="/admin/settings">
                  <Settings size={16} /> Account settings
                </Link>
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item onSelect={onLogout}>
                <LogOut size={16} /> Sign out
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </header>
  );
}
