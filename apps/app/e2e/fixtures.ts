import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const localUrl = "http://127.0.0.1:54321";
const anon =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const service =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXB" +
  "hYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = createClient(localUrl, service, options);
export function unwrap<T>(r:
  | { data: T; error: null }
  | { data: unknown; error: { message: string } }
): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export function credentials(name: string) {
  return {
    name,
    email: `aa-ui-${randomUUID()}@example.invalid`,
    password: `Aa-${randomUUID()}!`,
  };
}
export async function login(
  page: Page,
  user: { email: string; password: string },
) {
  await page.goto("/#/");
  await page
    .getByRole("textbox", { name: "邮箱", exact: true })
    .fill(user.email);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
}
export async function logout(page: Page) {
  await page.goto("/#/profile");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "确认退出登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
}
export const test = base.extend<{
  ledger: {
    owner: Awaited<ReturnType<typeof makeUser>>;
    member: Awaited<ReturnType<typeof makeUser>>;
    createCircle: (
      name?: string,
      currency?: string,
      withMember?: boolean,
    ) => Promise<string>;
  };
}>({
  ledger: async ({}, use) => {
    const owner = await makeUser("林可"),
      member = await makeUser("周宁");
    try {
      await use({
        owner,
        member,
        createCircle: async (
          name = "周末好食光",
          currency = "CNY",
          withMember = true,
        ) => {
          const circle = unwrap(
            await owner.client.rpc("create_circle", {
              p_name: name,
              p_currency: currency,
            }),
          );
          if (withMember) {
            const invitation = unwrap(
              await owner.client.rpc("create_invitation", {
                p_circle_id: circle.id,
              }),
            );
            unwrap(
              await member.client.rpc("accept_invitation", {
                p_token: invitation.token,
              }),
            );
          }
          return circle.id as string;
        },
      });
    } finally {
      // Even circles created through UI are scoped to this test's new identities.
      for (const user of [owner, member]) {
        unwrap(await admin.from("circles").delete().eq("created_by", user.id));
      }
      for (const user of [owner, member])
        unwrap(await admin.auth.admin.deleteUser(user.id));
    }
  },
});
export async function makeUser(name: string) {
  const auth = credentials(name);
  const result = unwrap(
    await admin.auth.admin.createUser({
      email: auth.email,
      password: auth.password,
      email_confirm: true,
      user_metadata: { display_name: name },
    }),
  );
  const client = createClient(localUrl, anon, options);
  unwrap(
    await client.auth.signInWithPassword({
      email: auth.email,
      password: auth.password,
    }),
  );
  return { ...auth, id: result.user!.id, client };
}
export { expect };
