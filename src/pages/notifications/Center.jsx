import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import {
  PageHeader,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { useQuery } from "../../hooks/useQuery";
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../services/notifications";
import AnnouncementManager from "./AnnouncementManager";

export default function NotificationCenter({ admin = false }) {
  const [page, setPage] = useState(0);
  const role = admin ? "admin" : "student";
  const fetcher = useCallback(
    () => loadNotifications({ role, page }),
    [role, page],
  );
  const query = useQuery(fetcher);
  const rows = query.data?.rows || [];

  const readOne = async (item) => {
    try {
      await markNotificationRead(item);
      await query.reload();
    } catch {
      toast.error("Could not update this notification. Please try again.");
    }
  };
  const readAll = async () => {
    try {
      await markAllNotificationsRead();
      await query.reload();
      toast.success("Notifications marked as read.");
    } catch {
      toast.error("Could not mark notifications as read.");
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={admin ? "Administration" : "My account"}
        title="Notifications"
        description="In-app updates from the hostel modules available to your account."
      >
        {query.data?.unreadCount > 0 && (
          <Button variant="outline" onClick={readAll}>
            <CheckCheck size={16} /> Mark all as read
          </Button>
        )}
      </PageHeader>

      {query.loading && !query.data ? <LoadingSkeleton /> : null}
      {query.error && (
        <ErrorState
          message="Could not load notifications. Check the module migrations and try again."
          onRetry={query.reload}
        />
      )}
      {query.data && (
        <>
          <section
            className="panel notification-summary"
            aria-label="Notification summary"
          >
            <strong>{query.data.unreadCount} unread</strong>
            <span>{query.data.total} in-app updates available</span>
            <span>
              External email and SMS delivery is not represented in this inbox.
            </span>
          </section>
          {query.data.unavailableSources.length > 0 && (
            <p className="module-unavailable">
              Some notification modules are unavailable until their migrations
              are installed: {query.data.unavailableSources.join(", ")}.
            </p>
          )}
          {rows.length ? (
            <div className="notification-list">
              {rows.map((item) => (
                <article
                  className={`panel notification-item ${item.read_at ? "is-read" : "is-unread"}`}
                  key={`${item.source}:${item.id}`}
                >
                  <span className="notification-item-icon">
                    <Bell size={18} />
                  </span>
                  <div className="notification-item-body">
                    <div className="notification-item-heading">
                      <h2>{item.title}</h2>
                      {!item.read_at && (
                        <span className="notification-unread-badge">New</span>
                      )}
                    </div>
                    <p>{item.message}</p>
                    <small>
                      {item.source} ·{" "}
                      {new Date(item.created_at).toLocaleString()}
                    </small>
                    <div className="notification-actions">
                      <Link
                        to={item.href}
                        onClick={() => !item.read_at && void readOne(item)}
                      >
                        Open related page
                      </Link>
                      {!item.read_at && (
                        <button
                          className="text-action"
                          onClick={() => void readOne(item)}
                        >
                          <Check size={15} /> Mark as read
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No notifications yet"
              description="Updates from enabled hostel modules will appear here."
            />
          )}
          <div className="pagination-row">
            <span>
              Showing {rows.length} of {query.data.total}
            </span>
            <div>
              <Button
                variant="outline"
                disabled={page === 0 || query.loading}
                onClick={() => setPage((current) => current - 1)}
              >
                Newer
              </Button>{" "}
              <Button
                variant="outline"
                disabled={!query.data.hasMore || query.loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Older
              </Button>
            </div>
          </div>
        </>
      )}

      {admin && (
        <>
          <AnnouncementManager />
          <section className="panel guardian-readiness">
            <h2>Parent communication</h2>
            <p>
              Outbound parent alerts are disabled. Guardian records currently
              have contact details but no verified-contact or consent workflow,
              and this project has no general email/SMS delivery worker.
            </p>
            <ul>
              <li>
                Verify each guardian contact using a controlled server-side
                process.
              </li>
              <li>
                Record the required student/guardian consent and channel
                preferences.
              </li>
              <li>
                Configure an approved provider server-side and keep delivery and
                idempotency logs.
              </li>
            </ul>
            <small>No external message has been sent by this feature.</small>
          </section>
        </>
      )}
    </div>
  );
}
