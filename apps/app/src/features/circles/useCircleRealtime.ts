import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "../../lib/supabase";

/** RLS-scoped ledger subscription shared by all signed-in pages. */
export function useCircleRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      for (const key of [
        "circles",
        "my-balances",
        "activity",
        "members",
        "participants",
        "balances",
        "expenses",
        "settlements",
        "circle",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
    };
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        refresh();
      }, 120);
    };
    // All these reads are RLS scoped. Circle UPDATE is the reliable membership
    // change signal; a filtered DELETE cannot be used for departed membership.
    let channel = supabase.channel("ledger:changes");
    for (const table of [
      "circles",
      "expenses",
      "expense_splits",
      "settlements",
      "circle_members",
    ]) {
      channel = channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table },
          scheduleRefresh,
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table },
          scheduleRefresh,
        );
    }
    channel.subscribe();
    const focus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [qc]);
}
