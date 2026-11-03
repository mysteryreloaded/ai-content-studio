// The route list as data (issue #187): the one place later restyle
// tickets add a route. `path` is a template string with `{a.b}`
// placeholders resolved against `seed.json`'s shape (see `shots.ts`).

export type Identity =
  | "signed-out"
  | "alice"
  | "sam"
  | "robin"
  | "pat"
  | "quinn"
  | "dana";

export interface RouteAction {
  /** An ARIA role, as Playwright's `getByRole` understands it. */
  role: string;
  name: string;
}

export interface Route {
  name: string;
  path: string;
  as: Identity;
  actions?: RouteAction[];
  /** A selector to wait for (up to 5s) before capturing. */
  ready?: string;
  widths?: number[];
  fullPage?: boolean;
  /** The prototype view (see `prototype.ts`) this route is compared with. */
  prototype?: string;
}

export const WIDTHS = [360, 1280] as const;

export const routes: Route[] = [
  { name: "landing", path: "/", as: "signed-out", prototype: "home" },
  {
    name: "landing-cancelled",
    path: "/?auth_error=cancelled",
    as: "signed-out",
  },
  { name: "landing-failed", path: "/?auth_error=failed", as: "signed-out" },
  {
    name: "landing-unverified",
    path: "/?auth_error=unverified",
    as: "signed-out",
  },
  { name: "landing-blocked", path: "/?auth_error=blocked", as: "signed-out" },
  {
    name: "landing-disabled",
    path: "/?auth_error=disabled",
    as: "signed-out",
  },
  { name: "terms", path: "/terms", as: "signed-out" },
  { name: "privacy", path: "/privacy", as: "signed-out" },

  {
    name: "terms-gate",
    path: "/models",
    as: "pat",
    ready: "text=Accept",
  },
  {
    name: "waiting",
    path: "/models",
    as: "pat",
    actions: [{ role: "button", name: "Accept" }],
    ready: "text=Sign out",
  },
  { name: "account-pending", path: "/account", as: "pat" },

  { name: "models", path: "/models", as: "sam", prototype: "home" },
  {
    name: "workbench",
    path: "/models/seed-video",
    as: "sam",
    prototype: "workbench",
  },
  {
    name: "workbench-fold",
    path: "/models/seed-video",
    as: "sam",
    widths: [360],
    fullPage: false,
  },
  {
    name: "workbench-mode-menu",
    path: "/models/seed-video",
    as: "sam",
    actions: [{ role: "combobox", name: "Mode" }],
  },
  {
    name: "workbench-one-mode",
    path: "/models/seed-images",
    as: "sam",
    prototype: "workbench-one-mode",
  },
  {
    name: "workbench-first-visit",
    path: "/models/seed-video",
    as: "robin",
    ready: "text=Accept",
    prototype: "first-visit",
  },
  {
    name: "workbench-empty",
    path: "/models/seed-video",
    as: "robin",
    actions: [{ role: "button", name: "Accept" }],
  },

  { name: "gallery", path: "/gallery", as: "sam", prototype: "gallery" },
  { name: "gallery-failed", path: "/gallery?state=failed", as: "sam" },
  {
    name: "gallery-model",
    path: "/gallery?model={model.images.id}",
    as: "sam",
  },
  {
    name: "detail-video",
    path: "/generations/{gen.succeededVideo}",
    as: "sam",
    prototype: "detail",
  },
  {
    name: "detail-image",
    path: "/generations/{gen.succeededImage}",
    as: "sam",
  },
  { name: "detail-failed", path: "/generations/{gen.failed}", as: "sam" },
  {
    name: "detail-upload-removed",
    path: "/generations/{gen.cancelled}",
    as: "sam",
  },

  { name: "account", path: "/account", as: "sam" },
  {
    name: "avatar-menu",
    path: "/models",
    as: "sam",
    actions: [{ role: "button", name: "Account" }],
  },

  { name: "admin-overview", path: "/admin", as: "alice" },
  {
    name: "admin-settings",
    path: "/admin/settings",
    as: "alice",
    prototype: "editor-c",
  },
  {
    name: "admin-backends",
    path: "/admin/backends",
    as: "alice",
    prototype: "editor-a",
  },
  { name: "admin-models", path: "/admin/models", as: "alice" },
  {
    name: "admin-editor",
    path: "/admin/models/{model.video.id}",
    as: "alice",
    prototype: "editor-a",
  },
  {
    name: "admin-editor-new",
    path: "/admin/models/{model.draft.id}",
    as: "alice",
  },
  { name: "admin-generations", path: "/admin/generations", as: "alice" },
  {
    name: "admin-generation",
    path: "/admin/generations/{gen.removed}",
    as: "alice",
  },
  { name: "admin-users", path: "/admin/users", as: "alice" },
  { name: "admin-user", path: "/admin/users/{user.sam}", as: "alice" },
  {
    name: "admin-user-uploads",
    path: "/admin/users/{user.sam}/uploads",
    as: "alice",
  },
  { name: "admin-blocked", path: "/admin/blocked-accounts", as: "alice" },
  { name: "admin-logs", path: "/admin/logs", as: "alice" },
  { name: "admin-audit", path: "/admin/audit", as: "alice" },
  { name: "account-admin", path: "/account", as: "alice" },

  { name: "workbench-paused", path: "/models/seed-video", as: "sam" },
  { name: "gallery-paused", path: "/gallery", as: "sam" },
  { name: "admin-overview-paused", path: "/admin", as: "alice" },
];
