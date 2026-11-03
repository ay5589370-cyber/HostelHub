import { z } from "zod";

export const mealSlots = ["breakfast", "lunch", "evening_snacks", "dinner"];
export const mealSlotLabels = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  evening_snacks: "Evening snacks",
  dinner: "Dinner",
};
export const feedbackCategories = [
  "taste",
  "quality",
  "hygiene",
  "variety",
  "serving",
];
export const messComplaintCategories = [
  "mess_food_quality",
  "mess_hygiene",
  "mess_menu_mismatch",
  "mess_meal_timing",
  "mess_service_issue",
  "mess_other",
];
export const messComplaintLabels = {
  mess_food_quality: "Food quality",
  mess_hygiene: "Hygiene",
  mess_menu_mismatch: "Menu mismatch",
  mess_meal_timing: "Meal timing",
  mess_service_issue: "Service issue",
  mess_other: "Other",
};

const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).default(""),
  allergens: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});

export const messMenuSchema = z
  .object({
    meal_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid meal date."),
    meal_slot: z.enum(mealSlots),
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).default(""),
    serving_start: z.string().min(1),
    serving_end: z.string().min(1),
    items: z.array(menuItemSchema).min(1).max(30),
  })
  .superRefine((menu, context) => {
    if (menu.serving_end <= menu.serving_start) {
      context.addIssue({
        code: "custom",
        path: ["serving_end"],
        message: "Serving end must be after serving start.",
      });
    }
  });

export const mealFeedbackSchema = z.object({
  meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_slot: z.enum(mealSlots),
  rating: z.coerce.number().int().min(1).max(5),
  category: z.union([z.enum(feedbackCategories), z.literal("")]).default(""),
  comments: z.string().trim().max(1000).default(""),
});

export const messComplaintSchema = z.object({
  title: z.string().trim().min(4).max(120),
  category: z.enum(messComplaintCategories),
  description: z.string().trim().min(10).max(3000),
  location_detail: z.string().trim().max(200).default("Mess / dining area"),
});

export const messStatusLabel = (status) => status?.replaceAll("_", " ") || "—";

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftDate(dateValue, amount) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}
