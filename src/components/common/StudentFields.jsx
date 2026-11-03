export const fieldLabels = {
  full_name: "Full name",
  date_of_birth: "Date of birth",
  gender: "Gender",
  course: "Course",
  branch: "Branch",
  academic_year: "Academic year",
  semester: "Semester",
  email: "Student email",
  phone: "Phone number",
  permanent_address: "Permanent address",
  city: "City",
  state: "State",
  pincode: "PIN code",
  guardian_name: "Guardian name",
  relationship: "Relationship",
  guardian_phone: "Guardian phone",
  guardian_email: "Guardian email",
  emergency_contact: "Emergency phone",
  emergency_contact_name: "Emergency contact name",
  current_address: "Current address (optional)",
  guardian_address: "Guardian address (optional)",
  admission_date: "Admission date",
  allocation_start_date: "Allocation start date",
  admission_note: "Admission note (optional)",
};
export function StudentFields({ fields, register, errors, disabled = false }) {
  return (
    <div className="form-grid">
      {fields.map((name) => (
        <label key={name} htmlFor={name}>
          {fieldLabels[name]}{" "}
          {[
            "guardian_email",
            "current_address",
            "guardian_address",
            "gender",
            "admission_note",
          ].includes(name)
            ? "(optional)"
            : "*"}
          {name === "gender" ? (
            <select id={name} {...register(name)} disabled={disabled}>
              <option value="">Choose gender</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          ) : (
            <input
              id={name}
              type={
                [
                  "date_of_birth",
                  "admission_date",
                  "allocation_start_date",
                ].includes(name)
                  ? "date"
                  : name.includes("email")
                    ? "email"
                    : name === "semester"
                      ? "number"
                      : name.includes("phone") || name === "emergency_contact"
                        ? "tel"
                        : "text"
              }
              {...register(name)}
              disabled={disabled}
              aria-invalid={!!errors[name]}
              aria-describedby={`${name}-error`}
            />
          )}
          <small className="field-error" id={`${name}-error`}>
            {errors[name]?.message}
          </small>
        </label>
      ))}
    </div>
  );
}
