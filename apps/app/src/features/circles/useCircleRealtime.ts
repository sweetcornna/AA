import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "../../lib/supabase";

/**
 * Subscribe to row changes for a circle and invalidate the relevant queries so
 * every member sees new expenses / settlements / members without refreshing.
 * RLS still governs which changes a subscriber is allowed to receive.
 */
export function useCircleRealtime(circleId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!circleId) return;
    const filter = `circle_id=eq.${circleId}`;
    const invalidate = (keys: string[]) =>
      keys.forEach((k) => qc.invalidateQueries({ queryKey: [k, circleId] }));

    const channel = supabase
      .channel(`circle:${circleId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter },
        () => invalidate(["expenses", "balances"]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expense_splits", filter },
        () => invalidate(["balances"]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settlements", filter },
        () => invalidate(["settlements", "balances"]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "circle_members", filter },
        () => invalidate(["members", "balances"]),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [circleId, qc]);
}
