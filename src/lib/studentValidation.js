import { z } from "zod";
const required = z.string().trim().min(1, "This field is required.").max(200);
const calendarDate = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^\+?[0-9 ()-]{7,20}$/,
    "Enter a valid phone number (7–20 characters).",
  );
export const studentSchema = z.object({
  full_name: required.min(2).max(100),
  date_of_birth: required.refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v &&
      v < new Date().toISOString().slice(0, 10),
    "Enter a valid birth date in the past.",
  ),
  gender: z
    .union([
      z.enum(["female", "male", "other", "prefer_not_to_say"]),
      z.literal(""),
    ])
    .default(""),
  course: required,
  branch: required,
  academic_year: required,
  semester: z.coerce.number().int().min(1).max(20),
  email: z
    .email("Enter a valid email.")
    .max(320)
    .transform((v) => v.toLowerCase()),
  phone: phoneSchema,
  permanent_address: required.max(500),
  city: required,
  state: required,
  pincode: z.string().regex(/^\d{6}$/, "Enter a six-digit PIN code."),
  current_address: z.string().trim().max(500).default(""),
  admission_date: required.refine(calendarDate, "Enter a valid date."),
  allocation_start_date: required.refine(calendarDate, "Enter a valid date."),
  admission_note: z.string().trim().max(1000).default(""),
  guardian_name: required.max(100),
  relationship: required,
  guardian_phone: phoneSchema,
  guardian_email: z.union([z.email().max(320), z.literal("")]),
  emergency_contact: phoneSchema,
  emergency_contact_name: required.max(100),
  guardian_address: z.string().trim().max(500).default(""),
  bed_id: z.uuid("Choose an available bed."),
});
export const registrationSteps = [
  {
    title: "Personal information",
    fields: ["full_name", "date_of_birth", "gender"],
  },
  {
    title: "Academic information",
    fields: ["course", "branch", "academic_year", "semester"],
  },
  {
    title: "Contact information",
    fields: [
      "email",
      "phone",
      "permanent_address",
      "current_address",
      "city",
      "state",
      "pincode",
    ],
  },
  {
    title: "Guardian information",
    fields: [
      "guardian_name",
      "relationship",
      "guardian_phone",
      "guardian_email",
      "emergency_contact_name",
      "emergency_contact",
      "guardian_address",
    ],
  },
  {
    title: "Hostel allocation",
    fields: [
      "bed_id",
      "admission_date",
      "allocation_start_date",
      "admission_note",
    ],
  },
  { title: "Review & submit", fields: [] },
];
export function validatePhoto(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG or WebP image.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("The image must be 5 MB or smaller.");
}
