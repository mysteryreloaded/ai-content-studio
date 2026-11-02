import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { zodResolver } from "../lib/form.js";
import { NotificationsSwitch } from "../notifications/NotificationsSwitch.js";
import type { DeleteAccountResult } from "../useSession.js";
import { useSession } from "../useSession.js";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

const MISMATCH_ERROR = "That email doesn't match your account.";
const DELETE_ERROR = "Could not delete this account.";

/** "Delete my account" (issue #63, restyled #174): a react-hook-form +
 *  `zodResolver` form, and a confirming `Dialog` before the delete runs. */
function DeleteAccount({
  email,
  deleteAccount,
  onDeleted,
}: {
  email: string;
  deleteAccount: (email: string) => Promise<DeleteAccountResult>;
  onDeleted: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<{ email: string }>({
    resolver: zodResolver(
      z.object({
        email: z
          .string()
          .email("Enter a valid email address.")
          .refine((value) => value.trim() === email, {
            message: MISMATCH_ERROR,
          }),
      }),
    ),
  });

  const typedEmail = watch("email") ?? "";

  // The server's `email_mismatch` 400 maps onto the field; anything else
  // (forbidden, unknown) stays the page-level error, as before.
  const { isPending, mutate } = useMutation({
    mutationFn: (email: string) => deleteAccount(email),
    onSuccess: (result) => {
      if (result.ok) {
        onDeleted();
        return;
      }
      if (result.error === "email_mismatch") {
        setError("email", { message: MISMATCH_ERROR });
        return;
      }
      setGeneralError(DELETE_ERROR);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete my account</CardTitle>
        <CardDescription>
          This deletes your profile, files, prompts and settings. It can't be
          undone, and signing in again with the same Google account starts
          fresh.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-3"
          onSubmit={handleSubmit(() => {
            setGeneralError(null);
            setConfirmOpen(true);
          })}
        >
          <div className="space-y-1.5">
            <Label htmlFor="delete-account-email">
              Type your email ({email}) to confirm
            </Label>
            <Input
              id="delete-account-email"
              type="email"
              aria-invalid={errors.email ? true : undefined}
              {...register("email", {
                onChange: (event) => {
                  if (event.target.value.trim() && (errors.email || generalError)) {
                    clearErrors("email");
                    setGeneralError(null);
                  }
                },
              })}
            />
            {errors.email && (
              <p role="alert" className="text-err">
                {errors.email.message}
              </p>
            )}
          </div>
          {generalError && (
            <p role="alert" className="text-err">
              {generalError}
            </p>
          )}
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Button
              variant="danger"
              type="submit"
              disabled={isPending || typedEmail.trim().length === 0}
            >
              Delete my account
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete my account?</DialogTitle>
                <DialogDescription>
                  This deletes your profile, files, prompts and settings. It
                  can't be undone, and signing in again with the same Google
                  account starts fresh.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={isPending}
                  onClick={() => mutate(typedEmail)}
                >
                  {isPending ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </form>
      </CardContent>
    </Card>
  );
}

export function AccountPage() {
  const { session, signOut, deleteAccount } = useSession();
  const [pictureFailed, setPictureFailed] = useState(false);
  const [deleted, setDeleted] = useState(false);

  if (session.status === "loading") return null;
  if (deleted || session.status === "signed-out") {
    return <Navigate to="/" replace />;
  }

  const { user } = session;

  return (
    <main className="mx-auto w-full max-w-md space-y-4">
      <h1>Account</h1>
      <Card>
        <CardHeader>
          {user.picture && !pictureFailed ? (
            <img
              src={user.picture}
              alt=""
              width={64}
              height={64}
              referrerPolicy="no-referrer"
              onError={() => setPictureFailed(true)}
              className="size-16 rounded-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-16 items-center justify-center rounded-full bg-muted font-heading text-base font-semibold text-muted-foreground"
            >
              {initials(user.name)}
            </div>
          )}
          <CardTitle>{user.name}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationsSwitch />
        </CardContent>
        <CardFooter>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardFooter>
      </Card>
      {user.role !== "admin" && (
        <DeleteAccount
          email={user.email}
          deleteAccount={deleteAccount}
          onDeleted={() => setDeleted(true)}
        />
      )}
    </main>
  );
}
