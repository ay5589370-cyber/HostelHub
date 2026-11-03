import { Link } from "react-router-dom";
import { useEffect } from "react";
import {
  Users,
  DoorOpen,
  BedDouble,
  CalendarClock,
  LogOut,
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Activity,
  Settings,
  ShieldCheck,
  RefreshCw,
  Building2,
} from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { getDashboard } from "../../services/profiles";
import { subscribePhase2 } from "../../services/students";
import { subscribeLeaves } from "../../services/leaves";
import { formatDate } from "../../lib/utils";
import {
  EmptyState,
  LoadingSkeleton,
  ErrorState,
  UserAvatar,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { StatCard } from "../../components/dashboard/StatCard";
import { OccupancyChart } from "../../components/dashboard/OccupancyChart";
export default function Dashboard() {
  const { data, loading, error, reload } = useQuery(getDashboard);
  useEffect(() => subscribePhase2(reload), [reload]);
  useEffect(() => subscribeLeaves(reload), [reload]);
  const pageHeader = (
    <header className="admin-overview-hero">
      <span className="admin-overview-icon" aria-hidden="true">
        <Building2 size={22} />
      </span>
      <div className="admin-overview-copy">
        <span className="eyebrow">HOSTEL OPERATIONS</span>
        <h1>Hostel overview</h1>
        <p>Occupancy, resident services, and daily activity in one place.</p>
      </div>
      <span className="date-chip">
        <CalendarDays size={16} />
        {formatDate()}
      </span>
    </header>
  );
  if (loading)
    return (
      <>
        {pageHeader}
        <LoadingSkeleton />
      </>
    );
  if (error || !data)
    return (
      <>
        {pageHeader}
        <ErrorState
          message={error?.message || "Dashboard data is unavailable."}
          onRetry={reload}
        />
      </>
    );
  return (
    <div className="admin-dashboard">
      {pageHeader}
      <div className="section-heading">
        <h2>
          Overview <span className="badge subtle">LIVE DATA</span>
        </h2>
        <Button variant="ghost" onClick={reload} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState onRetry={reload} />
      ) : (
        <div className="stats-grid">
          <StatCard
            label="Active Students"
            value={data.students}
            icon={Users}
            to="/admin/students"
            caption="Active student records"
          />
          <StatCard
            label="Total Rooms"
            icon={DoorOpen}
            value={data.rooms}
            color="blue"
            to="/admin/rooms"
            caption="Room records"
          />
          <StatCard
            label="Total Beds"
            icon={BedDouble}
            value={data.total_beds}
            color="blue"
            to="/admin/rooms"
            caption="All bed records, including unavailable beds"
          />
          <StatCard
            label="Occupied Beds"
            icon={BedDouble}
            value={data.occupied}
            color="teal"
            to="/admin/rooms"
            caption="Active bed allocations"
          />
          <StatCard
            label="Available Beds"
            icon={BedDouble}
            value={data.available}
            color="green"
            to="/admin/rooms"
            caption="Available beds in available rooms and active hostels"
          />
          <StatCard
            label="Students without allocation"
            icon={Users}
            value={Math.max(
              0,
              Number(data.students || 0) - Number(data.occupied || 0),
            )}
            color="blue"
            to="/admin/students"
            caption="Active students minus active allocations"
          />
          <StatCard
            label="Maintenance or unavailable beds"
            icon={BedDouble}
            value={Math.max(
              0,
              Number(data.total_beds || 0) -
                Number(data.occupied || 0) -
                Number(data.available || 0),
            )}
            color="rose"
            to="/admin/rooms"
            caption="Total beds minus active allocations and available beds"
          />
          <StatCard
            label="Pending Leave Requests"
            icon={CalendarClock}
            value={
              data.modules.leave.available
                ? (data.leave?.pending ?? 0)
                : "Unavailable"
            }
            color="amber"
            to="/admin/leave-requests"
            caption={
              data.modules.leave.available
                ? "Current pending requests"
                : data.modules.leave.error
            }
          />
          <StatCard
            label="Students Currently Outside"
            icon={LogOut}
            value="Unavailable"
            color="rose"
            caption={data.modules.gate.error}
          />
          <StatCard
            label="Pending fee invoices"
            icon={CalendarClock}
            value={
              data.modules.fees.available
                ? data.modules.fees.data.pending
                : "Unavailable"
            }
            to="/admin/fees"
            color="amber"
            caption={data.modules.fees.error || "Invoice status = pending"}
          />
          <StatCard
            label="Partially paid invoices"
            icon={CalendarClock}
            value={
              data.modules.fees.available
                ? data.modules.fees.data.partially_paid
                : "Unavailable"
            }
            to="/admin/fees?status=partially_paid"
            color="blue"
            caption={
              data.modules.fees.error ||
              "Outstanding balance after verified partial payment"
            }
          />
          <StatCard
            label="Overdue fee invoices"
            icon={CalendarClock}
            value={
              data.modules.fees.available
                ? data.modules.fees.data.overdue
                : "Unavailable"
            }
            to="/admin/fees"
            color="rose"
            caption={data.modules.fees.error || "Invoice status = overdue"}
          />
          <StatCard
            label="Open complaints"
            icon={Activity}
            value={
              data.modules.complaints.available
                ? data.modules.complaints.data.open
                : "Unavailable"
            }
            to="/admin/complaints"
            color="amber"
            caption={
              data.modules.complaints.error || "Excludes resolved and closed"
            }
          />
          <StatCard
            label="Unresolved maintenance tasks"
            icon={Settings}
            value={
              data.modules.maintenance.available
                ? data.modules.maintenance.data.open
                : "Unavailable"
            }
            to="/admin/complaints"
            caption={
              data.modules.maintenance.available
                ? "Open, scheduled or in-progress tasks"
                : data.modules.maintenance.error
            }
          />
          <StatCard
            label="Upcoming maintenance visits · 7 days"
            icon={CalendarClock}
            value={
              data.modules.maintenance.available
                ? data.modules.maintenance.data.upcoming_visits_7_days
                : "Unavailable"
            }
            to="/admin/complaints"
            color="blue"
            caption={
              data.modules.maintenance.available
                ? "Scheduled visits in the next seven days"
                : data.modules.maintenance.error
            }
          />
          <StatCard
            label="Mess feedback average"
            icon={Activity}
            value={
              data.modules.mess.available
                ? (data.modules.mess.data.feedback?.average_rating ?? "—")
                : "Unavailable"
            }
            to="/admin/mess"
            caption={
              data.modules.mess.error || "Current default summary window"
            }
          />
        </div>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Hostel occupancy</h2>
              <p>Active allocations and currently available beds</p>
            </div>
            <span className="badge subtle">PHASE 2</span>
          </div>
          {loading ? (
            <LoadingSkeleton />
          ) : error ? (
            <ErrorState onRetry={reload} />
          ) : (
            <>
              <OccupancyChart
                data={
                  data.total_beds
                    ? [
                        { name: "Occupied", value: data.occupied },
                        { name: "Available", value: data.available },
                        {
                          name: "Maintenance / inactive",
                          value: Math.max(
                            0,
                            data.total_beds - data.occupied - data.available,
                          ),
                        },
                      ]
                    : []
                }
              />
              <div className="hostel-occupancy">
                {data.hostels.map((h) => (
                  <div key={h.name + h.block}>
                    <p>
                      <span>
                        {h.name} · {h.block}
                      </span>
                      <strong>
                        {h.beds ? Math.round((h.occupied / h.beds) * 100) : 0}%
                      </strong>
                    </p>
                    <progress
                      value={h.occupied}
                      max={h.beds || 1}
                      aria-label={h.name + " occupancy"}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="panel-foot">
            <span>
              <i className="legend-dot" />
              Occupied beds
            </span>
            <span>
              <i className="legend-dot teal" />
              Available beds
            </span>
            <span>Other beds are not counted available or allocated.</span>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Leave request overview</h2>
              <p>Every request, accounted for</p>
            </div>
            <Link className="badge subtle" to="/admin/leave-requests">
              VIEW REQUESTS
            </Link>
          </div>
          {!data.modules.leave.available ? (
            <p className="module-unavailable">
              Leave metrics unavailable: {data.modules.leave.error}
            </p>
          ) : data.leave?.recent_decisions?.length ? (
            <ul className="activity-list">
              {data.leave.recent_decisions.map((item) => (
                <li key={item.id}>
                  <UserAvatar name={item.request_number} />
                  <div>
                    <strong>{item.request_number}</strong>
                    <p>
                      {item.status.replace("_", " ")} · departure{" "}
                      {formatDate(new Date(item.departure_at))}
                    </p>
                  </div>
                  <time dateTime={item.updated_at}>
                    {formatDate(new Date(item.updated_at))}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CalendarClock}
              title="No decisions yet"
              description="Submitted leave requests will appear here for review."
            />
          )}
          <div className="panel-foot">
            <span>
              {data.modules.leave.available
                ? `${data.leave?.pending || 0} pending`
                : "Pending requests unavailable"}
            </span>
            <span>
              {data.modules.leave.available
                ? `${data.leave?.upcoming || 0} upcoming departures`
                : "Leave module unavailable"}
            </span>
            <span>
              {data.modules.leave.available
                ? `${data.leave?.overdue || 0} overdue`
                : ""}
            </span>
          </div>
        </section>
        <section className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent registrations</h2>
              <p>Your newest active and inactive student records</p>
            </div>
            <Activity size={18} />
          </div>
          {loading ? (
            <LoadingSkeleton />
          ) : error ? (
            <ErrorState onRetry={reload} />
          ) : data.recent.length ? (
            <ul className="activity-list">
              {data.recent.map((item) => (
                <li key={item.id}>
                  <UserAvatar name={item.full_name || "User"} />
                  <div>
                    <strong>{item.full_name || "Unnamed profile"}</strong>
                    <p>
                      {item.student_id}
                      {" · "}
                      student registered
                    </p>
                  </div>
                  <time dateTime={item.created_at}>
                    {formatDate(new Date(item.created_at))}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Your campus story starts here"
              description="New students will appear here after registration."
            />
          )}
          <div className="panel-foot">
            Sorted by student record creation time; not a complete audit log.
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Quick actions</h2>
              <p>A head start on your next task</p>
            </div>
            <ArrowUpRight size={18} />
          </div>
          <div className="quick-actions">
            <Link to="/admin/settings">
              <span className="action-icon">
                <Settings size={19} />
              </span>
              <span>
                <strong>Account settings</strong>
                <small>Keep your details up to date</small>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/admin/students">
              <span className="action-icon">
                <Users size={19} />
              </span>
              <span>
                <strong>Student management</strong>
                <small>Register and manage residents</small>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/admin/rooms">
              <span className="action-icon">
                <DoorOpen size={19} />
              </span>
              <span>
                <strong>Rooms & beds</strong>
                <small>View occupancy and manage allocations</small>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/admin/reports">
              <span className="action-icon">
                <Activity size={19} />
              </span>
              <span>
                <strong>Reports & analytics</strong>
                <small>Export filtered operational reports</small>
              </span>
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="secure-note">
            <ShieldCheck size={16} /> Access protected by Supabase Auth & RLS
          </div>
        </section>
      </div>
    </div>
  );
}
