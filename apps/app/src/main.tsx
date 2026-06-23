import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./features/auth/AuthProvider";
import { queryClient } from "./lib/queryClient";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* HashRouter is robust inside Tauri's file:// webview on all platforms. */}
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
