import type { SignUpMode } from "@ai-content-studio/shared";

export interface PrivacyGeneratedConfig {
  signUpMode: SignUpMode;
  contact: string;
  appVersion: string;
  /** Issue #69's retention sweep: blank (`null`) keeps every Asset forever. */
  assetRetentionDays: number | null;
}

/**
 * "What this studio stores" (issue #25/#65): the English, studio-written
 * half of `/privacy` that no Admin can edit, rendered fresh from live
 * configuration on every request so it stays true as the app changes.
 * Bracketed parts in the decision ("[when on]") become `if` branches
 * here rather than conditional Markdown, since a feature not yet built
 * (Caps, blocked words, C2PA signing, Removal) must not be claimed.
 */
export function buildGeneratedPrivacySection(
  config: PrivacyGeneratedConfig,
): string {
  const sections = [
    "## What this studio stores",
    "",
    "### Signing in with Google",
    "",
    "This studio asks Google only for your account id, email, name and picture (the `openid email profile` scopes), and refreshes them each time you sign in. Google's own sign-in tokens are discarded right after sign-in. This data is used only to sign you in and show who you are, and is never sold or shared. Your picture loads from Google's own servers.",
    "",
    "### Your account",
    "",
    "The studio keeps your role, status, when your account was created, and the Site terms version and date you accepted (and, for each Model that asks, its own Model terms).",
    "",
    "### Cookies and local storage",
    "",
    "The only cookie is one session cookie, renewed while you use the studio, plus a short-lived one during sign-in itself. There are no analytics, ads, trackers or third-party scripts. This browser also remembers your light/dark choice and dismissed Notices in local storage; neither is sent to the studio.",
    "",
    "### What you create",
    "",
    `Your Uploads, Assets, prompts and settings are stored on this studio's own server. They are sent to the Operator's GPU machines to run your Generations, and the copies made there are removed soon after. An Upload no Generation uses is removed 24 hours after it was last used. ${
      config.assetRetentionDays !== null
        ? `Assets are removed after ${config.assetRetentionDays} days.`
        : "Assets are kept until you delete them."
    }`,
    "",
    "### Who sees it",
    "",
    "Only you, and Admins read-only, for support and to act on reports. There are no public links to anything you make.",
    "",
    "### Checks and logs",
    "",
    "The studio keeps no IP addresses except an Admin's own, recorded when they act as an Admin.",
    "",
    "### Admin records",
    "",
    "Admin actions (approving, promoting, disabling and the like) are recorded permanently and name the acting Admin, with their IP address and browser. A user who is not an Admin appears in these records without their name or email.",
    "",
  ];

  if (config.signUpMode === "approval") {
    sections.push(
      "### Approval",
      "",
      "New accounts wait for an Admin's approval before they can use the studio. No emails are sent while you wait.",
      "",
    );
  }

  const questionsLine =
    config.contact !== ""
      ? `Questions about this policy: [contact the Operator](${
          config.contact.startsWith("http")
            ? config.contact
            : `mailto:${config.contact}`
        }), or read [the studio's source code](https://github.com/mysteryreloaded/ai-content-studio).`
      : "Questions about this policy: read [the studio's source code](https://github.com/mysteryreloaded/ai-content-studio).";

  sections.push(
    "### Questions",
    "",
    questionsLine,
    "",
    `Studio version: ${config.appVersion}`,
  );

  return sections.join("\n");
}
