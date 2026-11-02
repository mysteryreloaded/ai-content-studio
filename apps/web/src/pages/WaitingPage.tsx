import { Navigate } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";
import { useSession } from "../useSession.js";
import { useSiteSettings } from "../useSiteSettings.js";

function contactHref(contact: string): string {
  return contact.startsWith("http://") || contact.startsWith("https://")
    ? contact
    : `mailto:${contact}`;
}

/** `/waiting`: shown to a pending user once they've accepted the Site terms (issue #62). */
export function WaitingPage() {
  const { session, signOut } = useSession();
  const settings = useSiteSettings();
  const contact = settings?.contact || null;

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (session.user.status !== "pending") return <Navigate to="/" replace />;

  return (
    <main className="flex justify-center">
      <Card className="w-full max-w-120">
        <CardHeader>
          <CardTitle>Waiting for approval</CardTitle>
          <CardDescription>
            An Admin needs to approve your account before you can use it.
          </CardDescription>
          {contact && (
            <CardDescription>
              Questions or reports:{" "}
              <a
                className="underline hover:text-foreground hover:underline"
                href={contactHref(contact)}
              >
                {contact}
              </a>
            </CardDescription>
          )}
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
