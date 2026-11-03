import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { z } from "npm:zod@4.1.12";

const text = z.string().trim().min(1).max(200);
const phone = z.string().regex(/^\+?[0-9 ()-]{7,20}$/);
const calendarDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
});

const schema = z
  .object({
    full_name: text.min(2).max(100),
    date_of_birth: text.refine(
      (v) =>
        /^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v &&
        v < new Date().toISOString().slice(0, 10),
    ),
    gender: z
      .union([
        z.enum(["male", "female", "other", "prefer_not_to_say"]),
        z.literal(""),
      ])
      .default(""),
    course: text,
    branch: text,
    academic_year: text,
    semester: z.number().int().min(1).max(20),
    email: z
      .email()
      .max(320)
      .transform((v) => v.toLowerCase()),
    phone,
    permanent_address: text.max(500),
    city: text,
    state: text,
    pincode: z.string().regex(/^\d{6}$/),
    current_address: z.string().trim().max(500).default(""),
    admission_note: z.string().trim().max(1000).default(""),
    admission_date: calendarDate,
    allocation_start_date: calendarDate,
    guardian_name: text.max(100),
    relationship: text,
    guardian_phone: phone,
    guardian_email: z.union([z.email(), z.literal("")]),
    emergency_contact: phone,
    emergency_contact_name: text.max(100),
    guardian_address: z.string().trim().max(500).default(""),
    bed_id: z.uuid(),
    // Student IDs are deliberately client-ineligible; reserve them server-side below.
  })
  .strict();

const passwordPolicySchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(100, "Password cannot exceed 100 characters.");

export function createHandler(
  clientFactory = () =>
    createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ),
  userClientFactory?: (jwt: string) => SupabaseClient,
) {
  const temporaryPassword = () => {
    const digits = crypto.getRandomValues(new Uint32Array(8));
    return Array.from(digits, (value) => String(value % 10)).join("");
  };

  const getUserClient = (jwt: string): SupabaseClient => {
    if (userClientFactory) return userClientFactory(jwt);
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anonKey) {
      // SUPABASE_ANON_KEY is not auto-injected by Supabase — it must be set
      // explicitly as an Edge Function secret before deployment.
      // Failing hard here prevents a silent fallback to the service-role client,
      // which would defeat the client-separation security design.
      throw new Error(
        "SUPABASE_ANON_KEY is not configured. Add it as an Edge Function secret before deploying.",
      );
    }
    return createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  };

  return async (req: Request) => {
    const origin = Deno.env.get("APP_ORIGIN");
    const requestOrigin = req.headers.get("origin");
    const cors = {
      "Access-Control-Allow-Origin": origin || "",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    };
    const respond = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    let validOrigin = false;
    try {
      const parsed = new URL(origin || "");
      validOrigin =
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.origin === origin;
    } catch {
      // An unset or malformed APP_ORIGIN is a deployment configuration error.
    }
    if (!validOrigin)
      return respond(503, {
        error:
          "APP_ORIGIN must be the exact application origin, without a path or trailing slash.",
      });
    if (requestOrigin && requestOrigin !== origin)
      return respond(403, { error: "Origin not allowed." });
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return respond(405, { error: "POST required." });

    const client = clientFactory();
    let job: any;

    try {
      const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!jwt) return respond(401, { error: "Sign in to continue." });

      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser(jwt);
      if (authError || !user)
        return respond(401, { error: "Invalid session." });

      const raw = await req.text();
      if (raw.length > 20000)
        return respond(413, { error: "Request too large." });
      const body = JSON.parse(raw);

      const action = z
        .enum([
          "register",
          "resend",
          "reset_temporary_password",
          "student_complete_password_setup",
        ])
        .parse(body.action);

      // ======================================================================
      // ACTION: student_complete_password_setup (Student-Scoped Workflow)
      // ======================================================================
      if (action === "student_complete_password_setup") {
        const userClient = getUserClient(jwt);

        // Read student profile using user-scoped client
        const { data: actor, error: roleError } = await userClient
          .from("profiles")
          .select("role,is_active,must_change_password")
          .eq("id", user.id)
          .single();

        if (roleError || actor?.role !== "student" || !actor.is_active) {
          return respond(403, { error: "Student account access required." });
        }

        // Query registration records for this auth user using admin client
        const { data: registrations, error: regError } = await client
          .from("student_registrations")
          .select("id, invitation_status")
          .eq("auth_user_id", user.id);

        if (regError) {
          return respond(500, { error: "Failed to verify registration records." });
        }

        // Idempotency: If setup is already finished, report success without updating password
        if (
          !actor.must_change_password &&
          registrations &&
          registrations.length === 1 &&
          registrations[0].invitation_status === "password_set"
        ) {
          return respond(200, {
            success: true,
            already_completed: true,
            message: "Password setup has already been completed.",
          });
        }

        if (!actor.must_change_password) {
          return respond(409, {
            error: "No pending password setup exists for this account.",
          });
        }

        if (
          !registrations ||
          registrations.length !== 1 ||
          registrations[0].invitation_status !== "credentials_ready"
        ) {
          return respond(409, {
            error:
              "No pending registration requiring password setup was found.",
          });
        }

        // Validate password without silent trimming
        const passwordValidation = passwordPolicySchema.safeParse(body.password);
        if (!passwordValidation.success) {
          return respond(400, {
            error: passwordValidation.error.issues[0].message,
          });
        }
        const newPassword = passwordValidation.data;

        // Update password using Supabase Auth Admin API (do not automatically set email_confirm)
        const { error: authUpdateError } =
          await client.auth.admin.updateUserById(user.id, {
            password: newPassword,
          });

        if (authUpdateError) {
          return respond(500, {
            error: "Failed to update authentication credentials.",
          });
        }

        // Finalize database state atomically using the service-role-only RPC
        const { error: rpcError } = await client.rpc(
          "complete_student_password_setup",
          { p_student_auth_id: user.id },
        );

        if (rpcError) {
          return respond(500, {
            error:
              "Password updated, but profile status finalization failed. Please retry.",
          });
        }

        return respond(200, {
          success: true,
          message: "Password setup completed successfully.",
        });
      }

      // ======================================================================
      // ADMIN ACTIONS: register, resend, reset_temporary_password
      // ======================================================================
      const { data: actor, error: roleError } = await client
        .from("profiles")
        .select("role,is_active")
        .eq("id", user.id)
        .single();
      if (roleError || actor?.role !== "admin" || !actor.is_active)
        return respond(403, { error: "Administrator access required." });

      const credentialSchema = await client
        .from("profiles")
        .select("must_change_password")
        .eq("id", user.id)
        .single();
      if (credentialSchema.error)
        return respond(503, {
          error:
            "Student temporary-credential database migration is not installed. No student account was created.",
        });

      const id = z.uuid().parse(body.request_id);
      let input =
        body.action === "register" ? schema.parse(body.student) : null;
      if (input) {
        const { data: generatedId, error: idError } = await client.rpc(
          "reserve_registration_student_id",
          { p_registration_id: id },
        );
        if (idError) throw idError;
        input = { ...input, student_id: generatedId };
      }
      const { data: claimed, error: claimError } = await client
        .rpc("claim_registration", { request_id: id, actor: user.id, input })
        .single();
      if (claimError) throw claimError;
      job = claimed;

      if (body.action === "reset_temporary_password" && !job.student_id)
        throw new Error("The student registration is not complete yet.");
      if (body.action === "reset_temporary_password") {
        const { data: student, error: studentError } = await client
          .from("students")
          .select("status")
          .eq("id", job.student_id)
          .single();
        if (studentError || student?.status !== "active")
          throw new Error(
            "Only active students can receive temporary credentials.",
          );
      }

      // Fixed, durable Auth UUID closes the crash window between account creation and job update.
      const existing = await client.auth.admin.getUserById(job.auth_user_id);
      let password;
      if (!existing.data.user) {
        if (existing.error && existing.error.status !== 404)
          throw existing.error;
        password = temporaryPassword();
        const created = await client.auth.admin.createUser({
          id: job.auth_user_id,
          email: job.email,
          password,
          email_confirm: true,
          app_metadata: { registration_id: job.id },
          user_metadata: { full_name: job.payload.full_name },
        });
        if (created.error) throw created.error;
        const requireChange = await client
          .from("profiles")
          .update({ must_change_password: true })
          .eq("id", job.auth_user_id)
          .select("id")
          .single();
        if (requireChange.error) throw requireChange.error;
      } else if (existing.data.user.app_metadata?.registration_id !== job.id) {
        throw new Error(
          "Account ownership mismatch. Administrator reconciliation required.",
        );
      } else if (
        body.action === "reset_temporary_password" ||
        body.action === "resend" ||
        body.action === "register"
      ) {
        const { data: profile, error: profileError } = await client
          .from("profiles")
          .select("must_change_password,is_active")
          .eq("id", job.auth_user_id)
          .single();
        if (profileError || !profile?.is_active)
          throw new Error("Student account is unavailable.");
        if (body.action === "resend" && !profile.must_change_password)
          throw new Error(
            "This student has already set a password. Use the password reset flow instead.",
          );
        if (
          body.action === "register" &&
          job.student_id &&
          !profile.must_change_password
        )
          throw new Error(
            "This student has already set a password. Use the password reset flow instead.",
          );
        password = temporaryPassword();
        const reset = await client.auth.admin.updateUserById(job.auth_user_id, {
          password,
          email_confirm: true,
        });
        if (reset.error) throw reset.error;
      }

      const { data: sid, error: finishError } = await client.rpc(
        "finish_registration",
        { request_id: id, token: job.lease_token },
      );
      if (finishError) throw finishError;
      job.student_id = sid;

      const { data: student, error: studentError } = await client
        .from("students")
        .select("status")
        .eq("id", sid)
        .single();
      if (studentError || student?.status !== "active")
        throw new Error("Only active students can receive login credentials.");

      const markPasswordChange = await client
        .from("profiles")
        .update({ must_change_password: true })
        .eq("id", job.auth_user_id)
        .select("id")
        .single();
      if (markPasswordChange.error) throw markPasswordChange.error;

      const invitationStatus = "credentials_ready";
      const { error: saveError } = await client
        .from("student_registrations")
        .update({
          invitation_status: invitationStatus,
          sent_at: null,
          last_error: null,
          lease_token: null,
          lease_until: null,
        })
        .eq("id", id)
        .eq("lease_token", job.lease_token)
        .select("id")
        .single();
      if (saveError) throw saveError;

      return respond(200, {
        student_id: sid,
        login_id: job.email,
        temporary_password: password,
        invitation_status: invitationStatus,
      });
    } catch (error) {
      const invalidFields =
        error instanceof z.ZodError
          ? [
              ...new Set(
                error.issues.map((issue) => issue.path.map(String).join(".")),
              ),
            ]
          : [];
      const message =
        error instanceof z.ZodError
          ? "Invalid registration information. Check all required fields."
          : (error as Error)?.message || "Registration failed.";

      if (job) {
        const saved = await client
          .from("student_registrations")
          .update({
            invitation_status: "failed",
            last_error: message.slice(0, 500),
            lease_token: null,
            lease_until: null,
          })
          .eq("id", job.id)
          .eq("lease_token", job.lease_token);
        if (saved.error)
          return respond(503, {
            error:
              "Registration interrupted; retry the same request in five minutes.",
            student_id: job.student_id || null,
          });
      }
      return respond(409, {
        error: message,
        ...(invalidFields.length ? { invalid_fields: invalidFields } : {}),
        student_id: job?.student_id || null,
        retryable: !!job,
      });
    }
  };
}
