import { test } from "node:test";
import assert from "node:assert/strict";
import { studentSchema, validatePhoto } from "../src/lib/studentValidation.js";
test("student validation rejects invalid dates, emails, phone, semester and PIN", () => {
  for (const [field, value] of Object.entries({
    date_of_birth: "2999-01-01",
    email: "bad",
    phone: "abc",
    semester: 0,
    pincode: "12",
    bed_id: "",
  }))
    assert.equal(
      studentSchema.shape[field].safeParse(value).success,
      false,
      field,
    );
});
test("avatar validation permits only JPEG, PNG, WebP up to 5 MB", () => {
  assert.throws(() => validatePhoto({ type: "image/svg+xml", size: 1 }));
  assert.throws(() => validatePhoto({ type: "image/png", size: 5242881 }));
  assert.doesNotThrow(() =>
    validatePhoto({ type: "image/webp", size: 5242880 }),
  );
});
test("birth dates cannot normalize nonexistent calendar dates", () => {
  assert.equal(
    studentSchema.shape.date_of_birth.safeParse("2000-02-31").success,
    false,
  );
});
test("admission allows unspecified gender and validates admission dates and guardian contact", () => {
  assert.equal(studentSchema.shape.gender.safeParse("").success, true);
  assert.equal(
    studentSchema.shape.admission_date.safeParse("2026-02-31").success,
    false,
  );
  assert.equal(
    studentSchema.shape.allocation_start_date.safeParse("2026-10-24").success,
    true,
  );
  assert.equal(
    studentSchema.shape.emergency_contact_name.safeParse("").success,
    false,
  );
});

test("student admission form payload delegates the hostel ID to the server", () => {
  assert.equal(Object.hasOwn(studentSchema.shape, "student_id"), false);
  const payload = studentSchema.parse({
    full_name: "Test student",
    date_of_birth: "2000-01-01",
    gender: "",
    course: "Course",
    branch: "Branch",
    academic_year: "2026",
    semester: "1",
    email: "STUDENT@example.invalid",
    phone: "9999999999",
    permanent_address: "Address",
    city: "City",
    state: "State",
    pincode: "123456",
    current_address: "",
    admission_date: "2026-10-26",
    allocation_start_date: "2026-10-27",
    admission_note: "",
    guardian_name: "Guardian",
    relationship: "Parent",
    guardian_phone: "9999999999",
    guardian_email: "",
    emergency_contact: "9999999999",
    emergency_contact_name: "Emergency contact",
    guardian_address: "",
    bed_id: "00000000-0000-4000-8000-000000000099",
  });
  assert.equal(payload.email, "student@example.invalid");
  assert.equal(Object.hasOwn(payload, "student_id"), false);
  assert.equal(payload.current_address, "");
  assert.equal(payload.guardian_address, "");
});
