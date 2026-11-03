import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check, ChevronRight, UserPlus } from "lucide-react";
import {
  studentSchema,
  registrationSteps,
  validatePhoto,
} from "../../lib/studentValidation";
import {
  getInventory,
  registerStudent,
  uploadAvatar,
} from "../../services/students";
import { useQuery } from "../../hooks/useQuery";
import {
  PageHeader,
  ErrorState,
  LoadingSkeleton,
} from "../../components/common/Feedback";
import { AllocationPicker } from "../../components/common/AllocationPicker";
import {
  StudentFields,
  fieldLabels,
} from "../../components/common/StudentFields";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { Button } from "../../components/ui/Button";
import { CredentialsGmailDraft } from "../../components/common/CredentialsGmailDraft";
export default function StudentRegistration() {
  const navigate = useNavigate();
  const inventory = useQuery(getInventory);
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const {
    register,
    trigger,
    getValues,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      guardian_email: "",
      guardian_address: "",
      current_address: "",
      admission_note: "",
      gender: "",
      semester: 1,
      bed_id: "",
      admission_date: new Date().toISOString().slice(0, 10),
      allocation_start_date: new Date().toISOString().slice(0, 10),
    },
  });
  const bedId = watch("bed_id");
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const next = async () => {
    if (await trigger(registrationSteps[step].fields)) setStep(step + 1);
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await registerStudent(
        requestId,
        studentSchema.parse(getValues()),
      );
      setCreated(result.student_id);
      setCredentials(result);
      if (photo) {
        try {
          await uploadAvatar({ id: result.student_id }, photo);
        } catch (e) {
          setError(
            `Student registration succeeded, but photo upload failed: ${e.message}. Retry the photo on the student profile.`,
          );
          setConfirm(false);
          return;
        }
      }
      toast.success("Student registered. Copy the temporary password now.");
    } catch (e) {
      setError(e.message);
      if (e.student_id) setCreated(e.student_id);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="STUDENT ADMISSIONS"
        title="A new chapter starts here"
        description="Create a student profile and reserve a bed. A unique hostel ID and temporary password are generated; the student signs in with their email and changes the password on first use. No email is sent."
      >
        <Link className="button button-outline" to="/admin/students">
          Back to directory
        </Link>
      </PageHeader>
      <div className="registration-layout">
        <aside className="panel step-list">
          {registrationSteps.map((s, i) => (
            <div
              key={s.title}
              className={`step ${i === step ? "current" : ""}`}
              aria-current={i === step ? "step" : undefined}
            >
              <span>{i < step ? <Check size={16} /> : i + 1}</span>
              <div>
                <small>STEP {i + 1}</small>
                <strong>{s.title}</strong>
              </div>
            </div>
          ))}
          <p>
            Required fields are marked *. Your data is saved only when you
            submit.
          </p>
        </aside>
        <section className="panel phase-panel">
          <div className="section-heading">
            <h2>{registrationSteps[step].title}</h2>
            <UserPlus size={22} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (step < 5) void next();
              else
                void trigger().then((valid) => {
                  if (valid) setConfirm(true);
                  else
                    setError(
                      "Some fields need attention. Go back and review the form.",
                    );
                });
            }}
            noValidate
          >
            {step < 4 && (
              <StudentFields
                fields={registrationSteps[step].fields}
                register={register}
                errors={errors}
                disabled={busy || !!created}
              />
            )}
            {step === 0 && (
              <label className="photo-upload">
                Profile photo (optional)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy || !!created}
                  onChange={(e) => {
                    try {
                      validatePhoto(e.target.files[0]);
                      setPhoto(e.target.files[0] || null);
                      setError("");
                    } catch (err) {
                      setError(err.message);
                      e.target.value = "";
                    }
                  }}
                />
                <small>JPEG, PNG or WebP · maximum 5 MB</small>
                {photo && preview && (
                  <img
                    className="photo-preview"
                    src={preview}
                    alt="Student photo preview"
                  />
                )}
              </label>
            )}
            {step === 4 &&
              (inventory.loading ? (
                <LoadingSkeleton />
              ) : inventory.error ? (
                <ErrorState onRetry={inventory.reload} />
              ) : (
                <>
                  <AllocationPicker
                    inventory={inventory.data}
                    value={bedId}
                    onChange={(v) =>
                      setValue("bed_id", v, { shouldValidate: true })
                    }
                  />
                  <StudentFields
                    fields={[
                      "admission_date",
                      "allocation_start_date",
                      "admission_note",
                    ]}
                    register={register}
                    errors={errors}
                    disabled={busy || !!created}
                  />
                  <small className="field-error">
                    {errors.bed_id?.message}
                  </small>
                  <p>
                    Availability is checked again on the server before the
                    allocation is committed.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={inventory.reload}
                  >
                    Refresh available beds
                  </Button>
                </>
              ))}
            {step === 5 && (
              <>
                <div className="review-grid">
                  {Object.entries(getValues())
                    .filter(([key]) => key !== "bed_id")
                    .map(([key, value]) => (
                      <div key={key}>
                        <small>{fieldLabels[key]}</small>
                        <strong>{value || "—"}</strong>
                      </div>
                    ))}
                </div>
                <p>
                  Selected bed:{" "}
                  {(() => {
                    const b = inventory.data?.beds.find((b) => b.id === bedId);
                    const r = inventory.data?.rooms.find(
                      (r) => r.id === b?.room_id,
                    );
                    const h = inventory.data?.hostels.find(
                      (h) => h.id === r?.hostel_id,
                    );
                    return `${h?.name || ""} · ${h?.block || ""} · Room ${r?.room_number || ""} · Bed ${b?.bed_number || ""}`;
                  })()}
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {created && !credentials && (
              <Link className="text-link" to={`/admin/students/${created}`}>
                Open saved student profile
              </Link>
            )}
            <div className="form-actions">
              <Button
                type="button"
                variant="outline"
                disabled={step === 0 || busy || !!created}
                onClick={() => setStep(step - 1)}
              >
                Back
              </Button>
              <span>{step + 1} of 6</span>
              <Button disabled={busy || !!created}>
                {step === 5 ? "Review & confirm" : "Continue"}
                <ChevronRight size={15} />
              </Button>
            </div>
          </form>
        </section>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        busy={busy}
        onConfirm={submit}
        title="Register this student?"
        description="This creates the student account and reserves the selected bed. The account will be marked email-confirmed by the administrator so the student can sign in immediately. No invitation email is sent. Verify the email address carefully; the temporary password is displayed once and the student must change it after first sign-in."
        confirmLabel="Register and show credentials"
      />
      {credentials && (
        <div className="dialog-overlay" role="presentation">
          <section
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-credentials-title"
          >
            <h2 id="student-credentials-title">Student registered</h2>
            <p>
              Copy these credentials and give them to the student through a
              secure channel. This password is shown only in this screen
              session.
            </p>
            <dl className="review-grid">
              <div>
                <small>Hostel ID</small>
                <strong>{credentials.student_id}</strong>
              </div>
              <div>
                <small>Email sign-in</small>
                <strong>{credentials.login_id}</strong>
              </div>
              <div>
                <small>Temporary password</small>
                <strong>
                  <code>{credentials.temporary_password}</code>
                </strong>
              </div>
            </dl>
            <p>
              The student will be required to set a new password after signing
              in. No email is sent until you review and send the Gmail draft.
            </p>
            <div className="form-actions">
              <CredentialsGmailDraft credentials={credentials} />
              <Link
                className="button button-outline"
                to={`/admin/students/${credentials.student_id}`}
              >
                Open student profile
              </Link>
              <Button
                onClick={() => {
                  setCredentials(null);
                  navigate(`/admin/students/${created}`);
                }}
              >
                Done
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
