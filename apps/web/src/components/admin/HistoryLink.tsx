import { Link } from "react-router-dom";
import { Button } from "../ui/button.js";

/**
 * The "History" link every Model, Backend, user and the Site settings
 * page carries (issue #200): opens the Audit page filtered to that
 * target.
 */
export function HistoryLink({
  targetType,
  targetId,
}: {
  targetType: string;
  targetId: string;
}) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link
        to={`/admin/audit?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`}
      >
        History
      </Link>
    </Button>
  );
}
