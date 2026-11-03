import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/ui/Button";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
} from "../../components/common/Feedback";
import { useAuth } from "../../contexts/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import {
  staffComplaintCategories,
  complaintStatuses,
  formatComplaintStatus,
} from "../../lib/complaintValidation";
import { listStaffComplaints } from "../../services/complaints";

const labels = (value) =>
  value ? value[0].toUpperCase() + value.slice(1) : value;

export default function StaffQueue() {
  const { profile } = useAuth();
  const prefix = profile?.role === "warden" ? "/warden" : "/admin";
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    category: "",
    priority: "",
    page: 0,
    sort: "updated_at",
    ascending: false,
  });
  const fetcher = useCallback(() => listStaffComplaints(filters), [filters]);
  const query = useQuery(fetcher);
  const set = (key, value) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? value : 0,
    }));
  const pages = Math.max(1, Math.ceil((query.data?.count || 0) / 20));
  return (
    <>
      <PageHeader
        eyebrow="RESIDENT SERVICES"
        title="Complaints & maintenance"
        description="Review reports, assign hostel staff, and track maintenance through resolution."
      />
      <div className="complaint-summary">
        {complaintStatuses.map((status) => (
          <button
            key={status}
            className={`summary-chip status-${status}`}
            onClick={() =>
              set("status", filters.status === status ? "" : status)
            }
          >
            <strong>{query.data?.summary?.[status] ?? "—"}</strong>
            <span>{formatComplaintStatus(status)}</span>
          </button>
        ))}
      </div>
      <section className="panel phase-panel">
        <div className="complaint-filters staff-complaint-filters">
          <label>
            <Search size={16} />
            <input
              value={filters.search}
              onChange={(event) => set("search", event.target.value)}
              placeholder="Complaint, student, ID, room"
            />
          </label>
          <select
            aria-label="Filter by status"
            value={filters.status}
            onChange={(event) => set("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {complaintStatuses.map((v) => (
              <option key={v} value={v}>
                {formatComplaintStatus(v)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by category"
            value={filters.category}
            onChange={(event) => set("category", event.target.value)}
          >
            <option value="">All categories</option>
            {staffComplaintCategories.map((v) => (
              <option key={v} value={v}>
                {labels(v)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by priority"
            value={filters.priority}
            onChange={(event) => set("priority", event.target.value)}
          >
            <option value="">All priorities</option>
            {["low", "normal", "high", "urgent"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <Button variant="outline" onClick={() => void query.reload()}>
            <RefreshCw size={15} /> Refresh
          </Button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className="table-sort"
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        sort: "complaint_number",
                        ascending: !f.ascending,
                      }))
                    }
                  >
                    Complaint
                  </button>
                </th>
                <th>Student / registration</th>
                <th>Room / bed</th>
                <th>Category</th>
                <th>Priority</th>
                <th>
                  <button
                    className="table-sort"
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        sort: "status",
                        ascending: !f.ascending,
                      }))
                    }
                  >
                    Status
                  </button>
                </th>
                <th>Assigned to</th>
                <th>
                  <button
                    className="table-sort"
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        sort: "updated_at",
                        ascending: !f.ascending,
                      }))
                    }
                  >
                    Last update
                  </button>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.loading ? (
                <tr>
                  <td colSpan={9}>Loading complaints…</td>
                </tr>
              ) : query.error ? (
                <tr>
                  <td colSpan={9}>
                    <ErrorState
                      message={query.error.message}
                      onRetry={query.reload}
                    />
                  </td>
                </tr>
              ) : (
                query.data.rows.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.complaint_number}</strong>
                      <small>{item.title}</small>
                    </td>
                    <td>
                      {item.student_name}
                      <small>{item.registration_id}</small>
                    </td>
                    <td>{item.room_label}</td>
                    <td>{labels(item.category)}</td>
                    <td>
                      <span className={`priority priority-${item.priority}`}>
                        {item.priority}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`complaint-status status-${item.status}`}
                      >
                        {formatComplaintStatus(item.status)}
                      </span>
                    </td>
                    <td>{item.assigned_staff_name || "Unassigned"}</td>
                    <td>{new Date(item.updated_at).toLocaleString()}</td>
                    <td>
                      <Link
                        className="button button-outline"
                        to={`${prefix}/complaints/${item.id}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!query.loading && !query.error && !query.data.rows.length && (
          <EmptyState
            title="No complaints found"
            description="There are no reports matching these filters."
          />
        )}
        <div className="pagination staff-complaint-pagination">
          <span>
            {query.data?.count || 0} complaint(s) · Page {filters.page + 1} of{" "}
            {pages}
          </span>
          <Button
            variant="outline"
            disabled={filters.page === 0}
            onClick={() => set("page", Math.max(0, filters.page - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={filters.page + 1 >= pages}
            onClick={() => set("page", filters.page + 1)}
          >
            Next
          </Button>
        </div>
      </section>
    </>
  );
}
