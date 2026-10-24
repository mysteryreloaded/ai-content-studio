import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { LandingPage } from "./LandingPage.js";
import { AccountPage } from "./pages/AccountPage.js";
import { AdminShell } from "./pages/AdminShell.js";
import { ModelsHome } from "./pages/ModelsHome.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// A data router (rather than <BrowserRouter>) so the Model editor can use
// useBlocker to guard every in-app navigation away from unsaved changes,
// not just the ones it wires up by hand (issue #40 follow-up). AdminShell
// keeps its own nested <Routes>, which still works under a data router.
const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/models", element: <ModelsHome /> },
  { path: "/account", element: <AccountPage /> },
  { path: "/admin/*", element: <AdminShell /> },
]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
