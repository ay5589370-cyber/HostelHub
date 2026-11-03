import * as Dialog from "@radix-ui/react-alert-dialog";
import { Button } from "../ui/Button";
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  busy,
  confirmLabel = "Sign out",
  confirmVariant,
  confirmDisabled = false,
  children,
}) {
  const isDestructive =
    confirmVariant === "danger" ||
    (!confirmVariant &&
      /delete|reject|cancel|remove|revoke|archive|sign out/i.test(confirmLabel));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>{title}</Dialog.Title>
          {description && <Dialog.Description>{description}</Dialog.Description>}
          {children}
          <div className="dialog-actions">
            <Dialog.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            </Dialog.Cancel>
            <Button
              variant={isDestructive ? "danger" : "default"}
              disabled={busy || confirmDisabled}
              onClick={onConfirm}
            >
              {busy ? "Please wait…" : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
