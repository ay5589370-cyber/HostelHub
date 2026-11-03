import { Mail } from "lucide-react";

export function CredentialsGmailDraft({ credentials }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const subject = "HostelHub sign-in details - " + credentials.student_id;
  const body = [
    "Hello,",
    "",
    "Your HostelHub student account is ready.",
    "Sign-in page: " + origin,
    "Email sign-in: " + credentials.login_id,
    "Hostel ID: " + credentials.student_id,
    "Temporary password: " + credentials.temporary_password,
    "",
    "Sign in using your email address, not your Hostel ID. You will be asked to set a new permanent password after signing in.",
    "",
    "Please keep your account details private.",
  ].join("\n");
  const composeUrl = new URL("https://mail.google.com/mail/");
  composeUrl.search = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: credentials.login_id,
    su: subject,
    body,
  }).toString();

  return (
    <div className="credentials-email-draft">
      <a
        className="button button-outline"
        href={composeUrl.toString()}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Mail size={16} />
        Open Gmail draft
      </a>
      <small className="credentials-email-draft-note">
        Gmail opens a draft with these details; review it and send it yourself.
      </small>
    </div>
  );
}
