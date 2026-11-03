import test from "node:test";
import assert from "node:assert/strict";
import { canAccess, homeFor } from "../src/utils/access.js";
test("each active role is routed only to its own dashboard", () => {
  for (const role of ["admin", "student", "warden", "security_guard"]) {
    const profile = { role, is_active: true };
    assert.equal(homeFor(profile), role === "security_guard" ? "/gate/scan" : `/${role}/dashboard`);
    for (const target of ["admin", "student", "warden", "security_guard"])
      assert.equal(canAccess(profile, target), target === role);
  }
});
test("legacy security role does not receive an application route", () => {
  assert.equal(homeFor({ role: "security", is_active: true }), "/unauthorized");
  assert.equal(canAccess({ role: "security_guard", is_active: true }, "admin"), false);
  assert.equal(canAccess({ role: "security_guard", is_active: true }, "student"), false);
});
test("missing, inactive and unrecognized profiles fail closed", () => {
  for (const profile of [
    null,
    undefined,
    {},
    { role: "admin", is_active: false },
    { role: "owner", is_active: true },
  ]) {
    assert.equal(homeFor(profile), "/unauthorized");
    assert.equal(canAccess(profile, "admin"), false);
  }
});
