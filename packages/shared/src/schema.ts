import { z } from "zod";

/**
 * Form-level schema for creating an expense. Shared between the React form
 * (React Hook Form resolver) and any server-side validation. Amounts are in
 * minor units (整数分).
 */
export const splitTypeSchema = z.enum(["equal", "exact", "shares"]);

export const exactShareSchema = z.object({
  userId: z.string().uuid(),
  amountMinor: z.number().int().nonnegative(),
});

export const weightShareSchema = z.object({
  userId: z.string().uuid(),
  weight: z.number().nonnegative(),
});

export const expenseDraftSchema = z
  .object({
    circleId: z.string().uuid(),
    payerId: z.string().uuid(),
    amountMinor: z.number().int().positive(),
    currency: z.string().length(3),
    description: z.string().max(200).default(""),
    category: z.string().max(40).nullish(),
    spentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
    splitType: splitTypeSchema,
    participantIds: z.array(z.string().uuid()).min(1),
    exact: z.array(exactShareSchema).optional(),
    weights: z.array(weightShareSchema).optional(),
  })
  .superRefine((draft, ctx) => {
    if (draft.splitType === "exact" && !draft.exact?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exact split requires per-person amounts",
        path: ["exact"],
      });
    }
    if (draft.splitType === "shares" && !draft.weights?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shares split requires per-person weights",
        path: ["weights"],
      });
    }
  });

export type ExpenseDraft = z.infer<typeof expenseDraftSchema>;

export const circleDraftSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).optional(),
  defaultCurrency: z.string().length(3).default("CNY"),
});

export type CircleDraft = z.infer<typeof circleDraftSchema>;
