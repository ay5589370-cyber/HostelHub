import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PageHeader,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
import { useQuery } from "../../hooks/useQuery";
import {
  loadAdminMess,
  saveMessMenu,
  setMessMenuStatus,
  setMessFeedbackPolicy,
  loadWeeklyMessRoutine,
  saveWeeklyMessRoutine,
} from "../../services/mess";
import {
  mealSlots,
  mealSlotLabels,
  localDate,
  shiftDate,
} from "../../lib/messValidation";

const date = localDate();
const emptyForm = (mealDate = date) => ({
  id: "",
  meal_date: mealDate,
  meal_slot: "breakfast",
  title: "",
  description: "",
  serving_start: "07:00",
  serving_end: "08:00",
  items: [{ name: "", description: "", allergens: "" }],
});
const human = (value) => value?.replaceAll("_", " ") || "—";
const routineDays = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const routineMeals = ["breakfast", "lunch", "dinner"];
const mealTimeDefaults = {
  breakfast: { serving_start: "07:00", serving_end: "08:00" },
  lunch: { serving_start: "12:30", serving_end: "14:00" },
  dinner: { serving_start: "19:30", serving_end: "21:00" },
};

export default function AdminMess() {
  const [range, setRange] = useState({
    from: shiftDate(date, -6),
    to: shiftDate(date, 6),
    mealSlot: "",
    search: "",
  });
  const [form, setForm] = useState(emptyForm());
  const [policy, setPolicy] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [routineDraft, setRoutineDraft] = useState(null);
  const [routineBusy, setRoutineBusy] = useState(false);
  const [routineNotice, setRoutineNotice] = useState("");
  const fetcher = useCallback(
    () =>
      loadAdminMess({
        from: range.from,
        to: range.to,
        menuFrom: range.from,
        menuTo: range.to,
        mealSlot: range.mealSlot,
        search: range.search,
      }),
    [range],
  );
  const query = useQuery(fetcher);
  const routineFetcher = useCallback(() => loadWeeklyMessRoutine(), []);
  const routineQuery = useQuery(routineFetcher);
  useEffect(() => {
    if (!routineQuery.data) return;
    const routine = Array.from({ length: 7 }, (_, weekday) =>
      routineMeals.map((meal_slot) => {
        const item = routineQuery.data.routine.find(
          (row) => row.weekday === weekday && row.meal_slot === meal_slot,
        );
        return { weekday, meal_slot, menu_text: item?.menu_text || "" };
      }),
    ).flat();
    const times = routineMeals.map((meal_slot) => {
      const item = routineQuery.data.times.find((row) => row.meal_slot === meal_slot);
      return {
        meal_slot,
        serving_start: item?.serving_start?.slice(0, 5) || mealTimeDefaults[meal_slot].serving_start,
        serving_end: item?.serving_end?.slice(0, 5) || mealTimeDefaults[meal_slot].serving_end,
      };
    });
    setRoutineDraft({ routine, times });
  }, [routineQuery.data]);
  const menus = query.data?.menus || [];
  const summary = query.data?.summary;
  const recent = summary?.feedback?.recent || [];
  const complaints = summary?.complaints?.recent || [];
  const feedbackBySlot = useMemo(
    () => summary?.feedback?.by_slot || [],
    [summary],
  );

  const run = async (operation, success) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
      setForm(emptyForm());
      setCancelTarget(null);
      setAnnouncement("");
      await query.reload();
    } catch (error) {
      setNotice(error.message || "Mess operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const edit = (menu) =>
    setForm({
      ...menu,
      id: menu.id,
      meal_date: menu.meal_date,
      serving_start: menu.serving_start.slice(0, 5),
      serving_end: menu.serving_end.slice(0, 5),
      items: menu.items.map((item) => ({
        ...item,
        allergens: (item.allergens || []).join(", "),
      })),
    });
  const save = (event) => {
    event.preventDefault();
    const data = {
      ...form,
      items: form.items.map((item) => ({
        name: item.name.trim(),
        description: item.description.trim(),
        allergens: item.allergens
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      })),
    };
    void run(
      () => saveMessMenu(data),
      "Menu saved as a draft. Publish it to make it visible to students.",
    );
  };
  const saveRoutine = async (event) => {
    event.preventDefault();
    if (!routineDraft) return;
    setRoutineBusy(true);
    setRoutineNotice("");
    try {
      await saveWeeklyMessRoutine(routineDraft);
      setRoutineNotice("Weekly routine and meal times saved.");
      await routineQuery.reload();
    } catch (error) {
      setRoutineNotice(error.message || "Could not save the weekly routine.");
    } finally {
      setRoutineBusy(false);
    }
  };
  const updateRoutineMeal = (weekday, meal_slot, menu_text) =>
    setRoutineDraft((current) => ({
      ...current,
      routine: current.routine.map((item) =>
        item.weekday === weekday && item.meal_slot === meal_slot
          ? { ...item, menu_text }
          : item,
      ),
    }));
  const updateRoutineTime = (meal_slot, key, value) =>
    setRoutineDraft((current) => ({
      ...current,
      times: current.times.map((item) =>
        item.meal_slot === meal_slot ? { ...item, [key]: value } : item,
      ),
    }));
  const updateItem = (index, key, value) =>
    setForm((current) => ({
      ...current,
      items: current.items.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      ),
    }));
  if (query.loading) return <LoadingSkeleton />;
  if (query.error)
    return <ErrorState message={query.error.message} onRetry={query.reload} />;
  return (
    <>
      <PageHeader
        eyebrow="HOSTEL OPERATIONS"
        title="Mess management"
        description="Publish meal menus, post service notices, and review resident feedback and mess reports."
      />
      <section className="panel mess-routine-panel">
        <div className="student-section-heading">
          <div>
            <div className="eyebrow">RECURRING WEEKLY PLAN</div>
            <h2>Default mess routine</h2>
            <p>Set the menu for each weekday. Students can view this plan from their dashboard.</p>
          </div>
        </div>
        {routineQuery.loading && !routineDraft ? (
          <LoadingSkeleton />
        ) : routineQuery.error ? (
          <ErrorState message={routineQuery.error.message} onRetry={routineQuery.reload} />
        ) : routineDraft && (
          <form onSubmit={saveRoutine}>
            <div className="mess-meal-times">
              {routineDraft.times.map((item) => (
                <fieldset key={item.meal_slot}>
                  <legend>{mealSlotLabels[item.meal_slot]} serving time</legend>
                  <label>From<input type="time" required value={item.serving_start} onChange={(e) => updateRoutineTime(item.meal_slot, "serving_start", e.target.value)} /></label>
                  <label>Until<input type="time" required value={item.serving_end} onChange={(e) => updateRoutineTime(item.meal_slot, "serving_end", e.target.value)} /></label>
                </fieldset>
              ))}
            </div>
            <div className="mess-routine-table-wrap">
              <table className="mess-routine-table">
                <thead><tr><th scope="col">Day</th>{routineMeals.map((slot) => <th scope="col" key={slot}>{mealSlotLabels[slot]}</th>)}</tr></thead>
                <tbody>{routineDays.map((day, weekday) => (
                  <tr key={day}>
                    <th scope="row">{day}</th>
                    {routineMeals.map((slot) => {
                      const item = routineDraft.routine.find((row) => row.weekday === weekday && row.meal_slot === slot);
                      return <td key={slot}><textarea aria-label={`${day} ${mealSlotLabels[slot]} menu`} maxLength={1000} rows={2} value={item?.menu_text || ""} placeholder="Enter menu (optional)" onChange={(e) => updateRoutineMeal(weekday, slot, e.target.value)} /></td>;
                    })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mess-routine-actions">
              {routineNotice && <p role="status">{routineNotice}</p>}
              <Button type="submit" disabled={routineBusy}>{routineBusy ? "Saving…" : "Save weekly routine"}</Button>
            </div>
          </form>
        )}
      </section>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="stats-grid">
        <article className="stat-card">
          <span className="stat-top">Published today</span>
          <strong className="stat-value">
            {summary?.menus?.published_today ?? 0}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-top">Menus this week</span>
          <strong className="stat-value">
            {summary?.menus?.upcoming_published ?? 0}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-top">Feedback · avg rating</span>
          <strong className="stat-value">
            {summary?.feedback?.count ?? 0} ·{" "}
            {summary?.feedback?.average_rating ?? "—"}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-top">Open mess complaints</span>
          <strong className="stat-value">
            {summary?.complaints?.open ?? 0}
          </strong>
        </article>
      </section>
      <div className="phase-grid">
        <section className="panel phase-panel">
          <h2>{form.id ? "Edit menu" : "Create a menu"}</h2>
          <form className="form-grid" onSubmit={save}>
            <label>
              Meal date *
              <input
                type="date"
                min={date}
                required
                value={form.meal_date}
                onChange={(e) =>
                  setForm({ ...form, meal_date: e.target.value })
                }
              />
            </label>
            <label>
              Meal *
              <select
                value={form.meal_slot}
                onChange={(e) =>
                  setForm({ ...form, meal_slot: e.target.value })
                }
              >
                {mealSlots.map((slot) => (
                  <option key={slot} value={slot}>
                    {mealSlotLabels[slot]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Menu title *
              <input
                required
                minLength={2}
                maxLength={120}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              Description
              <input
                maxLength={1000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <label>
              Serving starts *
              <input
                type="time"
                required
                value={form.serving_start}
                onChange={(e) =>
                  setForm({ ...form, serving_start: e.target.value })
                }
              />
            </label>
            <label>
              Serving ends *
              <input
                type="time"
                required
                value={form.serving_end}
                onChange={(e) =>
                  setForm({ ...form, serving_end: e.target.value })
                }
              />
            </label>
            <div className="complaint-full">
              <strong>Menu items</strong>
              {form.items.map((item, index) => (
                <div className="mess-item-editor" key={index}>
                  <label>
                    Item name *
                    <input
                      required
                      maxLength={100}
                      value={item.name}
                      onChange={(e) =>
                        updateItem(index, "name", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Description
                    <input
                      maxLength={300}
                      value={item.description}
                      onChange={(e) =>
                        updateItem(index, "description", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Allergens (comma separated)
                    <input
                      value={item.allergens}
                      onChange={(e) =>
                        updateItem(index, "allergens", e.target.value)
                      }
                      placeholder="Optional"
                    />
                  </label>
                  {form.items.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          items: f.items.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {form.items.length < 30 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      items: [
                        ...f.items,
                        { name: "", description: "", allergens: "" },
                      ],
                    }))
                  }
                >
                  Add item
                </Button>
              )}
            </div>
            <div className="form-actions complaint-full">
              <Button disabled={busy}>{busy ? "Saving…" : "Save draft"}</Button>
              {form.id && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setForm(emptyForm())}
                >
                  Clear form
                </Button>
              )}
            </div>
          </form>
          <div className="form-grid policy-row">
            <label>
              Feedback edit window (hours)
              <input
                type="number"
                min="0"
                max="168"
                value={policy ?? query.data.policy.edit_window_hours}
                onChange={(e) => setPolicy(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || policy === null}
              onClick={() =>
                void run(async () => {
                  await setMessFeedbackPolicy(policy);
                  setPolicy(null);
                }, "Feedback policy updated.")
              }
            >
              Save policy
            </Button>
            <small>
              0 means feedback cannot be edited after submission. Current:{" "}
              {query.data.policy.edit_window_hours} hours.
            </small>
          </div>
        </section>
        <section className="panel phase-panel">
          <div className="section-heading">
            <div>
              <h2>Menu schedule</h2>
              <p>Only published menus and notices appear in student portals.</p>
            </div>
          </div>
          <div className="complaint-filters">
            <input
              type="date"
              aria-label="From date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
            <input
              type="date"
              aria-label="To date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
            <select
              aria-label="Meal filter"
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
            <input
              placeholder="Search title"
              value={range.search}
              onChange={(e) => setRange({ ...range, search: e.target.value })}
            />
            <Button variant="outline" onClick={() => void query.reload()}>
              Refresh
            </Button>
          </div>
          {menus.length ? (
            <div className="mess-menu-list">
              {menus.map((menu) => (
                <article className="complaint-list-item" key={menu.id}>
                  <div className="complaint-list-top">
                    <strong>{menu.title}</strong>
                    <span className={`complaint-status status-${menu.status}`}>
                      {human(menu.status)}
                    </span>
                  </div>
                  <p>
                    {menu.meal_date} · {mealSlotLabels[menu.meal_slot]} ·{" "}
                    {menu.serving_start.slice(0, 5)}–
                    {menu.serving_end.slice(0, 5)}
                  </p>
                  <p>{menu.items.map((item) => item.name).join(", ")}</p>
                  {menu.announcement && <p>{menu.announcement}</p>}
                  <div className="form-actions">
                    {menu.status !== "archived" && (
                      <Button variant="outline" onClick={() => edit(menu)}>
                        Edit
                      </Button>
                    )}
                    {menu.status === "draft" || menu.status === "cancelled" ? (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => setMessMenuStatus(menu.id, "published"),
                            "Menu published; students have been notified.",
                          )
                        }
                      >
                        Publish
                      </Button>
                    ) : null}
                    {menu.status !== "archived" && (
                      <Button
                        variant="outline"
                        onClick={() => setCancelTarget(menu)}
                      >
                        Cancel meal
                      </Button>
                    )}
                    {menu.status !== "archived" && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void run(
                            () => setMessMenuStatus(menu.id, "archived"),
                            "Menu archived.",
                          )
                        }
                      >
                        Archive
                      </Button>
                    )}
                  </div>
                  {cancelTarget?.id === menu.id && (
                    <div className="form-grid">
                      <label>
                        Student notice *
                        <textarea
                          minLength={5}
                          maxLength={500}
                          value={announcement}
                          onChange={(e) => setAnnouncement(e.target.value)}
                        />
                      </label>
                      <Button
                        disabled={busy || announcement.trim().length < 5}
                        onClick={() =>
                          void run(
                            () =>
                              setMessMenuStatus(
                                menu.id,
                                "cancelled",
                                announcement,
                              ),
                            "Meal cancelled and students notified.",
                          )
                        }
                      >
                        Confirm cancellation
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setCancelTarget(null)}
                      >
                        Keep menu
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No menus in this date range"
              description="Create a draft menu, then publish it when ready."
            />
          )}
        </section>
      </div>
      <div className="phase-grid">
        <section className="panel phase-panel">
          <h2>Student feedback</h2>
          <p>
            Feedback by meal:{" "}
            {feedbackBySlot
              .map(
                (row) =>
                  `${mealSlotLabels[row.meal_slot]} ${row.count} (${row.average_rating ?? "—"}/5)`,
              )
              .join(" · ") || "No feedback in range."}
          </p>
          {recent.map((row, i) => (
            <p className="mess-feed-row" key={`${row.meal_date}-${i}`}>
              <strong>
                {row.meal_date} · {mealSlotLabels[row.meal_slot]} · {row.rating}
                /5
              </strong>
              {row.category && ` · ${human(row.category)}`}
              <br />
              {row.comments || "No comment"}
            </p>
          ))}
        </section>
        <section className="panel phase-panel">
          <h2>Mess complaints</h2>
          {complaints.length ? (
            complaints.map((row) => (
              <a
                className="complaint-list-item"
                href={`/admin/complaints/${row.id}`}
                key={row.id}
              >
                <strong>
                  {row.complaint_number} · {row.title}
                </strong>
                <p>
                  {human(row.category)} · {human(row.status)} · {row.room_label}
                </p>
              </a>
            ))
          ) : (
            <EmptyState
              title="No mess complaints"
              description="Mess-related complaints submitted by students will appear here."
            />
          )}
        </section>
      </div>
    </>
  );
}
