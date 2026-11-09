import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Building2,
  Users,
  LoaderCircle,
  Mail,
  LockKeyhole,
  Sparkles,
  UtensilsCrossed,
  BedDouble,
  Wifi,
} from "lucide-react";
import { supabase, setupError } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { homeFor } from "../../utils/access";
import {
  Logo,
  ThemeToggle,
  ErrorState,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
export function AuthLayout({ children }) {
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Logo />
        <div className="auth-story-body">
          <div className="auth-story-hero">
            <span className="eyebrow">ALL-IN-ONE CAMPUS RESIDENCE</span>
            <h1>
              A smarter hostel.
              <br />A happier <em>campus.</em>
            </h1>
            <p>
              Complete student living: modern rooms, dining hall, smart security, and study hubs.
            </p>
          </div>
          <div className="auth-facility-showcase">
            <div className="auth-campus-visual is-vertical is-left" aria-hidden="true">
              <div className="auth-campus-visual-inner">
                <img
                  src="/images/hostel-facilities-vertical.jpg"
                  alt="HostelHub complete hostel facilities showing student residence, dining hall, smart gate security, and study rooms"
                  className="auth-campus-img"
                />
                <div className="auth-campus-overlay">
                  <span className="auth-campus-pill">
                    <Sparkles size={11} /> All Facilities Included
                  </span>
                  <span className="auth-campus-tagline">
                    Rooms · Dining · Smart Gate · Study Hub
                  </span>
                </div>
              </div>
              <div className="art-label label-one">
                <UtensilsCrossed size={12} /> Mess & Dining
              </div>
              <div className="art-label label-two">
                <ShieldCheck size={12} /> Smart Security
              </div>
            </div>
            <div className="feature-highlights vertical-stack">
              <div className="facility-pill">
                <BedDouble size={16} />
                <div>
                  <strong>Modern Rooms</strong>
                  <small>Comfortable living & study desks</small>
                </div>
              </div>
              <div className="facility-pill">
                <UtensilsCrossed size={16} />
                <div>
                  <strong>Dining & Mess</strong>
                  <small>Fresh, nutritious daily meals</small>
                </div>
              </div>
              <div className="facility-pill">
                <ShieldCheck size={16} />
                <div>
                  <strong>24/7 Smart Gate</strong>
                  <small>RFID & biometric security</small>
                </div>
              </div>
              <div className="facility-pill">
                <Wifi size={16} />
                <div>
                  <strong>High-Speed Wi-Fi</strong>
                  <small>Campus-wide connectivity</small>
                </div>
              </div>
            </div>
          </div>
        </div>
        <small className="story-footer">
          Thoughtfully built for better campus living.
        </small>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          <span>HOSTELHUB / AUTHORIZED ACCESS</span>
          <ThemeToggle />
        </div>
        <div className="auth-mobile-banner" aria-hidden="true">
          <img
            src="/images/hostel-facilities-vertical.jpg"
            alt="Hostel campus residence and facilities"
            className="auth-mobile-img"
          />
          <div className="auth-mobile-overlay">
            <span className="auth-mobile-badge">
              <Sparkles size={12} /> Complete Facilities
            </span>
          </div>
        </div>
        {children}
        <footer>
          Authorized access only <span>·</span> Your campus, protected
        </footer>
      </section>
    </main>
  );
}
export default function Login() {
  const location = useLocation();
  const {
    session,
    profile,
    loading,
    error: profileError,
    refreshProfile,
    logout,
  } = useAuth();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });
  const submit = async (values) => {
    setError("");
    try {
      const { error: err } = await supabase.auth.signInWithPassword(values);
      if (err) throw err;
    } catch (err) {
      setError(
        err.status === 429
          ? "Too many attempts. Please wait a moment and try again."
          : "Unable to sign in. Check your email and password, or contact your administrator.",
      );
    }
  };
  if (session && !loading && !profileError) {
    const from = location.state?.from;
    const returnTo = from?.pathname?.startsWith("/") && !from.pathname.startsWith("//")
      ? `${from.pathname}${from.search || ""}${from.hash || ""}`
      : homeFor(profile);
    return <Navigate to={returnTo} replace />;
  }
  return (
    <AuthLayout>
      <div className="auth-form">
        <span className="form-symbol">
          <LockKeyhole size={20} />
        </span>
        <h2>Welcome back</h2>
        <p>
          Sign in with the email address provided by your hostel administrator.
          Your Hostel ID is not your login name.
        </p>
        {setupError && (
          <div className="setup-notice" role="status">
            <strong>Connect your Supabase project</strong>
            <p>{setupError}</p>
            <Link to="/setup">
              View setup steps <ArrowRight size={14} />
            </Link>
          </div>
        )}
        {profileError ? (
          <>
            <ErrorState message={profileError} onRetry={refreshProfile} />
            <Button
              variant="outline"
              onClick={() =>
                logout().catch(() => setError("Could not sign out. Try again."))
              }
            >
              Sign out
            </Button>
          </>
        ) : (
          <form onSubmit={handleSubmit(submit)} noValidate>
            <label htmlFor="email">Email address</label>
            <div className="input-icon">
              <Mail size={16} />
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@university.edu"
                {...register("email")}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
              />
            </div>
            {errors.email && (
              <small id="email-error" className="field-error">
                {errors.email.message}
              </small>
            )}
            <div className="label-row">
              <label htmlFor="password">Password</label>
              <Link to="/forgot-password">Forgot password?</Link>
            </div>
            <div className="input-icon">
              <LockKeyhole size={16} />
              <input
                id="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                {...register("password")}
                aria-invalid={!!errors.password}
                aria-describedby={
                  errors.password ? "password-error" : undefined
                }
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={visible ? "Hide password" : "Show password"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && (
              <small id="password-error" className="field-error">
                {errors.password.message}
              </small>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button
              className="signin-button"
              disabled={!supabase || isSubmitting || loading}
            >
              {isSubmitting || loading ? (
                <>
                  <LoaderCircle className="spin" size={16} />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in to workspace
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>
        )}
        <div className="auth-help">
          <ShieldCheck size={16} />
          <p>
            Accounts are provided by your institution.
            <br />
            Need access? Contact your hostel administrator.
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
