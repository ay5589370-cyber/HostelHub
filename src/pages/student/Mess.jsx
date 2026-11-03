import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Logo,
  PageHeader,
  ThemeToggle,
} from "../../components/common/Feedback";
import { useAuth } from "../../contexts/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import {
  listStudentMessComplaints,
  loadStudentMess,
  submitMealFeedback,
  submitMessComplaint,
} from "../../services/mess";
import {
  feedbackCategories,
  mealFeedbackSchema,
  mealSlotLabels,
  mealSlots,
  localDate,
  messComplaintLabels,
  messComplaintSchema,
  messComplaintCategories,
  shiftDate,
} from "../../lib/messValidation";

export default function StudentMess() {
  const { logout } = useAuth();
  const today = localDate();
  const [range, setRange] = useState({
    from: shiftDate(today, -todayDay()),
    to: shiftDate(today, 6 - todayDay()),
    mealSlot: "",
  });
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const fetcher = useCallback(async () => {
    const [mess, complaints] = await Promise.all([
      loadStudentMess(range),
      listStudentMessComplaints(),
    ]);
    return { ...mess, complaints };
  }, [range]);
  const query = useQuery(fetcher);
  const feedbackForm = useForm({
    resolver: zodResolver(mealFeedbackSchema),
    defaultValues: {
      meal_date: today,
      meal_slot: "breakfast",
      rating: 5,
      category: "",
      comments: "",
    },
  });
  const complaintForm = useForm({
    resolver: zodResolver(messComplaintSchema),
    defaultValues: {
      title: "",
      category: "mess_food_quality",
      description: "",
      location_detail: "Mess / dining area",
    },
  });
  const reload = async () => {
    await query.reload();
  };
  const feedback = async (values) => {
    setBusy(true);
    try {
      await submitMealFeedback(values);
      toast.success("Meal feedback submitted.");
      feedbackForm.reset({ ...values, comments: "" });
      await reload();
    } catch (error) {
      toast.error(error.message || "Feedback could not be submitted.");
    } finally {
      setBusy(false);
    }
  };
  const complaint = async (values) => {
    setBusy(true);
    try {
      const result = await submitMessComplaint(values, nonce);
      toast.success(`Mess complaint ${result.complaint_number} submitted.`);
      complaintForm.reset({
        title: "",
        category: "mess_food_quality",
        description: "",
        location_detail: "Mess / dining area",
      });
      setNonce(crypto.randomUUID());
      await reload();
    } catch (error) {
      toast.error(error.message || "Complaint could not be submitted.");
      await reload();
    } finally {
      setBusy(false);
    }
  };
  if (query.loading) return <LoadingSkeleton />;
  if (query.error)
    return <ErrorState message={query.error.message} onRetry={query.reload} />;
  const feedbackByMeal = new Map(
    query.data.feedback.map((entry) => [
      `${entry.meal_date}/${entry.meal_slot}`,
      entry,
    ]),
  );
  return (
    <main className="student-workspace">
      <header>
        <Logo />
        <nav>
          <Link to="/student/dashboard">Dashboard</Link>
          <Link to="/student/profile">My profile</Link>
          <Link to="/student/leave">Leave</Link>
          <Link to="/student/fees">Fees</Link>
          <Link to="/student/mess">Mess</Link>
          <Link to="/student/complaints">Complaints</Link>
          <ThemeToggle />
          <Button
            variant="outline"
            onClick={() => logout().catch((e) => toast.error(e.message))}
          >
            Sign out
          </Button>
        </nav>
      </header>
      <div className="student-profile complaint-page">
        <PageHeader
          eyebrow="MEALS & RESIDENT SERVICES"
          title="Mess and food"
          description="View the published menu, send meal feedback, and report a mess issue."
        />
        {query.data.notifications.length > 0 && (
          <section className="panel phase-panel">
            <h2>Mess notices</h2>
            {query.data.notifications.map((notice) => (
              <article className="mess-notice" key={notice.id}>
                <strong>{notice.title}</strong>
                <p>{notice.message}</p>
                <small>{new Date(notice.created_at).toLocaleString()}</small>
              </article>
            ))}
          </section>
        )}
        <section className="panel phase-panel">
          <div className="section-heading">
            <div>
              <h2>Weekly menu</h2>
              <p>
                Only menus published by the hostel administration are shown.
              </p>
            </div>
          </div>
          <div className="complaint-filters">
            <label>
              Week starting
              <input
                type="date"
                value={range.from}
                onChange={(e) =>
                  setRange({
                    ...range,
                    from: e.target.value,
                    to: shiftDate(e.target.value, 6),
                  })
                }
              />
            </label>
            <select
              aria-label="Filter menu by meal"
              value={range.mealSlot}
              onChange={(e) => setRange({ ...range, mealSlot: e.target.value })}
            >
              <option value="">All meals</option>
              {mealSlots.map((slot) => (
                <option key={slot} value={slot}>
                  {mealSlotLabels[slot]}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={reload}>
              Refresh
            </Button>
          </div>
          {query.data.menus.length ? (
            <div className="mess-menu-list">
              {query.data.menus.map((menu) => {
                const existing = feedbackByMeal.get(
                  `${menu.meal_date}/${menu.meal_slot}`,
                );
                const canEdit =
                  existing &&
                  query.data.editWindowHours > 0 &&
                  Date.now() <=
                    new Date(existing.submitted_at).getTime() +
                      query.data.editWindowHours * 3600000;
                return (
                  <article
                    className={`complaint-list-item mess-menu-card ${menu.status === "cancelled" ? "mess-cancelled" : ""}`}
                    key={menu.id}
                  >
                    <div className="complaint-list-top">
                      <strong>
                        {menu.meal_date} · {mealSlotLabels[menu.meal_slot]}
                      </strong>
                      <span
                        className={`complaint-status status-${menu.status}`}
                      >
                        {menu.status === "cancelled"
                          ? "Cancelled"
                          : "Published"}
                      </span>
                    </div>
                    <p>
                      {menu.title} · {menu.serving_start.slice(0, 5)}–
                      {menu.serving_end.slice(0, 5)}
                    </p>
                    {menu.description && <p>{menu.description}</p>}
                    {menu.status === "cancelled" ? (
                      <p className="form-error">{menu.announcement}</p>
                    ) : (
                      <>
                        <ul>
                          {menu.items.map((item, i) => (
                            <li key={`${item.name}-${i}`}>
                              <strong>{item.name}</strong>
                              {item.description && ` — ${item.description}`}
                              {item.allergens?.length > 0 && (
                                <small className="mess-allergens">
                                  {" "}
                                  · Allergens: {item.allergens.join(", ")}
                                </small>
                              )}
                            </li>
                          ))}
                        </ul>
                        {existing ? (
                          <div className="notice">
                            Your rating: {existing.rating}/5
                            {existing.category ? ` · ${existing.category}` : ""}
                            {existing.comments ? ` · ${existing.comments}` : ""}
                            {canEdit && (
                              <>
                                <small>
                                  {" "}
                                  · Editable for {
                                    query.data.editWindowHours
                                  }{" "}
                                  hours after first submission.
                                </small>
                                <div>
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      feedbackForm.reset({
                                        meal_date: existing.meal_date,
                                        meal_slot: existing.meal_slot,
                                        rating: existing.rating,
                                        category: existing.category || "",
                                        comments: existing.comments || "",
                                      })
                                    }
                                  >
                                    Edit feedback
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No published menus for these dates"
              description="The administration has not published a menu in this range yet."
            />
          )}
        </section>
        <div className="phase-grid">
          <section className="panel phase-panel">
            <h2>Meal feedback</h2>
            <p>
              Submit one rating per meal date and slot. The database enforces
              the feedback policy.
            </p>
            <form
              className="form-grid"
              onSubmit={feedbackForm.handleSubmit(feedback)}
            >
              <label>
                Meal date *
                <input
                  type="date"
                  max={today}
                  required
                  {...feedbackForm.register("meal_date")}
                />
              </label>
              <label>
                Meal *
                <select {...feedbackForm.register("meal_slot")}>
                  {mealSlots.map((slot) => (
                    <option key={slot} value={slot}>
                      {mealSlotLabels[slot]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rating *
                <select
                  {...feedbackForm.register("rating", { valueAsNumber: true })}
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} / 5
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select {...feedbackForm.register("category")}>
                  <option value="">Choose (optional)</option>
                  {feedbackCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat[0].toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="complaint-full">
                Comments
                <textarea
                  rows={3}
                  maxLength={1000}
                  {...feedbackForm.register("comments")}
                />
              </label>
              <Button disabled={busy}>
                {busy ? "Sending…" : "Submit feedback"}
              </Button>
            </form>
          </section>
          <section className="panel phase-panel">
            <h2>Report a mess issue</h2>
            <form
              className="form-grid"
              onSubmit={complaintForm.handleSubmit(complaint)}
            >
              <label>
                Title *
                <input maxLength={120} {...complaintForm.register("title")} />
              </label>
              <label>
                Category *
                <select {...complaintForm.register("category")}>
                  {messComplaintCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {messComplaintLabels[cat]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Location
                <input
                  maxLength={200}
                  {...complaintForm.register("location_detail")}
                />
              </label>
              <label className="complaint-full">
                Details *
                <textarea
                  rows={4}
                  maxLength={3000}
                  {...complaintForm.register("description")}
                />
              </label>
              <Button disabled={busy}>
                {busy ? "Submitting…" : "Submit mess complaint"}
              </Button>
            </form>
          </section>
        </div>
        <section className="panel phase-panel">
          <h2>Your mess complaints</h2>
          {query.data.complaints.length ? (
            <div className="complaint-list">
              {query.data.complaints.map((item) => (
                <Link
                  className="complaint-list-item"
                  to={`/student/complaints/${item.id}`}
                  key={item.id}
                >
                  <div className="complaint-list-top">
                    <strong>
                      {item.complaint_number} · {item.title}
                    </strong>
                    <span className={`complaint-status status-${item.status}`}>
                      {item.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p>
                    {messComplaintLabels[item.category]} ·{" "}
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No mess complaints"
              description="Your submitted mess reports will appear here."
            />
          )}
        </section>
      </div>
    </main>
  );
}

function todayDay() {
  return (new Date().getDay() + 6) % 7;
}
