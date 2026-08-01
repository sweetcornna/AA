import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./features/auth/AuthProvider";
import { DeepLinkBridge } from "./features/invitations/DeepLinkBridge";
import { queryClient } from "./lib/queryClient";
import { supabaseConfigurationError } from "./lib/supabase";
import "./index.css";

const buildSupabaseOrigin = import.meta.env.VITE_SUPABASE_ORIGIN;
if (buildSupabaseOrigin && buildSupabaseOrigin.length < 1) {
  throw new Error("invalid build origin marker");
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* HashRouter is robust inside Tauri's file:// webview on all platforms. */}
      <HashRouter>
        {!supabaseConfigurationError && <DeepLinkBridge />}
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
