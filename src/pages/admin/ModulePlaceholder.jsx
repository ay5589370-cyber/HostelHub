import { Link } from "react-router-dom";
import { ArrowLeft, Layers } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/common/Feedback";
export default function ModulePlaceholder({ module }) {
  return (
    <>
      <PageHeader
        eyebrow="BUILDING A BETTER CAMPUS"
        title={module.label}
        description={module.description}
      />
      <section className="panel module-placeholder">
        <span className="badge">ON THE ROADMAP · PHASE {module.phase}</span>
        <EmptyState
          icon={module.icon || Layers}
          title="Good things are on the way"
          description={`This module is planned for Phase ${module.phase}. Your workspace is ready for it; no records or workflows are available yet.`}
        >
          <Link className="button button-outline" to="/admin/dashboard">
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>
        </EmptyState>
        <div className="roadmap-line">
          <span className="complete">01 Foundation</span>
          <i />
          <span>
            0{module.phase} {module.label}
          </span>
        </div>
      </section>
    </>
  );
}
