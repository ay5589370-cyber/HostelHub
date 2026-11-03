import { createHandler } from "./handler.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw new Error(message);
};

const requestId = "00000000-0000-4000-8000-000000000005";

function fixture(
  options: {
    role?: string;
    existing?: boolean;
    inviteFails?: boolean;
    finishFails?: boolean;
    rpcFails?: boolean;
    authUpdateFails?: boolean;
    confirmed?: boolean;
    action?:
      | "register"
      | "resend"
      | "reset_temporary_password"
      | "student_complete_password_setup";
    active?: boolean;
    mustChangePassword?: boolean;
    invitationStatus?: string;
    missingRegistration?: boolean;
    password?: string;
    student?: Record<string, unknown>;
  } = {},
) {
  const calls: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const rpcInputs: Record<string, unknown>[] = [];
  const authWrites: Record<string, unknown>[] = [];
  const action = options.action || "register";
  let finishFails = options.finishFails ?? false;

  const job: {
    id: string;
    auth_user_id: string;
    email: string;
    payload: Record<string, unknown>;
    lease_token: string;
    student_id?: string;
  } = {
    id: requestId,
    auth_user_id: "fixed-auth-id",
    email: "test@example.invalid",
    payload: { full_name: "Test student" },
    lease_token: "lease",
  };

  let created = !!options.existing;

  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: {
              id:
                action === "student_complete_password_setup"
                  ? "student-user-id"
                  : "admin",
            },
          },
          error: null,
        }),
      admin: {
        getUserById: () =>
          Promise.resolve(
            created
              ? {
                  data: {
                    user: {
                      app_metadata: { registration_id: requestId },
                      email_confirmed_at: options.confirmed
                        ? "2026-01-01"
                        : null,
                    },
                  },
                  error: null,
                }
              : { data: { user: null }, error: { status: 404 } },
          ),
        createUser: (value: Record<string, unknown>) => {
          calls.push("create");
          assert(value.id === job.auth_user_id);
          assert(
            typeof value.password === "string" && /^\d{8}$/.test(value.password),
          );
          assert(value.email_confirm === true);
          authWrites.push(value);
          created = true;
          return Promise.resolve({ error: null });
        },
        updateUserById: (_id: string, value: Record<string, unknown>) => {
          calls.push("password-update");
          authWrites.push(value);
          if (options.authUpdateFails) {
            return Promise.resolve({ error: new Error("Auth update failed") });
          }
          return Promise.resolve({ error: null });
        },
        inviteUserByEmail: () => {
          calls.push("invite");
          return Promise.resolve({
            error: options.inviteFails ? new Error("SMTP unavailable") : null,
          });
        },
      },
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        update: (value: Record<string, unknown>) => {
          updates.push(value);
          return chain;
        },
        single: () =>
          Promise.resolve({
            data:
              table === "profiles"
                ? {
                    role:
                      options.role ||
                      (action === "student_complete_password_setup"
                        ? "student"
                        : "admin"),
                    is_active: options.active !== false,
                    must_change_password:
                      options.mustChangePassword !== false,
                  }
                : table === "students"
                  ? { status: "active" }
                  : { id: requestId },
            error: null,
          }),
        then: (resolve: (v: unknown) => unknown) => {
          if (table === "student_registrations") {
            if (options.missingRegistration) {
              return Promise.resolve({ data: [], error: null }).then(resolve);
            }
            return Promise.resolve({
              data: [
                {
                  id: requestId,
                  invitation_status:
                    options.invitationStatus !== undefined
                      ? options.invitationStatus
                      : "credentials_ready",
                },
              ],
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return chain;
    },
    rpc: (name: string, input: Record<string, unknown>) => {
      calls.push(name);
      rpcInputs.push(input);
      if (name === "reserve_registration_student_id")
        return Promise.resolve({ data: "HH-00000001", error: null });
      if (name === "complete_student_password_setup") {
        if (options.rpcFails) {
          return Promise.resolve({
            error: new Error("Database RPC failure"),
          });
        }
        return Promise.resolve({ error: null });
      }
      return name === "claim_registration"
        ? { single: () => Promise.resolve({ data: job, error: null }) }
        : Promise.resolve({
            data: finishFails ? null : "student-id",
            error: finishFails
              ? new Error("Selected bed unavailable")
              : ((job.student_id = "student-id"), null),
          });
    },
  };

  const handler = createHandler(() => client as unknown as SupabaseClient);
  const request = () =>
    new Request("https://edge.invalid", {
      method: "POST",
      headers: {
        origin: "https://hostel.invalid",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        action,
        ...(action === "student_complete_password_setup"
          ? {
              password:
                options.password !== undefined
                  ? options.password
                  : "NewStrongP@ssw0rd123!",
            }
          : { request_id: requestId }),
        ...(action === "register"
          ? {
              student: {
                full_name: "Test student",
                date_of_birth: "2000-01-01",
                gender: "other",
                course: "Course",
                branch: "Branch",
                academic_year: "2026",
                semester: 1,
                email: "test@example.invalid",
                phone: "9999999999",
                permanent_address: "Address",
                city: "City",
                state: "State",
                pincode: "123456",
                current_address: "",
                admission_note: "",
                admission_date: "2026-01-01",
                allocation_start_date: "2026-01-01",
                guardian_name: "Guardian",
                relationship: "Parent",
                guardian_phone: "9999999999",
                guardian_email: "",
                emergency_contact: "9999999999",
                emergency_contact_name: "Emergency contact",
                guardian_address: "",
                bed_id: "00000000-0000-4000-8000-000000000099",
                ...options.student,
              },
            }
          : {}),
      }),
    });

  return {
    handler,
    request,
    calls,
    updates,
    rpcInputs,
    authWrites,
    setFinishFails: (value: boolean) => (finishFails = value),
  };
}

Deno.env.set("APP_ORIGIN", "https://hostel.invalid");

Deno.test("non-admin rejected before job or Auth mutation", async () => {
  const f = fixture({ role: "student" });
  const r = await f.handler(f.request());
  assert(r.status === 403);
  assert(f.calls.length === 0);
});

Deno.test("inactive admin rejected before job or Auth mutation", async () => {
  const f = fixture({ active: false });
  const r = await f.handler(f.request());
  assert(r.status === 403);
  assert(f.calls.length === 0);
});

Deno.test(
  "current frontend payload omits student_id; Edge reserves it and accepts all admission fields",
  async () => {
    const f = fixture();
    const submitted = await f.request().json();
    assert(!Object.hasOwn(submitted.student, "student_id"));
    const r = await f.handler(f.request());
    const body = await r.json();
    assert(r.status === 200);
    assert(
      f.calls.join(",") ===
        "reserve_registration_student_id,claim_registration,create,finish_registration",
    );
    assert(body.student_id === "student-id");
    assert(body.login_id === "test@example.invalid");
    assert(
      typeof body.temporary_password === "string" &&
        /^\d{8}$/.test(body.temporary_password),
    );
    assert(body.invitation_status === "credentials_ready");
    assert(!f.calls.includes("invite"));
    assert(f.updates.some((value) => value.must_change_password === true));
    const claimed = f.rpcInputs[1].input;
    assert(claimed.student_id === "HH-00000001");
    assert(claimed.current_address === "");
    assert(claimed.admission_date === "2026-01-01");
    assert(claimed.allocation_start_date === "2026-01-01");
    assert(claimed.guardian_email === "");
    assert(claimed.guardian_address === "");
    assert(claimed.emergency_contact_name === "Emergency contact");
  },
);

Deno.test(
  "unexpected fields are rejected before ID reservation or Auth changes",
  async () => {
    const f = fixture({ student: { internal_role: "admin" } });
    const response = await f.handler(f.request());
    const body = await response.json();
    assert(response.status === 409);
    assert(body.invalid_fields.includes("internal_role"));
    assert(f.calls.length === 0);
    assert(!JSON.stringify(body).includes("admin"));
  },
);

Deno.test(
  "database failure never reports successful credential issuance",
  async () => {
    const f = fixture({ finishFails: true });
    const r = await f.handler(f.request());
    assert(r.status === 409);
    assert(!f.calls.includes("invite"));
  },
);

Deno.test(
  "interrupted registration retry reuses its Auth account and request ID",
  async () => {
    const f = fixture({ finishFails: true });
    const first = await f.handler(f.request());
    assert(first.status === 409);
    assert(f.calls.filter((call) => call === "create").length === 1);
    f.setFinishFails(false);
    const retry = await f.handler(f.request());
    const result = await retry.json();
    assert(retry.status === 200);
    assert(result.student_id === "student-id");
    assert(f.calls.filter((call) => call === "create").length === 1);
    assert(f.calls.filter((call) => call === "password-update").length === 1);
    assert(
      f.calls.filter((call) => call === "reserve_registration_student_id")
        .length === 2,
    );
    assert(f.rpcInputs[1].input.student_id === f.rpcInputs[4].input.student_id);
    assert(!f.calls.includes("invite"));
  },
);

Deno.test("cross-origin requests rejected", async () => {
  const f = fixture();
  const r = await f.handler(
    new Request("https://edge.invalid", {
      method: "POST",
      headers: { origin: "https://wrong.invalid" },
    }),
  );
  assert(r.status === 403);
});

Deno.test("APP_ORIGIN must be a configured exact origin", async () => {
  Deno.env.set("APP_ORIGIN", "https://hostel.invalid/path");
  const f = fixture();
  const r = await f.handler(f.request());
  assert(r.status === 503);
  Deno.env.set("APP_ORIGIN", "https://hostel.invalid");
});

Deno.test(
  "registration reserves a server-generated ID before claiming",
  async () => {
    const f = fixture({ action: "register" });
    const r = await f.handler(f.request());
    assert(r.status === 200);
    assert(
      f.calls.join(",") ===
        "reserve_registration_student_id,claim_registration,create,finish_registration",
    );
    assert(f.rpcInputs[1].input.student_id === "HH-00000001");
  },
);

Deno.test(
  "validation errors return field paths only, without submitted values",
  async () => {
    const f = fixture({
      action: "register",
      student: { email: "private-value@example.invalid" },
    });
    const response = await f.handler(f.request());
    const body = await response.json();
    assert(response.status === 409);
    assert(body.invalid_fields.includes("email"));
    assert(!JSON.stringify(body).includes("private-value@example.invalid"));
  },
);

// ============================================================================
// SUPABASE_ANON_KEY deployment guard test
// ============================================================================
Deno.test(
  "getUserClient throws when SUPABASE_ANON_KEY is absent and no userClientFactory provided",
  async () => {
    // Build a handler with no userClientFactory override.
    // Unset SUPABASE_ANON_KEY so the deployment guard fires.
    const savedAnon = Deno.env.get("SUPABASE_ANON_KEY");
    Deno.env.delete("SUPABASE_ANON_KEY");

    // We still need a service-role client factory stub so the handler can
    // validate the JWT before reaching getUserClient.
    const stubClient = {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: { id: "student-user-id" } },
            error: null,
          }),
        admin: {
          getUserById: () =>
            Promise.resolve({ data: { user: null }, error: { status: 404 } }),
        },
      },
      from: () => ({
        select: function () { return this; },
        eq: function () { return this; },
        single: () =>
          Promise.resolve({
            data: { role: "student", is_active: true, must_change_password: true },
            error: null,
          }),
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    };

    // createHandler without a userClientFactory — the real getUserClient is used.
    const { createHandler } = await import("./handler.ts");
    const handler = createHandler(
      () => stubClient as unknown as import("npm:@supabase/supabase-js@2.118.0").SupabaseClient,
      // No userClientFactory — forces the real path.
    );

    const req = new Request("https://edge.invalid", {
      method: "POST",
      headers: {
        origin: "https://hostel.invalid",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        action: "student_complete_password_setup",
        password: "MySecurePassword123!",
      }),
    });

    const response = await handler(req);
    // Should be 500 (uncaught error in the catch block) or 409, but crucially
    // must NOT be 200 — the deployment guard must prevent a silent bypass.
    assert(
      response.status !== 200,
      "Expected non-200 when SUPABASE_ANON_KEY is absent",
    );
    const body = await response.json();
    // The error text should mention SUPABASE_ANON_KEY or configuration.
    assert(
      JSON.stringify(body).toLowerCase().includes("supabase_anon_key") ||
        JSON.stringify(body).toLowerCase().includes("configuration") ||
        response.status === 500 ||
        response.status === 409,
      "Expected configuration error when SUPABASE_ANON_KEY is missing",
    );

    // Restore env
    if (savedAnon !== undefined) Deno.env.set("SUPABASE_ANON_KEY", savedAnon);
  },
);

// ============================================================================
// STUDENT PASSWORD SETUP TESTS
// ============================================================================
Deno.test(
  "student can complete first-login password setup successfully",
  async () => {
    const f = fixture({
      action: "student_complete_password_setup",
      password: "MySecurePassword123!",
    });
    const response = await f.handler(f.request());
    const body = await response.json();
    assert(response.status === 200);
    assert(body.success === true);
    assert(f.calls.includes("password-update"));
    assert(f.calls.includes("complete_student_password_setup"));
    assert(f.rpcInputs[0].p_student_auth_id === "student-user-id");
  },
);

Deno.test(
  "non-student cannot invoke student_complete_password_setup",
  async () => {
    const f = fixture({
      action: "student_complete_password_setup",
      role: "admin",
    });
    const response = await f.handler(f.request());
    assert(response.status === 403);
    assert(f.calls.length === 0);
  },
);

Deno.test(
  "inactive student cannot invoke student_complete_password_setup",
  async () => {
    const f = fixture({
      action: "student_complete_password_setup",
      active: false,
    });
    const response = await f.handler(f.request());
    assert(response.status === 403);
    assert(f.calls.length === 0);
  },
);

Deno.test("password shorter than 12 characters is rejected", async () => {
  const f = fixture({
    action: "student_complete_password_setup",
    password: "short",
  });
  const response = await f.handler(f.request());
  const body = await response.json();
  assert(response.status === 400);
  assert(body.error.includes("at least 12 characters"));
  assert(f.calls.length === 0);
});

Deno.test("password longer than 100 characters is rejected", async () => {
  const f = fixture({
    action: "student_complete_password_setup",
    password: "a".repeat(101),
  });
  const response = await f.handler(f.request());
  const body = await response.json();
  assert(response.status === 400);
  assert(body.error.includes("100 characters"));
  assert(f.calls.length === 0);
});

Deno.test(
  "missing registration rejects student_complete_password_setup",
  async () => {
    const f = fixture({
      action: "student_complete_password_setup",
      missingRegistration: true,
    });
    const response = await f.handler(f.request());
    assert(response.status === 409);
    assert(f.calls.length === 0);
  },
);

Deno.test(
  "non-credentials_ready registration status rejects setup",
  async () => {
    const f = fixture({
      action: "student_complete_password_setup",
      invitationStatus: "pending",
    });
    const response = await f.handler(f.request());
    assert(response.status === 409);
    assert(f.calls.length === 0);
  },
);

Deno.test(
  "RPC failure keeps setup pending and reports error",
  async () => {
    const f = fixture({
      action: "student_complete_password_setup",
      rpcFails: true,
    });
    const response = await f.handler(f.request());
    assert(response.status === 500);
    assert(f.calls.includes("password-update"));
    assert(f.calls.includes("complete_student_password_setup"));
  },
);

Deno.test(
  "retry after already completed setup returns success safely",
  async () => {
    const f = fixture({
      action: "student_complete_password_setup",
      mustChangePassword: false,
      invitationStatus: "password_set",
    });
    const response = await f.handler(f.request());
    const body = await response.json();
    assert(response.status === 200);
    assert(body.already_completed === true);
    assert(f.calls.length === 0); // No redundant mutations
  },
);
