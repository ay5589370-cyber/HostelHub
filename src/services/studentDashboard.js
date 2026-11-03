import { getStudent } from "./students";
import {
  countStudentLeaves,
  listRecentStudentLeaves,
} from "./leaves";
import { loadWeeklyMessRoutine } from "./mess";

async function optional(fetcher, label = "Leave services") {
  try {
    return { available: true, data: await fetcher(), error: null };
  } catch (error) {
    const missingSchema = [
      "42P01",
      "42883",
      "42703",
      "PGRST200",
      "PGRST202",
      "PGRST204",
      "PGRST205",
    ].includes(error?.code);
    return {
      available: false,
      data: null,
      error: missingSchema
        ? `${label} ${label === "Leave services" ? "are" : "is"} unavailable because the required database migration is missing.`
        : error?.message || "Could not load leave records.",
    };
  }
}

export async function loadStudentDashboard(userId) {
  if (!userId) throw new Error("Your student session could not be verified.");
  const [student, leaves, counts, messRoutine] = await Promise.all([
    getStudent(null, userId),
    optional(listRecentStudentLeaves),
    optional(countStudentLeaves),
    optional(loadWeeklyMessRoutine, "The weekly mess routine"),
  ]);
  return { student, leaves, counts, messRoutine };
}
