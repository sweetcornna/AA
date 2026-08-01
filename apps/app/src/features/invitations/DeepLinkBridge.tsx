import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { firstNewInvitePath } from "../../lib/deepLinkNavigation";

export function DeepLinkBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = useRef(`${location.pathname}${location.search}`);

  useEffect(() => {
    currentPath.current = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let startupPending = true;
    const startupEventPaths = new Set<string>();

    const handleUrls = (urls: string[] | null, source: "event" | "startup") => {
      const path = firstNewInvitePath(
        urls,
        currentPath.current,
        source === "startup" ? startupEventPaths : null,
      );
      if (!path) return;
      if (source === "event" && startupPending) startupEventPaths.add(path);
      currentPath.current = path;
      navigate(path);
    };

    void import("@tauri-apps/plugin-deep-link")
      .then(async ({ getCurrent, onOpenUrl }) => {
        const stop = await onOpenUrl((urls) => handleUrls(urls, "event"));
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        try {
          const currentUrls = await getCurrent();
          if (!disposed) handleUrls(currentUrls, "startup");
        } finally {
          startupPending = false;
          startupEventPaths.clear();
        }
      })
      .catch(() => {
        // The native plugin may be unavailable in browser development builds.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate]);

  return null;
}
