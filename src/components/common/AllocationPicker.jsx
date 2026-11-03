import { useState } from "react";
export function AllocationPicker({ inventory, value, onChange }) {
  const [hostel, setHostel] = useState("");
  const [floor, setFloor] = useState("");
  const [room, setRoom] = useState("");
  const { hostels, rooms, beds, allocations } = inventory;
  const availableRooms = rooms.filter(
    (r) => r.hostel_id === hostel && r.status === "available",
  );
  const occupied = new Set(allocations.map((a) => a.bed_id));
  const availableBeds = beds.filter(
    (b) =>
      b.room_id === room && b.status === "available" && !occupied.has(b.id),
  );
  const selectedRoom = rooms.find((r) => r.id === room);
  const occupiedInRoom = allocations.filter((a) =>
    beds.some((b) => b.id === a.bed_id && b.room_id === room),
  ).length;
  return (
    <div className="form-grid">
      <label>
        Hostel / block *
        <select
          value={hostel}
          onChange={(e) => {
            setHostel(e.target.value);
            setFloor("");
            setRoom("");
            onChange("");
          }}
        >
          <option value="">Choose hostel and block</option>
          {hostels
            .filter((h) => h.status === "active")
            .map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {h.block}
              </option>
            ))}
        </select>
      </label>
      <label>
        Floor *
        <select
          value={floor}
          disabled={!hostel}
          onChange={(e) => {
            setFloor(e.target.value);
            setRoom("");
            onChange("");
          }}
        >
          <option value="">Choose floor</option>
          {[...new Set(availableRooms.map((r) => r.floor_number))]
            .sort((a, b) => a - b)
            .map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
        </select>
      </label>
      <label>
        Room *
        <select
          value={room}
          disabled={floor === ""}
          onChange={(e) => {
            setRoom(e.target.value);
            onChange("");
          }}
        >
          <option value="">Choose room</option>
          {availableRooms
            .filter((r) => String(r.floor_number) === floor)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.room_number} · {r.room_type}
              </option>
            ))}
        </select>
      </label>
      <label>
        Available bed *
        <select
          value={value || ""}
          disabled={!room}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose bed</option>
          {availableBeds.map((b) => (
            <option key={b.id} value={b.id}>
              Bed {b.bed_number}
            </option>
          ))}
        </select>
      </label>
      {room && !availableBeds.length && (
        <p role="status">No available beds in this room.</p>
      )}
      {selectedRoom && (
        <p className="allocation-room-summary" role="status">
          {selectedRoom.room_type} · Capacity {selectedRoom.capacity} · Occupied{" "}
          {occupiedInRoom} · Available {availableBeds.length}
        </p>
      )}
    </div>
  );
}
