import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { AuthLayout } from "./Login";
import { Button } from "../../components/ui/Button";
const emailSchema = z.object({
  email: z.email("Enter a valid email address."),
});
const passwordSchema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters."),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords must match.",
    path: ["confirm"],
  });
export default function Password({ reset = false }) {
  const { session, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const firstLogin = reset && searchParams.get("first") === "1";
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(reset ? passwordSchema : emailSchema) });
  const submit = async (values) => {
    setError("");
    try {
      if (reset && firstLogin) {
        const { error: fnError } = await supabase.functions.invoke(
          "student-registration",
          {
            body: {
              action: "student_complete_password_setup",
              password: values.password,
            },
          },
        );

        if (fnError) {
          let detail;
          try {
            detail = await fnError.context.json();
          } catch {
            /* Network or non-JSON errors */
          }
          throw new Error(
            detail?.error || fnError.message || "Password setup failed.",
          );
        }

        try {
          await supabase.auth.signOut();
        } catch {
          /* Local state still advances to completed login prompt */
        }
        setDone(true);
        return;
      }

      const result = reset
        ? await supabase.auth.updateUser({ password: values.password })
        : await supabase.auth.resetPasswordForEmail(values.email, {
            redirectTo: `${window.location.origin}/reset-password`,
          });
      if (result.error) throw result.error;

      if (reset) {
        try {
          await supabase.auth.signOut();
        } catch {
          /* Local state still advances to completed prompt */
        }
      }
      setDone(true);
    } catch (err) {
      setError(
        err.message ||
          (reset
            ? firstLogin
              ? "Your password could not be updated. Please try again."
              : "Unable to update your password. Request a fresh reset link and try again."
            : "Unable to send the reset email. Please try again shortly."),
      );
    }
  };
  return (
    <AuthLayout>
      <div className="auth-form">
        <h2>
          {firstLogin
            ? "Choose your password"
            : reset
              ? "Set a new password"
              : "Forgot your password?"}
        </h2>
        <p>
          {reset
            ? firstLogin
              ? "For security, replace the temporary password before using your campus account."
              : "Choose a strong password for your campus account."
            : "We’ll send a secure reset link to your email."}
        </p>
        {done ? (
          <div className="success-message" role="status">
            {reset
              ? "Your password has been updated. Sign in with your new password."
              : "If an account exists for this email, a reset link will arrive shortly. Check your spam folder too."}
          </div>
        ) : reset && !loading && !session ? (
          <p className="form-error">
            This reset link is invalid or expired.{" "}
            <Link to="/forgot-password">Request a new link.</Link>
          </p>
        ) : (
          <form onSubmit={handleSubmit(submit)} noValidate>
            {reset ? (
              <>
                <label htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  {...register("password")}
                />
                <small className="field-error">
                  {errors.password?.message}
                </small>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  {...register("confirm")}
                />
                <small className="field-error">{errors.confirm?.message}</small>
              </>
            ) : (
              <>
                <label htmlFor="reset-email">Email address</label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  {...register("email")}
                />
                <small className="field-error">{errors.email?.message}</small>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button
              className="signin-button"
              disabled={isSubmitting || loading || !supabase}
            >
              {isSubmitting
                ? "Please wait…"
                : reset
                  ? "Update password"
                  : "Send reset link"}
            </Button>
            {!supabase && (
              <p className="form-error">
                Connect Supabase before requesting a password reset.
              </p>
            )}
          </form>
        )}
        <Link className="back-link" to="/login">
          ← Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
