import test from "node:test";
import assert from "node:assert/strict";
import { canAccess, homeFor } from "../src/utils/access.js";
test("each active role is routed only to its own dashboard", () => {
  for (const role of ["admin", "student", "warden", "security"]) {
    const profile = { role, is_active: true };
    assert.equal(homeFor(profile), `/${role}/dashboard`);
    for (const target of ["admin", "student", "warden", "security"])
      assert.equal(canAccess(profile, target), target === role);
  }
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
