import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  X,
  Printer,
  Download,
  AlertTriangle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  MapPin,
  Calendar,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { getOrCreateGatePass } from "../../services/gate";
import { formatGateStatus } from "../../lib/gateValidation";
import { Button } from "../ui/Button";

export function QrPassModal({ leaveRequestId, open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [passData, setPassData] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!open || !leaveRequestId) {
      setPassData(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    getOrCreateGatePass(leaveRequestId)
      .then((data) => {
        if (!isMounted) return;
        setPassData(data);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || "Failed to load gate pass.");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, leaveRequestId]);

  // Render QR code to canvas whenever passData is loaded
  useEffect(() => {
    if (!passData || !canvasRef.current) return;

    // Cryptographic payload contains only token and identifiers, no sensitive personal data
    const payload = JSON.stringify({
      v: 1,
      pass_id: passData.pass_id,
      token: passData.token,
    });

    QRCode.toCanvas(
      canvasRef.current,
      payload,
      {
        width: 220,
        margin: 2,
        color: {
          dark: "#18181b",
          light: "#ffffff",
        },
        errorCorrectionLevel: "M",
      },
      (err) => {
        if (err) {
          console.error("QR render error:", err);
          toast.error("Failed to render QR code");
        }
      },
    );
  }, [passData]);

  if (!open) return null;

  const handleDownload = () => {
    if (!canvasRef.current || !passData) return;
    const link = document.createElement("a");
    link.download = `GatePass-${passData.pass_code}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="gate-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-pass-title"
      onClick={onClose}
    >
      <div
        className="gate-pass-card panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gate-pass-header">
          <div className="gate-pass-brand">
            <ShieldCheck size={22} className="accent-text" />
            <div>
              <h2 id="gate-pass-title">Smart Gate Pass</h2>
              <small>HostelHub Verified Digital Authorization</small>
            </div>
          </div>
          <Button
            variant="ghost"
            className="icon-button"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={20} />
          </Button>
        </div>

        {loading && (
          <div className="gate-modal-loading">
            <Loader2 size={32} className="spin" />
            <p>Generating secure gate authorization…</p>
          </div>
        )}

        {error && (
          <div className="gate-modal-error">
            <ShieldAlert size={36} color="var(--danger, #e11d48)" />
            <h3>Unable to Issue Gate Pass</h3>
            <p>{error}</p>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )}

        {passData && !loading && !error && (
          <div className="gate-pass-body">
            {/* Top Pass Code Bar */}
            <div className="gate-code-banner">
              <span className="gate-code-label">GATE PASS CODE</span>
              <strong className="gate-code-value">{passData.pass_code}</strong>
              <span className={`status-pill status-${passData.status}`}>
                {formatGateStatus(passData.status)}
              </span>
            </div>

            {/* QR Code Canvas */}
            <div className="gate-qr-container">
              <div className="gate-qr-frame">
                <canvas ref={canvasRef} aria-label={`QR Code for pass ${passData.pass_code}`} />
              </div>
              <p className="gate-qr-instruction">
                Scan this QR code at the campus gate checkpoint.
              </p>
            </div>

            {/* Resident & Travel Information */}
            <div className="gate-details-grid">
              <div className="gate-detail-item">
                <small>RESIDENT</small>
                <strong>{passData.student_name}</strong>
                <span>ID: {passData.student_id}</span>
              <span>Room: {passData.room_number || "Unassigned"}</span>
              </div>
            <div className="gate-detail-item">
              <small>PASS TYPE</small>
              <strong>{passData.leave_type === "day_out" ? "Day-Out" : "Night-Out"}</strong>
            </div>
              <div className="gate-detail-item">
                <small>DESTINATION</small>
                <strong className="flex-row items-center gap-1">
                  <MapPin size={14} /> {passData.destination}
                </strong>
              </div>
              <div className="gate-detail-item">
                <small>DEPARTURE WINDOW</small>
                <span>
                  <Calendar size={13} /> {new Date(passData.departure_at).toLocaleString()}
                </span>
              </div>
              <div className="gate-detail-item">
                <small>EXPECTED RETURN</small>
                <span>
                  <Clock size={13} /> {new Date(passData.expected_return_at).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Timestamps if used */}
            {(passData.exit_used_at || passData.entry_used_at) && (
              <div className="gate-usage-info">
                {passData.exit_used_at && (
                  <div>
                    <b>Exit Verified:</b>{" "}
                    {new Date(passData.exit_used_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
                {passData.entry_used_at && (
                  <div>
                    <b>Entry Recorded:</b>{" "}
                    {new Date(passData.entry_used_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Validity Notice */}
            <div className="gate-pass-footer-note">
              <AlertTriangle size={15} />
              <span>
                Valid until {new Date(passData.expires_at).toLocaleString()}. Single-use exit & return. Non-transferable.
              </span>
            </div>

            {/* Actions */}
            <div className="gate-actions-row">
              <Button variant="outline" onClick={handleDownload} title="Save QR as PNG image">
                <Download size={16} /> Save Image
              </Button>
              <Button variant="outline" onClick={handlePrint} title="Print paper pass">
                <Printer size={16} /> Print
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
