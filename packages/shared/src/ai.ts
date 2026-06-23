import { z } from "zod";

/**
 * Structured result of parsing a natural-language sentence into an expense.
 * Single source of truth shared by the frontend (form prefill + validation)
 * and the parse-expense Edge Function (which mirrors this shape as a JSON
 * Schema for Claude's strict tool use). Amounts are in MAJOR units (e.g. 元) —
 * the form converts to minor (分) on save.
 */
export const parsedParticipantSchema = z.object({
  /** Matched circle member id, or null when the AI/heuristics couldn't resolve the name. */
  matchedMemberId: z.string().uuid().nullable(),
  /** The name as it appeared in the sentence (e.g. "小明"). */
  rawName: z.string(),
  /** For split_type 'exact': this person's amount in major units; otherwise null. */
  amount: z.number().nonnegative().nullable(),
});

export const parsedExpenseSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  payerMemberId: z.string().uuid().nullable(),
  payerRawName: z.string().nullable(),
  spentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  splitType: z.enum(["equal", "exact", "shares"]),
  participants: z.array(parsedParticipantSchema),
  category: z.string().nullable(),
  description: z.string(),
  /** 0..1 — surface low confidence / unresolved names for user review. */
  confidence: z.number().min(0).max(1),
  unresolved: z.array(z.string()),
});

export type ParsedExpense = z.infer<typeof parsedExpenseSchema>;
export type ParsedParticipant = z.infer<typeof parsedParticipantSchema>;
