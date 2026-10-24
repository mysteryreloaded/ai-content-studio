import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LandingPage } from "./LandingPage.js";
import { AccountPage } from "./pages/AccountPage.js";
import { AdminShell } from "./pages/AdminShell.js";
import { ModelsHome } from "./pages/ModelsHome.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/models" element={<ModelsHome />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin/*" element={<AdminShell />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
