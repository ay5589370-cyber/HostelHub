import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQuery } from "../../hooks/useQuery";
import { getInventory, manage, subscribePhase2 } from "../../services/students";
import {
  PageHeader,
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "../../components/common/Feedback";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { Button } from "../../components/ui/Button";
export default function Rooms() {
  const inventory = useQuery(getInventory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hostel, setHostel] = useState("");
  const [action, setAction] = useState(null);
  useEffect(() => subscribePhase2(inventory.reload), [inventory.reload]);
  const save = async (type, data, form) => {
    setBusy(true);
    setError("");
    try {
      await manage(type, data);
      form?.reset();
      setAction(null);
      await inventory.reload();
      toast.success("Room inventory updated");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="SPACE TO BELONG"
        title="Rooms & beds"
        description="Organize your campus and keep every assignment accounted for."
      />
      <div className="room-showcase-card">
        <img
          src="/images/hostel-room.jpg"
          alt="Modern hostel dorm room accommodation"
          className="room-showcase-img"
        />
        <div className="room-showcase-content">
          <h3>Residential Accommodation Standard</h3>
          <p>
            Standardized double-occupancy and single units equipped with study desks, ergonomic chairs, individual wardrobes, and high-speed Wi-Fi connectivity.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="room-setup">
        <form
          className="panel phase-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              "hostel",
              Object.fromEntries(new FormData(e.currentTarget)),
              e.currentTarget,
            );
          }}
        >
          <h2>Add hostel / block</h2>
          <p>To add another block, use the same hostel name.</p>
          <div className="form-grid">
            <label>
              Hostel name *<input name="name" required maxLength={100} />
            </label>
            <label>
              Block *<input name="block" required maxLength={100} />
            </label>
            <label>
              Address
              <input name="address" maxLength={300} />
            </label>
          </div>
          <Button disabled={busy}>Create hostel block</Button>
        </form>
        <form
          className="panel phase-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              "room",
              Object.fromEntries(new FormData(e.currentTarget)),
              e.currentTarget,
            );
          }}
        >
          <h2>Create room & beds</h2>
          <div className="form-grid">
            <label>
              Hostel / block *
              <select name="hostel_id" required>
                <option value="">Choose hostel</option>
                {inventory.data?.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} · {h.block}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Room number *<input name="room_number" required maxLength={30} />
            </label>
            <label>
              Floor *
              <input
                name="floor_number"
                type="number"
                defaultValue="0"
                required
                min="-5"
                max="100"
              />
            </label>
            <label>
              Capacity *
              <input
                name="capacity"
                type="number"
                min="1"
                max="20"
                defaultValue="2"
                required
              />
            </label>
            <label>
              Room type *
              <select name="room_type">
                <option>Standard</option>
                <option>AC</option>
                <option>Non-AC</option>
                <option>Accessible</option>
              </select>
            </label>
          </div>
          <Button disabled={busy || !inventory.data?.hostels.length}>
            Create & generate beds
          </Button>
        </form>
      </div>
      <div className="section-heading">
        <h2>Live occupancy</h2>
        <label>
          Hostel / block
          <select value={hostel} onChange={(e) => setHostel(e.target.value)}>
            <option value="">All hostels</option>
            {inventory.data?.hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {h.block}
              </option>
            ))}
          </select>
        </label>
      </div>
      {inventory.loading ? (
        <LoadingSkeleton />
      ) : inventory.error ? (
        <ErrorState
          message={inventory.error.message}
          onRetry={inventory.reload}
        />
      ) : !inventory.data.rooms.length ? (
        <EmptyState
          title="Make room for your community"
          description="Create a hostel block, then add your first room."
        />
      ) : (
        <div className="room-grid">
          {inventory.data.rooms
            .filter((r) => !hostel || r.hostel_id === hostel)
            .map((r) => {
              const h = inventory.data.hostels.find(
                (h) => h.id === r.hostel_id,
              );
              const beds = inventory.data.beds.filter(
                (b) => b.room_id === r.id,
              );
              const occupied = beds.filter((b) =>
                inventory.data.allocations.some((a) => a.bed_id === b.id),
              ).length;
              return (
                <section className="panel phase-panel room-card" key={r.id}>
                  <span className="badge">
                    {h?.name} · {h?.block}
                  </span>
                  <h2>
                    Room {r.room_number}
                    <small>Floor {r.floor_number}</small>
                  </h2>
                  <p>
                    {occupied} / {r.capacity} occupied · {r.room_type} ·{" "}
                    {r.status}
                  </p>
                  <progress
                    value={occupied}
                    max={r.capacity}
                    aria-label={`Room ${r.room_number} occupancy`}
                  />
                  <div className="bed-grid">
                    {beds.map((b) => {
                      const a = inventory.data.allocations.find(
                        (a) => a.bed_id === b.id,
                      );
                      return (
                        <div
                          className={`bed ${a ? "occupied" : ""}`}
                          key={b.id}
                        >
                          <strong>Bed {b.bed_number}</strong>
                          {a ? (
                            <Link to={`/admin/students/${a.student_id}`}>
                              {a.students?.full_name || "View resident"}
                            </Link>
                          ) : (
                            <small>
                              {r.status === "maintenance"
                                ? "Unavailable"
                                : b.status === "available"
                                  ? "Vacant"
                                  : b.status}
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setAction({
                        id: r.id,
                        ...Object.fromEntries(new FormData(e.currentTarget)),
                      });
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        Capacity
                        <input
                          name="capacity"
                          type="number"
                          defaultValue={r.capacity}
                          min={beds.length}
                          max="20"
                          required
                        />
                      </label>
                      <label>
                        Room status
                        <select name="status" defaultValue={r.status}>
                          <option value="available">Available</option>
                          <option value="maintenance">Maintenance</option>
                        </select>
                      </label>
                    </div>
                    <Button variant="outline" disabled={busy}>
                      Update room
                    </Button>
                  </form>
                </section>
              );
            })}
        </div>
      )}
      <ConfirmDialog
        open={!!action}
        onOpenChange={(v) => {
          if (!v) setAction(null);
        }}
        title="Update room configuration?"
        description="Increasing capacity generates new beds. Maintenance blocks new allocations; existing residents retain their assignment."
        confirmLabel="Update room"
        busy={busy}
        onConfirm={() => save("room_update", action)}
      />
    </>
  );
}
