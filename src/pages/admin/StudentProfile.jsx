import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Crop, ImagePlus, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useAuth } from "../../contexts/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import {
  studentSchema,
  phoneSchema,
  registrationSteps,
  validatePhoto,
} from "../../lib/studentValidation";
import {
  getStudent,
  getInventory,
  activeAllocation,
  manage,
  registerStudent,
  uploadAvatar,
  updatePhone,
} from "../../services/students";
import {
  PageHeader,
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "../../components/common/Feedback";
import { StudentAvatar } from "../../components/common/StudentAvatar";
import {
  StudentFields,
  fieldLabels,
} from "../../components/common/StudentFields";
import { AllocationPicker } from "../../components/common/AllocationPicker";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { Button } from "../../components/ui/Button";
import { CredentialsGmailDraft } from "../../components/common/CredentialsGmailDraft";

function AvatarCropDialog({ file, onCancel, onApply }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [horizontal, setHorizontal] = useState(50);
  const [vertical, setVertical] = useState(50);
  const [imageSize, setImageSize] = useState(null);
  const [previewSize, setPreviewSize] = useState(260);
  const [processing, setProcessing] = useState(false);
  const dragStart = useRef(null);
  const previewRef = useRef(null);
  const cropScale = 1.5;

  useEffect(() => {
    if (!previewRef.current) return undefined;
    const element = previewRef.current;
    const updateSize = () => setPreviewSize(element.clientWidth);
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const cropAndApply = async () => {
    if (!previewUrl) return;
    setProcessing(true);
    try {
      const image = new Image();
      image.src = previewUrl;
      await image.decode();
      const side = Math.min(image.naturalWidth, image.naturalHeight) / cropScale;
      const sourceX = (image.naturalWidth - side) * (horizontal / 100);
      const sourceY = (image.naturalHeight - side) * (vertical / 100);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare the cropped photo.");
      context.drawImage(image, sourceX, sourceY, side, side, 0, 0, 512, 512);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, file.type, 0.9),
      );
      if (!blob) throw new Error("Could not create the cropped photo.");
      const cropped = new File([blob], file.name, {
        type: blob.type || file.type,
        lastModified: Date.now(),
      });
      await onApply(cropped);
    } catch (error) {
      // The caller displays any upload errors; decode/canvas errors are shown here.
      if (error instanceof Error) toast.error(error.message);
    } finally {
      setProcessing(false);
    }
  };

  const startDrag = (event) => {
    if (processing) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const overflowX = Math.max(1, previewImageWidth - event.currentTarget.clientWidth);
    const overflowY = Math.max(1, previewImageHeight - event.currentTarget.clientHeight);
    dragStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      horizontal,
      vertical,
      overflowX,
      overflowY,
    };
  };
  const moveDrag = (event) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const clamp = (value) => Math.max(0, Math.min(100, value));
    setHorizontal(clamp(start.horizontal - ((event.clientX - start.x) / start.overflowX) * 100));
    setVertical(clamp(start.vertical - ((event.clientY - start.y) / start.overflowY) * 100));
  };
  const aspectRatio = imageSize ? imageSize.width / imageSize.height : 1;
  const previewImageWidth = imageSize
    ? Math.max(previewSize, previewSize * aspectRatio) * cropScale
    : previewSize * cropScale;
  const previewImageHeight = imageSize
    ? Math.max(previewSize, previewSize / aspectRatio) * cropScale
    : previewSize * cropScale;
  const imageLeft = -Math.max(0, previewImageWidth - previewSize) * horizontal / 100;
  const imageTop = -Math.max(0, previewImageHeight - previewSize) * vertical / 100;

  return (
    <div className="avatar-crop-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !processing) onCancel();
    }}>
      <section className="avatar-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title">
        <header className="avatar-crop-header">
          <div>
            <span className="eyebrow">PROFILE PHOTO</span>
            <h2 id="avatar-crop-title">Adjust your photo</h2>
          </div>
          <button className="avatar-crop-close" type="button" onClick={onCancel} disabled={processing} aria-label="Close crop editor">
            <X size={19} />
          </button>
        </header>
        <p className="avatar-crop-description">Drag the photo to position it inside the circle. The saved image uses the area shown here.</p>
        <div
          ref={previewRef}
          className="avatar-crop-preview-wrap"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => { dragStart.current = null; }}
          onPointerCancel={() => { dragStart.current = null; }}
          role="img"
          aria-label="Drag the photo to adjust the crop"
        >
          {previewUrl && (
            <img
              className="avatar-crop-preview"
              src={previewUrl}
              alt="Profile photo crop preview"
              draggable="false"
              onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              style={{ width: previewImageWidth, height: previewImageHeight, left: imageLeft, top: imageTop }}
            />
          )}
        </div>
        <footer className="avatar-crop-actions">
          <Button type="button" variant="outline" disabled={processing} onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={processing || !previewUrl} onClick={cropAndApply}>
            <Crop size={16} /> {processing ? "Saving photo…" : "Crop and save"}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function EditStudent({ student, onSaved, onCancel }) {
  const guardian = student.guardians.find((g) => g.is_primary) || {};
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(
      studentSchema.omit({ bed_id: true, email: true, student_id: true }),
    ),
    defaultValues: {
      ...student,
      guardian_name: guardian.full_name,
      relationship: guardian.relationship,
      guardian_phone: guardian.phone,
      guardian_email: guardian.email || "",
      emergency_contact: guardian.emergency_contact,
    },
  });
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        try {
          await manage("edit", { ...values, id: student.id });
          toast.success("Student updated");
          onSaved();
        } catch (e) {
          setError(e.message);
        }
      })}
      noValidate
    >
      <h2>Edit student</h2>
      <p>Account email and student ID are fixed after registration.</p>
      <StudentFields
        fields={registrationSteps
          .slice(0, 4)
          .flatMap((s) => s.fields)
          .filter((f) => !["email", "student_id"].includes(f))}
        register={register}
        errors={errors}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
function Transfer({ student, onSaved }) {
  const inventory = useQuery(getInventory);
  const [bed, setBed] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel phase-panel">
      <h2>Change room allocation</h2>
      <p>The current bed is released only if the new allocation succeeds.</p>
      {inventory.loading ? (
        <LoadingSkeleton />
      ) : inventory.error ? (
        <ErrorState onRetry={inventory.reload} />
      ) : (
        <AllocationPicker
          inventory={inventory.data}
          value={bed}
          onChange={setBed}
        />
      )}
      {error && <p className="form-error">{error}</p>}
      <Button disabled={!bed || busy} onClick={() => setConfirm(true)}>
        Transfer student
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        busy={busy}
        title="Confirm bed transfer?"
        description="The student will move to the selected bed. Their previous assignment remains in allocation history."
        confirmLabel="Transfer"
        onConfirm={async () => {
          setBusy(true);
          try {
            await manage("transfer", { id: student.id, bed_id: bed });
            toast.success("Allocation updated");
            setConfirm(false);
            setBed("");
            inventory.reload();
            onSaved();
          } catch (e) {
            setError(e.message);
            setConfirm(false);
            inventory.reload();
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}
export default function StudentProfile({ self = false, compact = false }) {
  const { id } = useParams();
  const { session } = useAuth();
  const fetcher = useCallback(
    () => getStudent(self ? null : id, session?.user.id),
    [id, self, session?.user.id],
  );
  const result = useQuery(fetcher);
  const [edit, setEdit] = useState(false);
  const [action, setAction] = useState(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [error, setError] = useState("");
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await result.reload();
      toast.success("Changes saved");
      return true;
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
      return false;
    } finally {
      setBusy(false);
      setAction(null);
    }
  };
  if (result.loading) return <LoadingSkeleton />;
  if (result.error)
    return (
      <ErrorState message={result.error.message} onRetry={result.reload} />
    );
  const s = result.data;
  if (!s)
    return (
      <EmptyState
        title="Student profile unavailable"
        description="Contact your hostel administrator to complete your registration."
      />
    );
  const allocation = activeAllocation(s),
    bed = allocation?.beds,
    room = bed?.rooms,
    hostel = room?.hostels;
  return (
    <>
      <PageHeader
        eyebrow={self ? "YOUR CAMPUS HOME" : "STUDENT PROFILE"}
        title={compact ? `Welcome, ${s.full_name.split(" ")[0]}` : s.full_name}
        description={`${s.student_id} · ${s.course} · Semester ${s.semester}`}
      >
        <div className="inline-actions">
          {!self && (
            <Link className="button button-outline" to="/admin/students">
              Directory
            </Link>
          )}
          <StudentAvatar student={s} />
          <span className={`status-pill ${s.status}`}>{s.status}</span>
        </div>
      </PageHeader>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="welcome-banner">
        <div>
          <span className="badge">YOUR ALLOCATION</span>
          <h2>
            {hostel
              ? `${hostel.name} · ${hostel.block}`
              : "Not currently allocated"}
          </h2>
          <p>
            {room
              ? `Floor ${room.floor_number} · Room ${room.room_number} · Bed ${bed.bed_number}`
              : "An administrator can assign an available bed."}
          </p>
        </div>
      </section>
      {!self && (
        <div className="inline-actions profile-actions">
          <Button onClick={() => setEdit(!edit)}>Edit student</Button>
          <Button
            variant="outline"
            disabled={busy || s.status !== "active" || !s.invitation}
            onClick={() => setResetConfirm(true)}
          >
            Issue temporary password
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              setAction(s.status === "archived" ? "active" : "archived")
            }
          >
            {s.status === "archived" ? "Restore student" : "Archive student"}
          </Button>
        </div>
      )}
      <section className="panel phase-panel">
        {edit ? (
          <EditStudent
            student={s}
            onSaved={() => {
              setEdit(false);
              result.reload();
            }}
            onCancel={() => setEdit(false)}
          />
        ) : (
          <>
            <h2>{compact ? "Your details" : "Personal & academic details"}</h2>
            <div className="review-grid">
              {(compact
                ? ["student_id", "course", "semester", "email", "phone"]
                : [
                    "full_name",
                    "student_id",
                    "date_of_birth",
                    "gender",
                    "email",
                    "phone",
                    "course",
                    "branch",
                    "academic_year",
                    "semester",
                    "permanent_address",
                    "current_address",
                    "city",
                    "state",
                    "pincode",
                    "admission_date",
                    "admission_note",
                  ]
              ).map((key) => (
                <div key={key}>
                  <small>{fieldLabels[key] || "Admission date"}</small>
                  <strong>{s[key] || "—"}</strong>
                </div>
              ))}
            </div>
            {!self && (
              <p>
                Invitation:{" "}
                <strong>
                  {s.invitation?.invitation_status || "No invitation"}
                </strong>
                {s.invitation?.last_error && (
                  <span className="field-error">
                    {" "}
                    · {s.invitation.last_error}
                  </span>
                )}
              </p>
            )}
            <h2>Guardian contact</h2>
            {s.guardians.map((g) => (
              <div className="guardian-card" key={g.id}>
                <strong>
                  {g.full_name} · {g.relationship}
                </strong>
                <p>
                  {g.phone}
                  {!compact && g.email ? ` · ${g.email}` : ""}
                </p>
                <small>Emergency: {g.emergency_contact}</small>
                {!compact && (
                  <small>
                    {g.emergency_contact_name
                      ? ` · ${g.emergency_contact_name}`
                      : ""}
                    {g.address ? ` · ${g.address}` : ""}
                  </small>
                )}
              </div>
            ))}
          </>
        )}
      </section>
      {!compact && (
        <section className={`panel phase-panel ${self ? "profile-self-panel" : ""}`}>
          <h2>{self ? "Update your contact details" : "Profile photo"}</h2>
          {self && (
            <form
              className="profile-contact-form"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = phoneSchema.safeParse(
                  new FormData(e.currentTarget).get("phone"),
                );
                if (!parsed.success) {
                  setError(parsed.error.issues[0].message);
                  return;
                }
                void run(() => updatePhone(s.id, parsed.data));
              }}
            >
              <label>
                Phone number
                <input
                  name="phone"
                  defaultValue={s.phone}
                  type="tel"
                  required
                />
              </label>
              <Button className="profile-save-button" disabled={busy}>Save phone</Button>
            </form>
          )}
          <div className="profile-photo-layout">
            <StudentAvatar student={s} />
            <div className="profile-photo-copy">
              <strong>Profile picture</strong>
              <p>Choose a photo and crop it before saving. Use a clear, square image for the best fit.</p>
              <label className="button button-outline profile-photo-picker">
                <ImagePlus size={16} /> Choose photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) {
                      try {
                        validatePhoto(file);
                        setCropFile(file);
                      } catch (error) {
                        toast.error(error.message);
                      }
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              <small>JPEG, PNG or WebP · maximum 5 MB</small>
            </div>
          </div>
        </section>
      )}
      {!self && s.status === "active" && (
        <Transfer student={s} onSaved={result.reload} />
      )}
      {!compact && (
        <section className="panel phase-panel">
          <h2>Allocation history</h2>
          {s.bed_allocations?.length ? (
            <div className="table-scroll">
              <table className="student-table">
                <thead>
                  <tr>
                    <th>Hostel / room / bed</th>
                    <th>Start date</th>
                    <th>End date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...s.bed_allocations]
                    .sort(
                      (a, b) =>
                        new Date(b.allocated_at) - new Date(a.allocated_at),
                    )
                    .map((a) => (
                      <tr key={a.id}>
                        <td>
                          {a.beds?.rooms?.hostels?.name || "—"} ·{" "}
                          {a.beds?.rooms?.room_number || "—"} ·{" "}
                          {a.beds?.bed_number || "—"}
                        </td>
                        <td>
                          {a.starts_on ||
                            new Date(a.allocated_at).toLocaleDateString(
                              "en-IN",
                            )}
                        </td>
                        <td>
                          {a.vacated_at
                            ? new Date(a.vacated_at).toLocaleDateString("en-IN")
                            : "—"}
                        </td>
                        <td>{a.status}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No allocation history.</p>
          )}
        </section>
      )}
      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onApply={async (file) => {
            const saved = await run(() => uploadAvatar(s, file));
            if (saved) setCropFile(null);
          }}
        />
      )}
      <ConfirmDialog
        open={resetConfirm}
        onOpenChange={setResetConfirm}
        busy={busy}
        title="Reset this student’s password?"
        description="This replaces the student’s current password immediately and requires a new password at next sign-in. You can open a Gmail draft with the generated credentials; no email is sent automatically."
        confirmLabel="Reset and show password"
        onConfirm={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await registerStudent(
              s.invitation.id,
              null,
              "reset_temporary_password",
            );
            setCredentials(result);
            setResetConfirm(false);
            toast.success("Temporary password generated");
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {credentials && (
        <div className="dialog-overlay" role="presentation">
          <section
            className="dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-credentials-title"
          >
            <h2 id="reset-credentials-title">Temporary password generated</h2>
            <p>
              Share this password with the student securely. It is visible only
              until this profile is closed. Review the Gmail draft before
              sending it.
            </p>
            <dl className="review-grid">
              <div>
                <small>Hostel ID</small>
                <strong>{s.student_id}</strong>
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
            <CredentialsGmailDraft credentials={credentials} />
            <Button onClick={() => setCredentials(null)}>Done</Button>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={!!action}
        onOpenChange={(v) => {
          if (!v) setAction(null);
        }}
        busy={busy}
        title={action === "archived" ? "Archive student?" : "Restore student?"}
        description={
          action === "archived"
            ? "This disables account access and releases the current bed. Records and allocation history are retained."
            : "This restores account access. Assign a new available bed after restoring."
        }
        confirmLabel={action === "archived" ? "Archive" : "Restore"}
        onConfirm={() =>
          run(() => manage("status", { id: s.id, status: action }))
        }
      />
    </>
  );
}
