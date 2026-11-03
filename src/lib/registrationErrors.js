export function registrationErrorMessage(error, details) {
  const invalidFields = Array.isArray(details?.invalid_fields)
    ? [...new Set(details.invalid_fields.map(String))]
    : [];
  if (invalidFields.length) {
    const labels = invalidFields.map((field) =>
      field === "student" || field === ""
        ? "student information"
        : field.replaceAll("_", " ").replaceAll(".", " → "),
    );
    return `Please check these submitted fields: ${labels.join(", ")}. No account was created for this validation error.`;
  }
  if (
    details?.error ===
    "Invalid registration information. Check all required fields."
  ) {
    return "The deployed student-registration function requires a student ID before it runs ID generation, but this form leaves ID generation to the server. Deploy the updated function after verifying the admission columns and ID-reservation RPC. This validation rejection occurs before account creation or bed allocation; check the student directory before retrying.";
  }
  if (typeof details?.error === "string" && details.error) return details.error;
  if (
    error?.name === "FunctionsFetchError" ||
    error?.message === "Failed to send a request to the Edge Function"
  ) {
    return "The browser could not reach the student-registration Edge Function. Its CORS origin setting may be missing or different from the app URL. Set APP_ORIGIN to the exact site origin, allow APP_ORIGIN/reset-password in Supabase Auth redirects, and deploy the current function. Check the student directory before retrying, in case the request reached Supabase but its response was blocked.";
  }
  return error?.message || "Student registration failed.";
}
