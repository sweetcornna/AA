import type { SplitType } from "@aa/shared";

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface Circle {
  id: string;
  name: string;
  description: string;
  default_currency: string;
  created_by: string;
  created_at: string;
}

export type MemberRole = "owner" | "admin" | "member";

export interface CircleMember {
  id: string;
  circle_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  profile: Profile | null;
}

export type ExpenseSource = "manual" | "voice" | "agent";

export interface Expense {
  id: string;
  circle_id: string;
  payer_id: string;
  amount_minor: number;
  currency: string;
  description: string;
  category: string | null;
  spent_at: string;
  split_type: SplitType;
  source: ExpenseSource;
  created_by: string;
  created_at: string;
}

export interface ExpenseSplitRow {
  user_id: string;
  owed_minor: number;
  share_units: number | null;
}

export interface Settlement {
  id: string;
  circle_id: string;
  from_user: string;
  to_user: string;
  amount_minor: number;
  currency: string;
  note: string | null;
  settled_at: string;
}

export interface CircleBalance {
  circle_id: string;
  user_id: string;
  net_minor: number;
}

export interface Invitation {
  id: string;
  circle_id: string;
  token: string;
  role: MemberRole;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
}
