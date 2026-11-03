import { z } from "zod";

export const leaveTypes = ["day_out", "night_out"];
export const leaveStatuses = ["pending", "approved", "rejected", "cancelled", "completed", "overdue"];
export const leaveDocumentTypes = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function parseLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    return null;
  return date;
}

export const leaveFormSchema = z.object({
  leave_type: z.enum(leaveTypes),
  departure_local: z
    .string()
    .min(1, "Choose a departure date and time.")
    .refine((value) => !value || parseLocalDateTime(value), "Choose a valid departure date and time."),
  expected_return_local: z
    .string()
    .min(1, "Choose an expected return date and time.")
    .refine((value) => !value || parseLocalDateTime(value), "Choose a valid return date and time."),
  destination: z.string().trim().min(2, "Enter the destination.").max(250),
  reason: z.string().trim().min(5, "Give a little more detail.").max(2000),
  emergency_contact: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid emergency contact."),
  rules_confirmed: z.literal(true, { errorMap: () => ({ message: "You must confirm the hostel rules." }) }),
}).superRefine((value, ctx) => {
  const departure = parseLocalDateTime(value.departure_local);
  const expectedReturn = parseLocalDateTime(value.expected_return_local);
  if (departure && departure <= new Date()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["departure_local"], message: "Departure must be in the future." });
  if (departure && expectedReturn && expectedReturn <= departure) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expected_return_local"], message: "Return time must be after departure." });
});

export function validateLeaveFiles(files) {
  if (files.length > 3) throw new Error("You can attach up to 3 documents.");
  for (const file of files) {
    if (!leaveDocumentTypes[file.type]) throw new Error("Documents must be PDF, JPEG, PNG, or WebP files.");
    if (file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error("Each document must be 5 MB or smaller.");
  }
}
export function formatLeaveStatus(status) { return status?.replaceAll("_", " ") || "—"; }
