import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { DoorOpen } from "lucide-react";
import { EmptyState } from "../common/Feedback";
// Accept only real occupancy data once room and bed tables exist in Phase 2.
export function OccupancyChart({ data }) {
  if (!data?.length)
    return (
      <EmptyState
        icon={DoorOpen}
        title="A little room to grow"
        description="Your occupancy breakdown will appear once rooms and beds are set up."
      />
    );
  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={65}
            outerRadius={90}
          >
            {data.map((item, i) => (
              <Cell key={item.name} fill={["var(--accent-solid)", "#83B88B"][i % 2]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
