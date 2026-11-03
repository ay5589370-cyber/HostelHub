import { z } from "zod";

export const complaintCategories = [
  "plumbing",
  "electrical",
  "cleanliness",
  "furniture",
  "internet",
  "security",
  "other",
];

export const complaintStatuses = [
  "submitted",
  "acknowledged",
  "in_progress",
  "on_hold",
  "resolved",
  "closed",
];

export const staffComplaintCategories = [
  ...complaintCategories,
  "mess_food_quality",
  "mess_hygiene",
  "mess_menu_mismatch",
  "mess_meal_timing",
  "mess_service_issue",
  "mess_other",
];

export const complaintSchema = z.object({
  title: z
    .string()
    .trim()
    .min(4, "Enter a title of at least 4 characters.")
    .max(120),
  category: z.enum(complaintCategories),
  description: z
    .string()
    .trim()
    .min(10, "Describe the issue in at least 10 characters.")
    .max(3000),
  location_detail: z
    .string()
    .trim()
    .max(200, "Location details must be 200 characters or fewer.")
    .default(""),
});

export const complaintImageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validateComplaintFiles(files) {
  if (files.length > 3) throw new Error("Attach up to 3 images at a time.");
  for (const file of files) {
    if (!complaintImageTypes[file.type]) {
      throw new Error("Attachments must be JPEG, PNG, or WebP images.");
    }
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      throw new Error("Each image must be 5 MB or smaller.");
    }
  }
}

export const formatComplaintStatus = (status) =>
  status?.replaceAll("_", " ") || "—";
