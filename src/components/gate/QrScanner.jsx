import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Keyboard, AlertCircle, ScanLine, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { parseQrScanPayload, passCodeRegex } from "../../lib/gateValidation";

export function QrScanner({ onScan, disabled = false }) {
  const [mode, setMode] = useState("camera"); // "camera" | "manual"
  const [manualCode, setManualCode] = useState("");
  const [cameraError, setCameraError] = useState(null);
  const [manualError, setManualError] = useState(null);
  const [scanning, setScanning] = useState(false);

  const scannerRef = useRef(null);
  const readerId = "gate-qr-reader";

  // Start / stop Html5Qrcode based on mode
  useEffect(() => {
    if (mode !== "camera" || disabled) {
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(() => {});
        }
        setScanning(false);
      }
      return;
    }

    let isMounted = true;
    setCameraError(null);

    const startScanner = async () => {
      try {
        if (!scannerRef.current) {
          scannerRef.current = new Html5Qrcode(readerId);
        }

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        };

        await scannerRef.current.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            if (!isMounted) return;
            try {
              const payload = parseQrScanPayload(decodedText);
              // Pause scanner while parent handles verification
              if (scannerRef.current?.isScanning) {
                scannerRef.current.pause(true);
              }
              onScan(payload);
            } catch (err) {
              setCameraError(err.message || "Invalid QR code scanned.");
            }
          },
          () => {
            // Frame error - can be ignored during active scan
          },
        );

        if (isMounted) setScanning(true);
      } catch (err) {
        if (!isMounted) return;
        console.warn("Camera init error:", err);
        setCameraError(
          err.name === "NotAllowedError"
            ? "Camera permission denied. Please grant permission or use manual code entry."
            : "Camera unavailable or unsupported in this browser environment. Switch to manual entry.",
        );
        setScanning(false);
      }
    };

    // Small delay to ensure reader container is in DOM
    const timer = setTimeout(startScanner, 100);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(() => {});
        }
      }
    };
  }, [mode, disabled, onScan]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    setManualError(null);
    const code = manualCode.trim().toUpperCase();

    if (!code) {
      setManualError("Enter a gate pass code.");
      return;
    }
    if (!passCodeRegex.test(code)) {
      setManualError("Format should be GP-XXXXXX (e.g. GP-26001000).");
      return;
    }

    onScan({ pass_code: code });
    setManualCode("");
  };


  return (
    <div className="gate-scanner-box">
      {/* Mode Switcher Tabs */}
      <div className="gate-scanner-tabs">
        <button
          type="button"
          className={`gate-tab-btn ${mode === "camera" ? "active" : ""}`}
          onClick={() => {
            setMode("camera");
            setCameraError(null);
          }}
        >
          <Camera size={16} /> Live Camera Scan
        </button>
        <button
          type="button"
          className={`gate-tab-btn ${mode === "manual" ? "active" : ""}`}
          onClick={() => {
            setMode("manual");
            setManualError(null);
          }}
        >
          <Keyboard size={16} /> Manual Pass Code
        </button>
      </div>

      {mode === "camera" && (
        <div className="gate-camera-pane">
          <div id={readerId} className="gate-qr-reader-window" />

          {cameraError && (
            <div className="gate-scanner-warning">
              <AlertCircle size={18} color="var(--danger, #e11d48)" />
              <div>
                <strong>Scanner Notice</strong>
                <p>{cameraError}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode("manual")}
                style={{ marginTop: "6px" }}
              >
                Use Manual Entry Instead
              </Button>
            </div>
          )}

          {scanning && !cameraError && (
            <div className="gate-scanning-indicator">
              <ScanLine size={16} className="pulse" />
              <span>Camera active. Align resident QR code within frame.</span>
            </div>
          )}
        </div>
      )}

      {mode === "manual" && (
        <form onSubmit={handleManualSubmit} className="gate-manual-pane">
          <label htmlFor="gate-pass-input">
            <strong>Enter Resident Gate Pass Code</strong>
            <small>Found at the top of the resident's digital pass</small>
          </label>
          <div className="gate-input-row">
            <input
              id="gate-pass-input"
              type="text"
              placeholder="e.g. GP-26001000"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              disabled={disabled}
              autoFocus
              className="gate-code-input"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={disabled || !manualCode.trim()}
            >
              Verify Pass
            </Button>
          </div>

          {manualError && (
            <span className="gate-field-error">
              <AlertCircle size={14} /> {manualError}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
