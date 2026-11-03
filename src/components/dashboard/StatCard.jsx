import { Link } from "react-router-dom";
export function StatCard({
  label,
  value,
  icon: Icon,
  phase,
  color = "amber",
  to,
  caption,
}) {
  const content = (
    <>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={19} />
        </span>
      </div>
      <strong className="stat-value">{value ?? "—"}</strong>
      <div className="stat-caption">
        {caption ? (
          <>
            <span
              className={`tiny-dot ${phase || value === "Unavailable" ? "" : "live"}`}
            />
            {caption}
          </>
        ) : phase ? (
          <>
            <span className="tiny-dot" />
            Available in Phase {phase}
          </>
        ) : (
          <>
            <span className="tiny-dot live" />
            Registered student profiles
          </>
        )}
      </div>
    </>
  );
  return to ? (
    <Link className={`stat-card ${color}`} to={to}>
      {content}
    </Link>
  ) : (
    <article className={`stat-card ${color}`}>{content}</article>
  );
}
