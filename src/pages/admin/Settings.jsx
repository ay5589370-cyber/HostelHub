import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ShieldCheck, SunMoon, Save } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { updateProfile } from "../../services/profiles";
import {
  PageHeader,
  ThemeToggle,
  UserAvatar,
} from "../../components/common/Feedback";
import { Button } from "../../components/ui/Button";
const schema = z.object({
  full_name: z.string().trim().min(2, "Enter at least 2 characters.").max(100),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine(
      (s) => !s || /^[+\d\s()-]{6,30}$/.test(s),
      "Enter a valid phone number.",
    ),
});
export default function Settings() {
  const { profile, refreshProfile } = useAuth();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: profile.full_name || "",
      phone: profile.phone || "",
    },
  });
  const submit = async (values) => {
    setError("");
    try {
      await updateProfile(profile.id, values);
      toast.success("Profile updated");
      await refreshProfile();
    } catch {
      setError("Unable to save your profile. Please try again.");
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="MAKE IT YOURS"
        title="Settings"
        description="Your profile, preferences, and account essentials."
      />
      <div className="settings-grid">
        <section className="panel settings-panel">
          <h2>Personal information</h2>
          <p>Keep your campus profile up to date.</p>
          <div className="profile-summary">
            <UserAvatar name={profile.full_name || "Admin"} />
            <div>
              <strong>{profile.full_name || "Administrator"}</strong>
              <span className="badge">ADMIN</span>
            </div>
          </div>
          <form onSubmit={handleSubmit(submit)} noValidate>
            <label htmlFor="full-name">Full name</label>
            <input
              id="full-name"
              {...register("full_name")}
              autoComplete="name"
            />
            <small className="field-error">{errors.full_name?.message}</small>
            <label htmlFor="profile-email">Email address</label>
            <input id="profile-email" value={profile.email || ""} disabled />
            <small className="hint">
              Email and role changes are managed by your institution.
            </small>
            <label htmlFor="phone">Phone number</label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              {...register("phone")}
              placeholder="Add a contact number"
            />
            <small className="field-error">{errors.phone?.message}</small>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button disabled={isSubmitting}>
              <Save size={16} />
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </section>
        <div className="settings-aside">
          <section className="panel settings-panel">
            <SunMoon className="accent" />
            <h2>Appearance</h2>
            <p>Choose the workspace theme that feels right for you.</p>
            <div className="preference-row">
              <span>Light / dark theme</span>
              <ThemeToggle />
            </div>
          </section>
          <section className="panel settings-panel">
            <ShieldCheck className="accent" />
            <h2>Account security</h2>
            <p>
              Your account uses Supabase authentication. Roles and access are
              managed through trusted administration.
            </p>
            <a className="text-link" href="/forgot-password">
              Request a password reset →
            </a>
          </section>
        </div>
      </div>
    </>
  );
}
