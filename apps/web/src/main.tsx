import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LandingPage } from "./LandingPage.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
