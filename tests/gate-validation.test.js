import { test } from "node:test";
import assert from "node:assert/strict";
import {
  passCodeSchema,
  passCodeRegex,
  manualScanSchema,
  manualOverrideSchema,
  revocationSchema,
  parseQrScanPayload,
  formatGateStatus,
} from "../src/lib/gateValidation.js";

test("gate pass code validation and regex", () => {
  const validCodes = [
    "GP-26001000",
    "GP-1000",
    "GP-26ABCDEF",
    "GP-A1B2C3D4",
    "gp-26001000",
  ];

  for (const code of validCodes) {
    assert.equal(passCodeRegex.test(code), true, `Expected valid: ${code}`);
    assert.doesNotThrow(() => passCodeSchema.parse(code));
  }

  const invalidCodes = [
    "12345",
    "GP-",
    "GP",
    "INVALID-CODE",
    "GP-1",
    "",
    "   ",
    "GP-TOOLONGCODE1234567890",
  ];

  for (const code of invalidCodes) {
    assert.equal(passCodeRegex.test(code), false, `Expected invalid: ${code}`);
    assert.throws(() => passCodeSchema.parse(code));
  }
});

test("parseQrScanPayload handles various scan inputs", () => {
  // 1. Valid JSON payload from app QR generator
  const jsonPayload = JSON.stringify({
    v: 1,
    pass_id: "e4d3c2b1-0000-4000-8000-000000000001",
    token: "f6e5d4c3b2a100001122334455667788",
    pass_code: "GP-26001000",
  });
  const parsedJson = parseQrScanPayload(jsonPayload);
  assert.equal(parsedJson.pass_id, "e4d3c2b1-0000-4000-8000-000000000001");
  assert.equal(parsedJson.token, "f6e5d4c3b2a100001122334455667788");
  assert.equal(parsedJson.pass_code, "GP-26001000");

  // 2. Raw pass code string
  const rawCode = "GP-26001000";
  const parsedRaw = parseQrScanPayload(rawCode);
  assert.equal(parsedRaw.pass_code, "GP-26001000");
  assert.equal(parsedRaw.pass_id, null);
  assert.equal(parsedRaw.token, null);

  // 3. Lowercase raw code
  const lowerCode = "gp-26001000";
  const parsedLower = parseQrScanPayload(lowerCode);
  assert.equal(parsedLower.pass_code, "GP-26001000");

  // 4. URL string with params
  const urlPayload = "https://hostelhub.local/gate?code=GP-26001000&token=secret123";
  const parsedUrl = parseQrScanPayload(urlPayload);
  assert.equal(parsedUrl.pass_code, "GP-26001000");
  assert.equal(parsedUrl.token, "secret123");

  const secureUrl = "https://hostel.amitkumar.info.np/gate/verify?pass_id=e4d3c2b1-0000-4000-8000-000000000001#token=" + "a".repeat(64);
  const parsedSecureUrl = parseQrScanPayload(secureUrl);
  assert.equal(parsedSecureUrl.pass_id, "e4d3c2b1-0000-4000-8000-000000000001");
  assert.equal(parsedSecureUrl.token, "a".repeat(64));
  assert.equal(parsedSecureUrl.pass_code, null);

  // 5. Invalid / garbage payloads throw
  assert.throws(() => parseQrScanPayload(""));
  assert.throws(() => parseQrScanPayload("Hello World"));
  assert.throws(() => parseQrScanPayload("{}"));
  assert.throws(() => parseQrScanPayload(null));
});

test("manualOverrideSchema requires valid fields and min 5-character reason", () => {
  const valid = {
    student_id: "00000000-0000-4000-8000-000000000002",
    event_type: "exit",
    override_reason: "Student phone battery died, verified via hostel warden call.",
  };
  assert.doesNotThrow(() => manualOverrideSchema.parse(valid));

  // Invalid reason too short
  assert.throws(() =>
    manualOverrideSchema.parse({
      ...valid,
      override_reason: "Sick",
    }),
  );

  // Invalid event type
  assert.throws(() =>
    manualOverrideSchema.parse({
      ...valid,
      event_type: "invalid",
    }),
  );

  // Invalid student UUID
  assert.throws(() =>
    manualOverrideSchema.parse({
      ...valid,
      student_id: "not-a-uuid",
    }),
  );
});

test("manualScanSchema validates pass code and event type", () => {
  assert.doesNotThrow(() =>
    manualScanSchema.parse({ pass_code: "GP-26001000", event_type: "exit" }),
  );
  assert.doesNotThrow(() =>
    manualScanSchema.parse({ pass_code: "GP-26001000", event_type: "entry" }),
  );
  assert.throws(() =>
    manualScanSchema.parse({ pass_code: "invalid", event_type: "exit" }),
  );
  assert.throws(() =>
    manualScanSchema.parse({ pass_code: "GP-26001000", event_type: "invalid" }),
  );
});

test("revocationSchema requires min 3-character reason", () => {
  assert.doesNotThrow(() =>
    revocationSchema.parse({ reason: "Disciplinary action by warden" }),
  );
  assert.throws(() => revocationSchema.parse({ reason: "No" }));
  assert.throws(() => revocationSchema.parse({ reason: "   " }));
});

test("formatGateStatus formats status codes correctly", () => {
  assert.equal(formatGateStatus("active"), "Active");
  assert.equal(formatGateStatus("used"), "Exit Recorded");
  assert.equal(formatGateStatus("completed"), "Completed");
  assert.equal(formatGateStatus("expired"), "Expired");
  assert.equal(formatGateStatus("revoked"), "Revoked");
  assert.equal(formatGateStatus("unknown"), "unknown");
  assert.equal(formatGateStatus(null), "—");
});
