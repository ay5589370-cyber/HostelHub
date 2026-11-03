import { test } from "node:test";
import assert from "node:assert/strict";
import { leaveFormSchema, validateLeaveFiles } from "../src/lib/leaveValidation.js";

const localStr = (hours) => {
  const d = new Date(Date.now() + hours * 3600000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

test("leaveFormSchema validates day-out and night-out requests", () => {
  const departure = localStr(2);
  const expectedReturn = localStr(8);

  const validDayOut = {
    leave_type: "day_out",
    departure_local: departure,
    expected_return_local: expectedReturn,
    destination: "City Library",
    reason: "Studying for upcoming semester finals",
    emergency_contact: "+1 555-123-4567",
    rules_confirmed: true,
  };
  assert.equal(leaveFormSchema.safeParse(validDayOut).success, true);

  const validNightOut = {
    ...validDayOut,
    leave_type: "night_out",
    expected_return_local: localStr(48),
  };
  assert.equal(leaveFormSchema.safeParse(validNightOut).success, true);
});

test("leaveFormSchema rejects past departure dates", () => {
  const pastDeparture = "2020-01-01T08:00";
  const futureReturn = localStr(8);

  const result = leaveFormSchema.safeParse({
    leave_type: "day_out",
    departure_local: pastDeparture,
    expected_return_local: futureReturn,
    destination: "City Library",
    reason: "Studying for finals",
    emergency_contact: "9999999999",
    rules_confirmed: true,
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /Departure must be in the future/i);
});

test("leaveFormSchema rejects impossible local date-times", () => {
  const result = leaveFormSchema.safeParse({
    leave_type: "night_out",
    departure_local: "2030-02-31T08:00",
    expected_return_local: "2030-03-02T09:00",
    destination: "Valid Destination",
    reason: "A valid reason for a night out",
    emergency_contact: "9999999999",
    rules_confirmed: true,
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /valid departure date and time/i);
});

test("leaveFormSchema rejects expected return preceding departure", () => {
  const departure = localStr(10);
  const invalidReturn = localStr(5);

  const result = leaveFormSchema.safeParse({
    leave_type: "day_out",
    departure_local: departure,
    expected_return_local: invalidReturn,
    destination: "City Library",
    reason: "Studying for finals",
    emergency_contact: "9999999999",
    rules_confirmed: true,
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /Return time must be after departure/i);
});

test("leaveFormSchema requires the return to follow departure for night-out", () => {
  const result = leaveFormSchema.safeParse({
    leave_type: "night_out",
    departure_local: "2030-05-10T20:00",
    expected_return_local: "2030-05-10T19:00",
    destination: "Valid Destination",
    reason: "A valid reason for a night out",
    emergency_contact: "9999999999",
    rules_confirmed: true,
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /Return time must be after departure/i);
});

test("leaveFormSchema rejects missing or short destination and reason", () => {
  const departure = leaveFormSchema.safeParse({
    leave_type: "day_out",
    departure_local: localStr(2),
    expected_return_local: localStr(8),
    destination: "a",
    reason: "Valid reason here",
    emergency_contact: "9999999999",
    rules_confirmed: true,
  });
  assert.equal(departure.success, false);

  const reasonResult = leaveFormSchema.safeParse({
    leave_type: "day_out",
    departure_local: localStr(2),
    expected_return_local: localStr(8),
    destination: "Valid Destination",
    reason: "tiny",
    emergency_contact: "9999999999",
    rules_confirmed: true,
  });
  assert.equal(reasonResult.success, false);
});

test("leaveFormSchema rejects unconfirmed rules and invalid emergency contact", () => {
  const departure = localStr(2);
  const expectedReturn = localStr(8);

  assert.equal(
    leaveFormSchema.safeParse({
      leave_type: "day_out",
      departure_local: departure,
      expected_return_local: expectedReturn,
      destination: "Valid Destination",
      reason: "Valid reason here",
      emergency_contact: "not-a-phone",
      rules_confirmed: true,
    }).success,
    false,
  );

  assert.equal(
    leaveFormSchema.safeParse({
      leave_type: "day_out",
      departure_local: departure,
      expected_return_local: expectedReturn,
      destination: "Valid Destination",
      reason: "Valid reason here",
      emergency_contact: "9999999999",
      rules_confirmed: false,
    }).success,
    false,
  );
});

test("validateLeaveFiles enforces file count, mime types, and size limits", () => {
  const validPdf = { name: "doc.pdf", type: "application/pdf", size: 1024 * 1024 };
  const validJpg = { name: "photo.jpg", type: "image/jpeg", size: 2 * 1024 * 1024 };
  const validPng = { name: "receipt.png", type: "image/png", size: 500 * 1024 };
  const validWebp = { name: "card.webp", type: "image/webp", size: 100 * 1024 };

  assert.doesNotThrow(() => validateLeaveFiles([validPdf, validJpg, validPng]));

  assert.throws(
    () => validateLeaveFiles([validPdf, validJpg, validPng, validWebp]),
    /up to 3 documents/i,
  );

  assert.throws(
    () => validateLeaveFiles([{ name: "archive.zip", type: "application/zip", size: 1024 }]),
    /must be PDF, JPEG, PNG, or WebP/i,
  );

  assert.throws(
    () => validateLeaveFiles([{ name: "huge.pdf", type: "application/pdf", size: 5 * 1024 * 1024 + 1 }]),
    /5 MB or smaller/i,
  );
});
