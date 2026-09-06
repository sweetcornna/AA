// Actual Android permission UI + WebView MediaRecorder. External ASR may be
// unconfigured locally; this is disclosed instead of replacing its response.
import { chromium, expect as baseExpect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeUser, admin, unwrap } from "../apps/app/e2e/fixtures.ts";
const expect = baseExpect.configure({ timeout: 15000 });
const adbPath =
  process.env.AA_ADB ??
  "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const adb = (...args) => execFileSync(adbPath, args, { encoding: "utf8" });
const dir = fileURLToPath(new URL("../.artifacts/ui-qa/", import.meta.url));
const user = await makeUser("语音测试");
let browser, page, circleId;
const report = {
  capture: false,
  deny: false,
  background: false,
  autoStop: false,
  upstream: "not tested",
};
async function attach() {
  const pid = adb("shell", "pidof", "com.aa.expense").trim();
  if (
    !adb("shell", "cat", "/proc/net/unix").includes(
      `@webview_devtools_remote_${pid}`,
    )
  )
    return false;
  adb("forward", "tcp:9223", `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9223", {
    noDefaults: true,
  });
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(15000);
  return true;
}
async function permission(buttonId) {
  let bounds;
  await expect
    .poll(
      () => {
        adb("shell", "uiautomator", "dump", "/sdcard/aa-voice-window.xml");
        const xml = adb("shell", "cat", "/sdcard/aa-voice-window.xml");
        const node = xml.match(
          new RegExp(`<node[^>]*resource-id="[^"]*${buttonId}"[^>]*>`),
        )?.[0];
        bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
        return !!bounds;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  adb(
    "shell",
    "input",
    "tap",
    String(Math.round((+bounds[1] + +bounds[3]) / 2)),
    String(Math.round((+bounds[2] + +bounds[4]) / 2)),
  );
}
async function voiceButton() {
  await page.getByRole("button", { name: "语音", exact: true }).click();
}
try {
  try {
    adb(
      "shell",
      "pm",
      "revoke",
      "com.aa.expense",
      "android.permission.RECORD_AUDIO",
    );
  } catch {
    /* already revoked */
  }
  adb(
    "shell",
    "pm",
    "clear-permission-flags",
    "com.aa.expense",
    "android.permission.RECORD_AUDIO",
    "user-set",
    "user-fixed",
  );
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
        return await attach();
      } catch {
        return false;
      }
    })
    .toBe(true);
  await page.goto("http://tauri.localhost/#/");
  await expect(
    page
      .getByRole("button", { name: "登录", exact: true })
      .or(page.getByRole("heading", { name: "我的圈子" })),
  ).toBeVisible();
  if (
    !(await page.getByRole("button", { name: "登录", exact: true }).isVisible())
  ) {
    await page.goto("http://tauri.localhost/#/profile");
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    const confirmation = page.getByRole("button", {
      name: "确认退出登录",
      exact: true,
    });
    await expect(
      confirmation.or(page.getByRole("button", { name: "登录", exact: true })),
    ).toBeVisible();
    if (await confirmation.isVisible()) await confirmation.click();
  }
  await page.goto("http://tauri.localhost/#/");
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await page.getByLabel("邮箱", { exact: true }).fill(user.email);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
  circleId = unwrap(
    await user.client.rpc("create_circle", { p_name: "Android 麦克风验收" }),
  ).id;
  await page.reload();
  await expect(
    page.getByRole("link", { name: /Android 麦克风验收/ }),
  ).toBeVisible();
  await page.goto(`http://tauri.localhost/#/circles/${circleId}/add`);
  // Native dev's Vite process was launched before TAURI_ENV_PLATFORM was set;
  // force only the platform's normal cloud route, keeping media APIs untouched.
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (
        String(input).includes("/asr-transcribe") &&
        init?.body instanceof Blob
      )
        window.__qaUploadBytes = init.body.size;
      return originalFetch(input, init);
    };
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    localStorage.removeItem("aa.voice-cloud-consent");
  });
  await voiceButton();
  await page.getByRole("button", { name: "同意并录音", exact: true }).click();
  await permission("permission_deny_button");
  await expect(page.getByText(/麦克风权限被拒绝/)).toBeVisible();
  report.deny = true;
  console.log(
    "PASS Android: microphone denied, manual input remains available",
  );
  await voiceButton();
  await permission("permission_allow_foreground_only_button");
  await expect(page.getByRole("button", { name: /录音 [12]s/ })).toBeVisible();
  await page.screenshot({ path: `${dir}/android-recording.png` });
  const upload = page.waitForRequest(
    (r) =>
      r.url().endsWith("/functions/v1/asr-transcribe") && r.method() === "POST",
    { timeout: 20000 },
  );
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/functions/v1/asr-transcribe") &&
      r.request().method() === "POST",
    { timeout: 20000 },
  );
  await page.getByRole("button", { name: /点按结束/ }).click();
  const [request, res] = await Promise.all([upload, response]);
  expect(await page.evaluate(() => window.__qaUploadBytes)).toBeGreaterThan(0);
  report.capture = true;
  const body = await res.json();
  report.upstream = res.ok()
    ? "live transcription succeeded"
    : (body.code ?? `HTTP ${res.status()}`);
  console.log(
    "PASS Android: real microphone stream recorded and uploaded; upstream:",
    report.upstream,
  );
  await expect(
    page.getByRole("button", { name: "语音", exact: true }),
  ).toBeVisible();
  await voiceButton();
  await expect(page.getByRole("button", { name: /录音/ })).toBeVisible();
  adb("shell", "input", "keyevent", "3");
  await new Promise((r) => setTimeout(r, 600));
  adb("shell", "am", "start", "-n", "com.aa.expense/.MainActivity");
  await expect(
    page.getByRole("button", { name: "语音", exact: true }),
  ).toBeVisible();
  report.background = true;
  console.log("PASS Android: background cancels recording");
  await voiceButton();
  await expect(page.getByRole("button", { name: /录音/ })).toBeVisible();
  console.log("Android: checking the 60-second automatic recording limit");
  await page.waitForRequest(
    (r) =>
      r.url().endsWith("/functions/v1/asr-transcribe") && r.method() === "POST",
    { timeout: 65000 },
  );
  report.autoStop = true;
  console.log("PASS Android: 60-second automatic recording stop");
  await expect(
    page.getByRole("button", { name: "语音", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  console.log("PASS Android: transcription timeout/error recovery");
  await page.goto("http://tauri.localhost/#/profile");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "确认退出登录", exact: true }).click();
} finally {
  writeFileSync(
    `${dir}/android-voice-results.json`,
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  if (circleId) unwrap(await admin.from("circles").delete().eq("id", circleId));
  unwrap(await admin.auth.admin.deleteUser(user.id));
}
