import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Archive, Megaphone, Pencil, Send } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { useQuery } from "../../hooks/useQuery";
import {
  listAnnouncements,
  saveAnnouncement,
} from "../../services/announcements";

export default function AnnouncementManager() {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const fetcher = useCallback(() => listAnnouncements({ page }), [page]);
  const query = useQuery(fetcher);
  const rows = (query.data?.rows || []).filter(
    (row) => status === "all" || row.status === status,
  );

  const clearForm = () => {
    setTitle("");
    setBody("");
    setEditingId(null);
  };
  const submit = async (action) => {
    if (!title.trim() || !body.trim()) {
      toast.error("Add an announcement title and message first.");
      return;
    }
    setBusy(true);
    try {
      const result = await saveAnnouncement({
        id: editingId,
        title: title.trim(),
        body: body.trim(),
        action,
      });
      if (action === "publish") {
        toast.success(
          `Published in-app to ${result.recipients_created} active students.`,
        );
        clearForm();
      } else {
        setEditingId(result.id);
        toast.success("Draft saved.");
      }
      await query.reload();
    } catch (error) {
      toast.error(error?.message || "Announcement could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const edit = (item) => {
    setEditingId(item.id);
    setTitle(item.title);
    setBody(item.body);
  };
  const archive = async (item) => {
    setBusy(true);
    try {
      await saveAnnouncement({
        id: item.id,
        title: item.title,
        body: item.body,
        action: "archive",
      });
      toast.success("Announcement archived.");
      await query.reload();
    } catch (error) {
      toast.error(error?.message || "Could not archive this announcement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel announcement-manager">
      <div className="section-heading">
        <div>
          <h2>Hostel-wide in-app announcements</h2>
          <p>
            Publishing creates one in-app item for each active student. Email
            and SMS are not sent.
          </p>
        </div>
      </div>
      <div className="announcement-editor-grid">
        <form
          className="announcement-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <label>
            Title
            <input
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Message
            <textarea
              maxLength={4000}
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div className="form-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void submit("draft")}
            >
              Save draft
            </Button>
            <Button
              disabled={busy || !editingId}
              onClick={() => void submit("publish")}
            >
              <Send size={15} /> Publish in app
            </Button>
          </div>
          {!editingId && (
            <small>
              Save a draft to enable publishing. Review the preview first.
            </small>
          )}
          {editingId && (
            <button type="button" className="text-action" onClick={clearForm}>
              Clear editor
            </button>
          )}
        </form>
        <aside className="announcement-preview">
          <span>
            <Megaphone size={16} /> PREVIEW
          </span>
          <h3>{title.trim() || "Announcement title"}</h3>
          <p>
            {body.trim() || "The message will appear here as students see it."}
          </p>
        </aside>
      </div>
      <div className="section-heading announcement-list-heading">
        <div>
          <h3>Announcement history</h3>
          <small>{query.data?.total ?? 0} total</small>
        </div>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>
      {query.loading && !query.data && <LoadingSkeleton />}
      {query.error && (
        <ErrorState
          message="Announcement history is unavailable. Apply the Phase 10 migration after review."
          onRetry={query.reload}
        />
      )}
      {query.data &&
        (rows.length ? (
          <div className="announcement-list">
            {rows.map((item) => (
              <article className="announcement-history-item" key={item.id}>
                <div>
                  <span className={`badge ${item.status}`}>{item.status}</span>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <small>
                    {item.published_at
                      ? `Published ${new Date(item.published_at).toLocaleString()}`
                      : `Created ${new Date(item.created_at).toLocaleString()}`}
                  </small>
                </div>
                <div className="announcement-history-stats">
                  <strong>{item.recipient_count} recipients</strong>
                  <small>{item.read_count} read</small>
                  {item.status === "draft" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => edit(item)}
                    >
                      <Pencil size={14} /> Edit
                    </Button>
                  )}
                  {item.status !== "archived" && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void archive(item)}
                    >
                      <Archive size={14} /> Archive
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No announcements in this view"
            description="Draft a message, review the preview, then publish it to active student accounts."
          />
        ))}
      {query.data?.total > 20 && (
        <div className="pagination-row">
          <span>Page {page + 1}</span>
          <div>
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Newer
            </Button>{" "}
            <Button
              variant="outline"
              disabled={(page + 1) * 20 >= query.data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Older
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
