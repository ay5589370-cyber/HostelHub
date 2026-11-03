import { Inbox, AlertCircle, Building2, Sun, Moon } from "lucide-react";
import { Button } from "../ui/Button";
import { useTheme } from "../../contexts/ThemeContext";
export function Logo() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Building2 size={24} />
      </span>
      <span>
        Hostel<span className="brand-accent">Hub</span>
        <small>SMART CAMPUS LIVING</small>
      </span>
    </div>
  );
}
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      className="icon-button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
    </Button>
  );
}
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  children,
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function LoadingSkeleton() {
  return (
    <div className="skeleton-group" role="status" aria-label="Loading">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton short" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
export function ErrorState({
  onRetry,
  message = "We couldn’t load this information. Please try again.",
}) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle />
      <p>{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function PageHeader({ eyebrow, title, description, children }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function UserAvatar({ name = "User" }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
