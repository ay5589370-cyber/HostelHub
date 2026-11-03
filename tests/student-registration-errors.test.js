import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationErrorMessage } from "../src/lib/registrationErrors.js";

test("Edge Function transport errors explain the origin configuration without masking HTTP errors", () => {
  const message = registrationErrorMessage({
    name: "FunctionsFetchError",
    message: "Failed to send a request to the Edge Function",
  });
  assert.match(message, /CORS origin setting/);
  assert.match(message, /APP_ORIGIN/);
  assert.match(message, /student directory before retrying/);
  assert.equal(
    registrationErrorMessage({ message: "Selected bed unavailable" }),
    "Selected bed unavailable",
  );
  const validation = registrationErrorMessage(
    { message: "Invalid registration information. Check all required fields." },
    { invalid_fields: ["guardian_email", "bed_id", "guardian_email"] },
  );
  assert.match(validation, /guardian email, bed id/);
  assert.doesNotMatch(validation, /@/);
  const staleFunction = registrationErrorMessage(
    { message: "FunctionsHttpError" },
    { error: "Invalid registration information. Check all required fields." },
  );
  assert.match(
    staleFunction,
    /requires a student ID before it runs ID generation/,
  );
  assert.match(staleFunction, /ID-reservation RPC/);
  assert.match(staleFunction, /before account creation or bed allocation/);
});
