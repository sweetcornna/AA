// Exercise the actual installed debug WebView. Requires adb reverse 1420/54321,
// the development server, and the local Supabase stack. No production writes.
import { chromium, expect as baseExpect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeUser, admin, unwrap } from "../apps/app/e2e/fixtures.ts";
const expect = baseExpect.configure({ timeout: 15000 });
const ADB =
  process.env.AA_ADB ??
  "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const dir = fileURLToPath(new URL("../.artifacts/ui-qa/", import.meta.url));
mkdirSync(dir, { recursive: true });
const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8" });
const owner = await makeUser("安卓测试"),
  member = await makeUser("同伴");
let browser, page, circleId;
function pass(name) {
  console.log(`PASS Android: ${name}`);
}
async function attach() {
  const sockets = adb("shell", "cat", "/proc/net/unix");
  const pid = adb("shell", "pidof", "com.aa.expense").trim();
  const name = sockets.match(
    new RegExp(`@(webview_devtools_remote_${pid})`),
  )?.[1];
  if (!name) throw new Error("Installed debug WebView is not available");
  adb("forward", "tcp:9223", `localabstract:${name}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9223", {
    noDefaults: true,
  });
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(15000);
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame())
      console.log(
        "Android route:",
        new URL(f.url()).hash
          .replace(/[0-9a-f-]{36}/g, "<circle>")
          .replace(/token=[^&]+/, "token=<redacted>"),
      );
  });
  page.on("pageerror", (e) => console.log("Android page error:", e.message));
}
async function route(path) {
  await page.goto(`http://tauri.localhost/#${path}`);
}
async function shot(name) {
  if (name === "detail") {
    await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
    await expect(page.locator(".balance-hero .balance-amount")).toHaveText(
      "¥180.00",
    );
  }
  await page.screenshot({
    path: `${dir}/android-${name}.png`,
    animations: "disabled",
  });
}
try {
  adb("shell", "am", "force-stop", "com.aa.expense");
  adb(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.MAIN",
    "-n",
    "com.aa.expense/.MainActivity",
  );
  await expect
    .poll(async () => {
      try {
        await attach();
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await page.waitForLoadState("domcontentloaded");
  await route("/");
  await expect(
    page
      .getByRole("button", { name: "登录", exact: true })
      .or(page.getByRole("heading", { name: "我的圈子" })),
  ).toBeVisible();
  if (
    !(await page.getByRole("button", { name: "登录", exact: true }).isVisible())
  ) {
    await route("/profile");
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    if (
      await page
        .getByRole("button", { name: "确认退出登录", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "确认退出登录", exact: true })
        .click();
  }
  await route("/");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);

  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
  pass("password login");
  await page.getByRole("button", { name: "创建或加入圈子" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /新建圈子/ })
    .click();
  await page.getByLabel("圈子名称", { exact: true }).fill("周末出行 · Android");

  await page.getByRole("button", { name: "创建圈子", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
  circleId = page.url().split("/circles/")[1];
  pass("create circle");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "邀请成员", exact: true }).click();
  await page.getByRole("button", { name: "生成邀请链接", exact: true }).click();
  await expect(page.getByRole("img", { name: "圈子邀请二维码" })).toBeVisible();
  const link = await page.getByLabel("邀请链接", { exact: true }).inputValue();
  await shot("invite");
  const token = new URL(link).searchParams.get("token");
  unwrap(await member.client.rpc("accept_invitation", { p_token: token }));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.getByText("同伴", { exact: true })).toBeVisible();
  pass("QR invitation and live membership");
  await route(`/circles/${circleId}/add`);
  await page.getByLabel("金额", { exact: true }).click();
  await page.getByLabel("金额", { exact: true }).fill("120");
  await page.getByLabel("备注，如 火锅、打车").fill("Android 原生记账");
  await shot("keyboard");
  await page.getByRole("button", { name: "保存账单", exact: true }).click();
  await expect(
    page.getByText("Android 原生记账", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".balance-hero .balance-amount")).toHaveText(
    "¥60.00",
  );
  pass("expense and equal split");
  for (const [mode, amount] of [
    ["精确", "100"],
    ["份额", "80"],
  ]) {
    await route(`/circles/${circleId}/add`);
    await page.getByLabel("金额", { exact: true }).fill(amount);
    await page.getByLabel("备注，如 火锅、打车").fill(`Android ${mode}分摊`);
    await page.getByRole("button", { name: mode, exact: true }).click();
    if (mode === "精确") {
      await page.getByLabel("安卓测试的分摊金额").fill("40");
      await page.getByLabel("同伴的分摊金额").fill("60");
    } else {
      await page.getByLabel("安卓测试的份额").fill("1");
      await page.getByLabel("同伴的份额").fill("3");
    }
    await page.getByRole("button", { name: "保存账单", exact: true }).click();
    await expect(
      page.getByText(`Android ${mode}分摊`, { exact: true }),
    ).toBeVisible();
    pass(`${mode} split`);
  }
  await expect(page.locator(".balance-hero .balance-amount")).toHaveText(
    "¥180.00",
  );
  await route(`/circles/${circleId}/add`);
  await page
    .getByLabel("如：昨晚和小红吃火锅 360 三人平摊")
    .fill("我和同伴吃饭 30 平摊");
  await page.getByRole("button", { name: "AI 解析", exact: true }).click();
  await expect(page.getByLabel("金额", { exact: true })).toHaveValue("30");
  pass("natural language prefill retained");
  await route(`/circles/${circleId}`);
  await shot("detail");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "退出圈子", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看结算" })).toBeVisible();
  pass("unsettled departure blocked");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  unwrap(
    await member.client.rpc("create_settlement", {
      p_circle_id: circleId,
      p_from_user: member.id,
      p_to_user: owner.id,
      p_amount_minor: 18000,
      p_currency: "CNY",
    }),
  );
  await expect(page.locator(".balance-hero .balance-amount")).toHaveText(
    "¥0.00",
  );
  pass("settlement sync without reload");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "退出圈子", exact: true }).click();
  await page.getByLabel("选择新圈主").selectOption(member.id);
  await shot("leave");
  await page.getByRole("button", { name: "确认退出", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
  pass("owner transfer and departure");
  adb(
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    link,
    "com.aa.expense",
  );
  await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
  pass("native deep link rejoins circle");
  await route(`/circles/${circleId}/add`);
  await expect(page.getByLabel("金额", { exact: true })).toBeVisible();

  // After dismissing the keyboard, the system back navigates the WebView.
  adb("shell", "input", "keyevent", "4");
  await new Promise((r) => setTimeout(r, 400));
  if (page.url().endsWith("/add")) adb("shell", "input", "keyevent", "4");
  await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
  pass("Android system back");
  await route("/activity");
  await expect(
    page.getByText("Android 原生记账", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "与我有关", exact: true }).click();
  await shot("activity");
  pass("activity filter");
  await route("/profile");
  await page.getByLabel("昵称", { exact: true }).fill("安卓新昵称");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("资料已保存", { exact: true })).toBeVisible();
  pass("profile save");
  await route("/assistant");
  await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
  await shot("circles");
  pass("removed route redirects");
  await route("/profile");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "确认退出登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  pass("logout");
} finally {
  await browser?.close();
  for (const u of [owner, member])
    unwrap(await admin.from("circles").delete().eq("created_by", u.id));
  for (const u of [owner, member])
    unwrap(await admin.auth.admin.deleteUser(u.id));
}
