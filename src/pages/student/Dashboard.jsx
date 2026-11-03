import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  CircleX,
  Clock3,
  MapPinned,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../contexts/AuthContext";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Logo,
  ThemeToggle,
} from "../../components/common/Feedback";
import { StudentAvatar } from "../../components/common/StudentAvatar";
import { Button } from "../../components/ui/Button";
import { useQuery } from "../../hooks/useQuery";
import { activeAllocation } from "../../services/students";
import { loadStudentDashboard } from "../../services/studentDashboard";
import { subscribeLeaves } from "../../services/leaves";
import { formatLeaveStatus } from "../../lib/leaveValidation";
import StudentProfile from "../admin/StudentProfile";

function StudentWorkspace({ children, dashboard = false }) {
  const { logout } = useAuth();
  return (
    <main className={"student-workspace" + (dashboard ? " student-dashboard" : "")}>
      <header>
        <Logo />
        <nav aria-label="Student navigation">
          <Link to="/student/dashboard">Dashboard</Link>
          <Link to="/student/profile">My profile</Link>
          <Link to="/student/leave">Leave</Link>
          <Link to="/student/fees">Fees</Link>
          <Link to="/student/complaints">Complaints</Link>
          <ThemeToggle />
          <Button
            variant="outline"
            onClick={() => logout().catch((error) => toast.error(error.message))}
          >
            Sign out
          </Button>
        </nav>
      </header>
      {children}
    </main>
  );
}

const mealOrder = ["breakfast", "lunch", "dinner"];
const mealNames = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const ringLength = 276.46;

function atMealTime(date, value) {
  const [hours, minutes, seconds = 0] = value.split(":").map(Number);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    seconds,
  );
}

function formatCountdown(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return { main: `${hours}:${minutes}`, seconds };
}

function TodayMealCard({ messRoutine }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!messRoutine.available) {
    return (
      <section className="panel student-today-meal" aria-label="Today's meal">
        <div>
          <div className="eyebrow">TODAY AT THE MESS</div>
          <h2>Today's meal</h2>
          <p className="module-unavailable" role="status">{messRoutine.error}</p>
        </div>
      </section>
    );
  }

  const meals = mealOrder.map((meal_slot) => {
    const menu = messRoutine.data.routine.find(
      (row) => row.weekday === now.getDay() && row.meal_slot === meal_slot,
    );
    const time = messRoutine.data.times.find((row) => row.meal_slot === meal_slot);
    if (!time?.serving_start || !time?.serving_end) return null;
    return {
      meal_slot,
      menu_text: menu?.menu_text?.trim() || "Menu not posted yet",
      start: atMealTime(now, time.serving_start),
      end: atMealTime(now, time.serving_end),
    };
  }).filter(Boolean);

  const current = meals.find((meal) => now >= meal.start && now < meal.end);
  const next = meals.find((meal) => meal.start > now);
  const meal = current || next;
  let stateLabel = current ? "Serving now" : "Next meal";
  let countdownLabel = current ? "Meal ends in" : "Starts in";
  let target = current?.end || next?.start || null;
  let baseline = null;
  if (current) baseline = current.start;
  else if (next) baseline = meals.filter((item) => item.end <= now).at(-1)?.end || new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const remaining = target ? target.getTime() - now.getTime() : 0;
  const totalWindow = target && baseline ? target.getTime() - baseline.getTime() : 0;
  const progress = target && totalWindow > 0
    ? Math.max(0, Math.min(1, remaining / totalWindow))
    : 0;
  const countdown = target ? formatCountdown(remaining) : null;
  const dateLabel = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <section className="panel student-today-meal" aria-label="Today's meal">
      <div className="student-today-meal-copy">
        <div className="eyebrow">TODAY AT THE MESS</div>
        <h2>Today's meal</h2>
        <p className="student-today-meal-date">{dateLabel}</p>
        {meal ? (
          <>
            <span className={`student-meal-state${current ? " is-current" : ""}`}>
              {stateLabel}
            </span>
            <h3>{mealNames[meal.meal_slot]}</h3>
            <p className="student-today-menu">{meal.menu_text}</p>
            <p className="student-today-meal-time">
              {meal.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {" – "}
              {meal.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
          </>
        ) : (
          <>
            <span className="student-meal-state">Done for today</span>
            <h3>No more meals scheduled today</h3>
            <p className="student-today-menu">Check back tomorrow for the next day's meal routine.</p>
          </>
        )}
      </div>
      <div
        className="student-meal-countdown"
        role="timer"
        aria-label={countdown ? `${countdownLabel} ${countdown.main} and ${countdown.seconds} seconds` : "Today's meals are complete"}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="student-meal-ring-track" cx="50" cy="50" r="44" />
          <circle
            className="student-meal-ring-progress"
            cx="50"
            cy="50"
            r="44"
            strokeDasharray={ringLength}
            strokeDashoffset={ringLength * (1 - progress)}
          />
        </svg>
        <span className="student-meal-countdown-value">
          <strong>{countdown?.main || "—"}</strong>
          {countdown && <small>{countdown.seconds}s</small>}
        </span>
        <span className="student-meal-countdown-label">{countdown ? countdownLabel : "No more meals"}</span>
      </div>
    </section>
  );
}

function StudentPortal() {
  const { session } = useAuth();
  const fetcher = useCallback(
    () => loadStudentDashboard(session?.user.id),
    [session?.user.id],
  );
  const query = useQuery(fetcher);
  useEffect(() => subscribeLeaves(query.reload), [query.reload]);

  if (query.loading)
    return (
      <StudentWorkspace dashboard>
        <LoadingSkeleton />
      </StudentWorkspace>
    );
  if (query.error)
    return (
      <StudentWorkspace dashboard>
        <ErrorState message={query.error.message} onRetry={query.reload} />
      </StudentWorkspace>
    );

  const { student, leaves, counts, messRoutine } = query.data;
  if (!student)
    return (
      <StudentWorkspace dashboard>
        <EmptyState
          title="Student profile unavailable"
          description="Contact your hostel administrator to complete your registration."
        />
      </StudentWorkspace>
    );

  const allocation = activeAllocation(student);
  const bed = allocation?.beds;
  const room = bed?.rooms;
  const hostel = room?.hostels;
  const summaryCards = [
    { label: "Total leave requests", value: counts.data?.total, icon: CalendarDays },
    { label: "Pending", value: counts.data?.pending, icon: Clock3 },
    { label: "Approved", value: counts.data?.approved, icon: CircleCheck },
    { label: "Rejected", value: counts.data?.rejected, icon: CircleX },
  ];

  return (
    <StudentWorkspace dashboard>
      <div className="student-portal-content">
        <section className="student-identity-card panel" aria-label="Student information">
          <div className="student-identity-main">
            <StudentAvatar student={student} />
            <div>
              <h2>{student.full_name}</h2>
              <p>{student.student_id}</p>
            </div>
            <Button className="student-identity-refresh" variant="outline" onClick={query.reload}>
              <RefreshCw size={15} /> Refresh
            </Button>
          </div>
          <dl className="student-identity-details">
            <div>
              <dt>Email</dt>
              <dd>{student.email || "Not available"}</dd>
            </div>
            <div>
              <dt>Course / Program</dt>
              <dd>{student.course || "Not available"}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{student.branch || "Not available"}</dd>
            </div>
            <div>
              <dt>Current year / semester</dt>
              <dd>
                {(student.academic_year || "Year not available") +
                  (student.semester ? " · Semester " + student.semester : "")}
              </dd>
            </div>
            <div>
              <dt>Current allocation</dt>
              <dd>
                {(hostel?.name || "Hostel not assigned") +
                  (room?.room_number ? " · Room " + room.room_number : "") +
                  (bed?.bed_number ? " · Bed " + bed.bed_number : "")}
              </dd>
            </div>
          </dl>
        </section>

        <section className="student-leave-stats" aria-label="Leave request overview">
          {summaryCards.map(({ label, value, icon: Icon }) => (
            <article className="student-leave-stat panel" key={label}>
              <span><Icon size={18} /> {label}</span>
              <strong>{counts.available ? value : "—"}</strong>
            </article>
          ))}
        </section>
        {!counts.available && (
          <p className="module-unavailable" role="status">
            {counts.error}
          </p>
        )}

        <TodayMealCard messRoutine={messRoutine} />

        <div className="student-dashboard-grid">
          <section className="panel student-quick-actions">
            <div className="student-section-heading">
              <div>
                <div className="eyebrow">GET THINGS DONE</div>
                <h2>Quick actions</h2>
              </div>
            </div>
            <Link to="/student/leave?type=day_out">
              <span><CalendarDays size={17} /> Apply for Day-Out</span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/student/leave?type=night_out">
              <span><Clock3 size={17} /> Apply for Night-Out</span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/student/leave/history">
              <span><CalendarDays size={17} /> View leave history</span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/student/profile">
              <span><UserRound size={17} /> View full profile</span>
              <ArrowRight size={16} />
            </Link>
          </section>

          <section className="panel student-recent-requests">
            <div className="student-section-heading">
              <div>
                <div className="eyebrow">LEAVE ACTIVITY</div>
                <h2>Recent leave requests</h2>
              </div>
              <Link className="button button-outline" to="/student/leave/history">
                View history
              </Link>
            </div>
            {leaves.available ? (
              leaves.data.length ? (
                <div className="student-request-list">
                  {leaves.data.map((request) => (
                    <article key={request.id} className="student-request-row">
                      <div className="student-request-title">
                        <div>
                          <strong>{request.request_number}</strong>
                          <span className="student-request-type">
                            {request.leave_type === "day_out" ? "Day-Out" : "Night-Out"}
                          </span>
                        </div>
                        <span className={"status-pill " + request.status}>
                          {formatLeaveStatus(request.status)}
                        </span>
                      </div>
                      <p>
                        {new Date(request.departure_at).toLocaleString()} →{" "}
                        {new Date(request.expected_return_at).toLocaleString()}
                      </p>
                      <p><b>Destination:</b> {request.destination}</p>
                      <small>
                        Submitted {new Date(request.created_at).toLocaleString()}
                      </small>
                      {request.admin_remarks && (
                        <p className="leave-remarks">
                          <b>Administrator remarks:</b> {request.admin_remarks}
                        </p>
                      )}
                      <Link
                        className="student-request-details-link"
                        to={"/student/leave/history?request=" + encodeURIComponent(request.id)}
                      >
                        View details <ArrowRight size={14} />
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={CalendarDays}
                  title="No leave requests yet"
                  description="Day-Out and Night-Out applications will appear here after submission."
                />
              )
            ) : (
              <ErrorState message={leaves.error} onRetry={query.reload} />
            )}
          </section>

          <section className="panel student-hostel-info">
            <div className="student-section-heading">
              <div>
                <div className="eyebrow">YOUR RESIDENCE</div>
                <h2>Hostel information</h2>
              </div>
              <MapPinned size={19} />
            </div>
            <dl>
              <div><dt>Hostel</dt><dd>{hostel?.name || "Not assigned"}</dd></div>
              <div><dt>Block</dt><dd>{hostel?.block || "Not available"}</dd></div>
              <div><dt>Room</dt><dd>{room?.room_number || "Not assigned"}</dd></div>
              <div><dt>Bed</dt><dd>{bed?.bed_number || "Not assigned"}</dd></div>
              <div><dt>Hostel address</dt><dd>{hostel?.address || "Not available"}</dd></div>
            </dl>
          </section>

          <section className="panel student-profile-access">
            <div className="student-section-heading">
              <div>
                <div className="eyebrow">YOUR DETAILS</div>
                <h2>Student profile</h2>
              </div>
              <UserRound size={19} />
            </div>
            <p>Review your full personal, academic, and guardian information.</p>
            <Link className="button button-outline" to="/student/profile">
              Open full profile <ArrowRight size={15} />
            </Link>
          </section>
        </div>
      </div>
    </StudentWorkspace>
  );
}

export default function StudentDashboard({ profile = false }) {
  return profile ? (
    <StudentWorkspace>
      <StudentProfile self />
    </StudentWorkspace>
  ) : (
    <StudentPortal />
  );
}
