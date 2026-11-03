import { z } from "zod";

export const gatePassStatuses = ["active", "used", "expired", "revoked", "completed"];
export const gateEventTypes = ["exit", "entry"];
export const studentPresenceStatuses = ["inside", "outside"];

export const passCodeRegex = /^GP-[A-Za-z0-9_-]{4,16}$/i;

export const passCodeSchema = z
  .string()
  .trim()
  .regex(passCodeRegex, "Gate pass code must match format GP-XXXXXX (e.g. GP-26001000)");

export const manualScanSchema = z.object({
  pass_code: passCodeSchema,
  event_type: z.enum(["exit", "entry"]),
});

export const manualOverrideSchema = z.object({
  student_id: z.string().uuid("Invalid student ID"),
  event_type: z.enum(["exit", "entry"]),
  override_reason: z
    .string()
    .trim()
    .min(5, "Reason must be at least 5 characters.")
    .max(500, "Reason must be 500 characters or less."),
  leave_request_id: z.string().uuid().optional().nullable(),
});

export const revocationSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Reason must be at least 3 characters.")
    .max(500, "Reason must be 500 characters or less."),
});

/**
 * Safely parse QR scan result which could be:
 * 1. JSON payload: { v: 1, pass_id: "...", token: "...", pass_code: "..." }
 * 2. Raw pass code string (e.g. "GP-26001000")
 * 3. Raw URL ending with code or pass ID
 */
export function parseQrScanPayload(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Invalid or empty scan data.");
  }
  const trimmed = rawText.trim();

  // Try JSON first
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.pass_id && parsed.token) {
        return {
          pass_id: parsed.pass_id,
          token: parsed.token,
          pass_code: parsed.pass_code || null,
        };
      }
    } catch {
      // Fall through if not valid JSON
    }
  }

  // Check if it's a pass code
  if (passCodeRegex.test(trimmed.toUpperCase())) {
    return {
      pass_code: trimmed.toUpperCase(),
      pass_id: null,
      token: null,
    };
  }

  // Check URL query parameters (e.g. ?pass=GP-... or ?token=...)
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code") || url.searchParams.get("pass");
    const token = url.searchParams.get("token");
    const passId = url.searchParams.get("id");
    if (code || token || passId) {
      return {
        pass_code: code ? code.toUpperCase() : null,
        token: token || null,
        pass_id: passId || null,
      };
    }
  } catch {
    // Not a URL
  }

  throw new Error("Unrecognized QR code format. Expected a HostelHub Gate Pass QR code.");
}

export function formatGateStatus(status) {
  switch (status) {
    case "active":
      return "Active";
    case "used":
      return "Exit Recorded";
    case "completed":
      return "Completed";
    case "expired":
      return "Expired";
    case "revoked":
      return "Revoked";
    default:
      return status || "—";
  }
}
