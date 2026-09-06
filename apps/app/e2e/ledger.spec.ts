import {
  test,
  expect,
  login,
  logout,
  admin,
  credentials,
  unwrap,
} from "./fixtures";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const shots = fileURLToPath(
  new URL("../../../.artifacts/ui-qa/", import.meta.url),
);
import type { Page } from "@playwright/test";
async function openLeave(page: Page) {
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "退出圈子", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "退出圈子", exact: true }),
  ).toBeVisible();
}
async function saveExpense(
  page: Page,
  id: string,
  amount: string,
  description: string,
  mode: "平均" | "精确" | "份额" = "平均",
) {
  await page.goto(`/#/circles/${id}/add`);
  await page.getByLabel("金额", { exact: true }).fill(amount);
  await page.getByLabel("备注，如 火锅、打车").fill(description);
  await page.getByRole("button", { name: mode, exact: true }).click();
  if (mode === "精确") {
    await page.getByLabel("林可的分摊金额").fill("40");
    await page.getByLabel("周宁的分摊金额").fill("60");
  }
  if (mode === "份额") {
    await page.getByLabel("林可的份额").fill("1");
    await page.getByLabel("周宁的份额").fill("3");
  }
  await page.getByRole("button", { name: "保存账单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
}

test("create, invite, three split modes, realtime, settlement and departure", async ({
  page,
  browser,
  ledger,
}) => {
  await login(page, ledger.owner);
  await page.getByRole("button", { name: "创建或加入圈子" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "新建圈子", exact: false })
    .click();
  await page.getByLabel("圈子名称", { exact: true }).fill("周末好食光");
  await page.getByRole("button", { name: "创建圈子", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
  const id = page.url().split("/circles/")[1];
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "邀请成员", exact: true }).click();
  await page.getByRole("button", { name: "生成邀请链接", exact: true }).click();
  await expect(page.getByRole("img", { name: "圈子邀请二维码" })).toBeVisible();
  const link = await page.getByLabel("邀请链接", { exact: true }).inputValue();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const context = await browser.newContext();
  const friend = await context.newPage();
  try {
    await login(friend, ledger.member);
    await friend.goto("/#/join");
    await friend.getByLabel("邀请码或邀请链接", { exact: true }).fill(link);
    await friend.getByRole("button", { name: "加入圈子", exact: true }).click();
    await expect(
      friend.getByRole("heading", { name: "账单记录" }),
    ).toBeVisible();
    await saveExpense(page, id, "200", "周末火锅");
    // The second browser remains open on detail: no reload/refocus allowed.
    await expect(friend.getByText("周末火锅", { exact: true })).toBeVisible();
    await saveExpense(page, id, "100", "精确分摊晚餐", "精确");
    await saveExpense(page, id, "80", "按份额出行", "份额");
    await expect(friend.getByText("按份额出行", { exact: true })).toBeVisible();
    await expect(friend.locator(".balance-hero .balance-amount")).toHaveText(
      "¥220.00",
    );
    await openLeave(friend);
    await expect(
      friend.getByText("请先完成结算。", { exact: false }),
    ).toBeVisible();
    await expect(
      friend.getByRole("button", { name: "确认退出", exact: true }),
    ).toHaveCount(0);
    await friend.getByRole("button", { name: "查看结算", exact: true }).click();
    await friend.getByRole("button", { name: "标记已付", exact: true }).click();
    await friend.getByRole("button", { name: "确认已付", exact: true }).click();
    await expect(friend.locator(".balance-hero .balance-amount")).toHaveText(
      "¥0.00",
    );
    await openLeave(friend);
    await friend.getByRole("button", { name: "确认退出", exact: true }).click();
    await expect(
      friend.getByRole("heading", { name: "我的圈子" }),
    ).toBeVisible();
    await expect(friend.getByRole("link", { name: /周末好食光/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("周宁（已退出）", { exact: false }).first(),
    ).toBeVisible();
    await page.goto("/#/activity");
    await expect(page.getByText("周末火锅", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "与我有关", exact: true }).click();
    await expect(
      page.getByText("我的份额", { exact: false }).first(),
    ).toBeVisible();
    await page.goto(`/#/circles/${id}`);
    await openLeave(page);
    await expect(
      page.getByText("你是最后一名成员", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "确认退出", exact: true }).click();
    await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
    await friend.goto("/#/join");
    await friend.getByLabel("邀请码或邀请链接", { exact: true }).fill(link);
    await friend.getByRole("button", { name: "加入圈子", exact: true }).click();
    await expect(friend.getByRole("alert")).toContainText(/撤销|失效/);
  } finally {
    await context.close();
  }
});

test("fresh membership is required before saving with the default everyone split", async ({ page, ledger }) => {
  const id = await ledger.createCircle("成员刷新回归", "CNY", false);
  await login(page, ledger.owner);
  await page.goto(`/#/circles/${id}`);
  await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
  // Seed the form's member cache while only the owner belongs to this circle.
  await page.goto(`/#/circles/${id}/add`);
  await expect(page.getByRole("checkbox", { name: /分摊成员/ })).toHaveCount(1);
  await expect(page.getByText("正在更新圈子成员，请稍候…")).toBeHidden();
  await page.goto(`/#/circles/${id}`);
  let releaseMembers!: () => void;
  const gate = new Promise<void>((resolve) => { releaseMembers = resolve; });
  await page.route("**/rest/v1/circle_members?**", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    const invitation = unwrap(await ledger.owner.client.rpc("create_invitation", { p_circle_id: id }));
    unwrap(await ledger.member.client.rpc("accept_invitation", { p_token: invitation.token }));
    await page.goto(`/#/circles/${id}/add`);
    await page.getByLabel("金额", { exact: true }).fill("100");
    await page.getByLabel("备注，如 火锅、打车").fill("新成员参与第一笔");
    await expect(page.getByRole("button", { name: "保存账单", exact: true })).toBeDisabled();
    await expect(page.getByText("正在更新圈子成员，请稍候…")).toBeVisible();
    releaseMembers();
    await expect(page.getByRole("checkbox", { name: /分摊成员/ })).toHaveCount(2);
    await expect(page.getByRole("checkbox", { name: "分摊成员 周宁" })).toBeChecked();
    await page.getByRole("button", { name: "保存账单", exact: true }).click();
    await expect(page.getByText("新成员参与第一笔", { exact: true })).toBeVisible();
    const splits = unwrap(await admin.from("expense_splits").select("owed_minor").eq("circle_id", id));
    expect(splits.map((split) => split.owed_minor).sort()).toEqual([5000, 5000]);
  } finally {
    releaseMembers();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("owner selects successor, old route redirects, profile and account cache isolation", async ({
  page,
  ledger,
}) => {
  const id = await ledger.createCircle();
  await login(page, ledger.owner);
  await page.goto(`/#/circles/${id}`);
  await openLeave(page);
  await expect(
    page.getByRole("button", { name: "确认退出", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("选择新圈主").selectOption(ledger.member.id);
  await page.getByRole("button", { name: "确认退出", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
  await logout(page);
  await login(page, ledger.member);
  await expect(page.getByRole("link", { name: /周末好食光/ })).toBeVisible();
  await page.goto(`/#/circles/${id}`);
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "邀请成员", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto("/#/profile");
  await page.getByLabel("昵称", { exact: true }).fill("周宁新昵称");
  await page.getByLabel("手机号", { exact: true }).fill("13800138000");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByRole("status")).toHaveText("资料已保存");
  await page.reload();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
    "周宁新昵称",
  );
  await page.goto("/#/assistant");
  await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "助手", exact: true }),
  ).toHaveCount(0);
  await logout(page);
  await login(page, ledger.owner);
  await expect(page.getByRole("link", { name: /周末好食光/ })).toHaveCount(0);
});

test("natural language prefill, manual correction, all-unselected and failure recovery", async ({
  page,
  ledger,
}) => {
  const id = await ledger.createCircle();
  await login(page, ledger.owner);
  await page.goto(`/#/circles/${id}/add`);
  await page
    .getByLabel("如：昨晚和小红吃火锅 360 三人平摊")
    .fill("我和周宁吃火锅 200 平摊");
  await page.getByRole("button", { name: "AI 解析", exact: true }).click();
  await expect(page.getByText("已由 AI 预填", { exact: false })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByLabel("金额", { exact: true })).toHaveValue("200");
  await page.getByLabel("金额", { exact: true }).fill("240");
  await page.getByLabel("备注，如 火锅、打车").fill("人工核对后的火锅");
  await page.getByRole("checkbox", { name: "分摊成员 林可" }).click();
  await page.getByRole("checkbox", { name: "分摊成员 周宁" }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存账单" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "分摊成员 林可" }).click();
  await page.getByRole("checkbox", { name: "分摊成员 周宁" }).click();
  await page.route("**/rest/v1/rpc/create_expense", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "network unavailable" }),
    }),
  );
  await page.getByRole("button", { name: "保存账单" }).click();
  await expect(
    page.getByText("network unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("金额", { exact: true })).toHaveValue("240");
  await page.unroute("**/rest/v1/rpc/create_expense");
  await page.getByRole("button", { name: "保存账单" }).click();
  await expect(
    page.getByText("人工核对后的火锅", { exact: true }),
  ).toBeVisible();
});

test("responsive currency summaries, global chooser, accessible dialog and reduced motion", async ({
  page,
  ledger,
}, info) => {
  const id = await ledger.createCircle("周末好食光");
  const usd = await ledger.createCircle("加州海岸线", "USD", false);
  const jpy = await ledger.createCircle("东京散步计划", "JPY", false);
  unwrap(
    await ledger.owner.client.rpc("create_expense", {
      p_circle_id: id,
      p_payer_id: ledger.owner.id,
      p_amount_minor: 42800,
      p_currency: "CNY",
      p_description: "朋友的周末晚餐",
      p_category: "餐饮",
      p_spent_at: "2026-09-05",
      p_split_type: "equal",
      p_splits: [
        { user_id: ledger.owner.id, owed_minor: 21400 },
        { user_id: ledger.member.id, owed_minor: 21400 },
      ],
    }),
  );
  await login(page, ledger.owner);
  await mkdir(shots, { recursive: true });
  for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(page.locator(".balance-grid .balance-hero")).toHaveCount(3);
    await expect(page.locator(".balance-grid")).toContainText("US$0.00");
    await expect(page.locator(".balance-grid")).toContainText("JP¥0");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `${width}px should not overflow horizontally`).toBe(false);
    await page.screenshot({
      path: `${shots}/${info.project.name}-circles-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "选择记账圈子" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /东京散步计划/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`${jpy}/add`));
  await page.getByLabel("金额", { exact: true }).fill("1000");
  await expect(page.getByText("= JP¥1,000", { exact: true })).toBeVisible();
  await page.goto(`/#/circles/${id}`);
  await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
  await expect(page.locator(".balance-hero .balance-amount")).toHaveText(
    "¥214.00",
  );
  await expect(page.getByText("朋友的周末晚餐", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${shots}/${info.project.name}-detail-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${shots}/${info.project.name}-detail-mobile.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "更多", exact: true }).click();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "更多", exact: true }),
  ).toBeFocused();
  expect(usd).toBeTruthy();
});

test("registration and invalid invite recovery", async ({ page }) => {
  const account = credentials("新朋友");
  let id: string | undefined;
  try {
    await page.goto("/#/register");
    await page.getByLabel("昵称", { exact: true }).fill(account.name);
    await page.getByLabel("邮箱", { exact: true }).fill(account.email);
    await page.getByLabel("至少 6 位").fill(account.password);
    await page.getByLabel("再次输入密码").fill("mismatch");
    await page.getByRole("button", { name: "注册并登录", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("两次输入的密码不一致");
    await page.getByLabel("再次输入密码").fill(account.password);
    await page.getByRole("button", { name: "注册并登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
    id = unwrap(await admin.auth.admin.listUsers()).users.find(
      (u) => u.email === account.email,
    )?.id;
    await page.goto("/#/join");
    await page
      .getByLabel("邀请码或邀请链接", { exact: true })
      .fill("不是邀请码");
    await page.getByRole("button", { name: "加入圈子", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("有效的 24 位邀请码");
    await logout(page);
    await login(page, account);
  } finally {
    if (!id)
      id = unwrap(await admin.auth.admin.listUsers()).users.find(
        (u) => u.email === account.email,
      )?.id;
    if (id) unwrap(await admin.auth.admin.deleteUser(id));
  }
});

test("email OTP login uses the delivered code", async ({
  page,
  ledger,
  request,
}) => {
  await page.goto("/#/");
  await page.getByRole("button", { name: "用邮箱验证码登录" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(ledger.owner.email);
  await page.getByRole("button", { name: "发送 6 位验证码" }).click();
  await expect(page.getByLabel("6 位验证码", { exact: true })).toBeVisible();
  let messageId = "";
  await expect
    .poll(async () => {
      const response = await request.get(
        "http://127.0.0.1:54324/api/v1/messages",
      );
      const body = await response.json();
      messageId =
        body.messages?.find((m: { ID: string; To: { Address: string }[] }) =>
          m.To?.some((t) => t.Address === ledger.owner.email),
        )?.ID ?? "";
      return messageId;
    })
    .not.toBe("");
  const message = await (
    await request.get(`http://127.0.0.1:54324/api/v1/message/${messageId}`)
  ).json();
  const code = (message.Text as string).match(/\b\d{6}\b/)?.[0];
  expect(code).toBeTruthy();
  await page.getByLabel("6 位验证码", { exact: true }).fill(code!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的圈子" })).toBeVisible();
});

async function supportsCloudCapture(page: Page) {
  return page.evaluate(() =>
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined" &&
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].some((mime) =>
      MediaRecorder.isTypeSupported(mime),
    ),
  );
}

test("voice consent, supported MediaRecorder capture or manual fallback, transcription and cancellation", async ({
  page,
  context,
  browserName,
  ledger,
}) => {
  const id = await ledger.createCircle();
  if (browserName !== "firefox") await context.grantPermissions(["microphone"]);
  // Deterministic audio source; the browser's real MediaRecorder is exercised.
  // The external transcription provider is stubbed, not claimed as live QA.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (
        String(input).includes("/asr-transcribe") &&
        init?.body instanceof Blob
      )
        (window as any).__qaUploadBytes = init.body.size;
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
    const NativeRecorder = window.MediaRecorder;
    if (NativeRecorder) {
      window.MediaRecorder = class extends NativeRecorder {
        constructor(stream: MediaStream, options?: MediaRecorderOptions) {
          super(stream, options);
          this.addEventListener("dataavailable", (event) => {
            (window as any).__qaRecordedBytes =
              ((window as any).__qaRecordedBytes ?? 0) + event.data.size;
          });
        }
      };
    }
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(destination);
      // Keep the headless audio graph clocked through its real output backend.
      // The output is silent; the recorder still receives the oscillator.
      const silentOutput = audio.createGain();
      silentOutput.gain.value = 0;
      oscillator.connect(silentOutput);
      silentOutput.connect(audio.destination);
      oscillator.start();
      (window as any).__qaAudio = { audio, oscillator, destination };
      await audio.resume();
      return destination.stream;
    };
  });
  await page.route("**/functions/v1/asr-transcribe", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        text: "我和周宁吃饭 80 平摊",
        provider: "qa-fixture",
      }),
    }),
  );
  await login(page, ledger.owner);
  await page.goto(`/#/circles/${id}/add`);
  const captureSupported = await supportsCloudCapture(page);
  await page.getByRole("button", { name: "语音", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "使用云端语音转写" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "语音", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "语音", exact: true }).click();
  await page.getByRole("button", { name: "同意并录音", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "使用云端语音转写" })).toBeHidden();
  // Playwright's Linux WebKit has no MediaRecorder; macOS WebKit does.
  // Verify the real fallback on that runtime instead of faking an encoder.
  if (!captureSupported) {
    test.info().annotations.push({
      type: "coverage",
      description: "This browser runtime lacks a supported MediaRecorder; manual recovery verified, capture not claimed.",
    });
    await expect(page.getByText(/不支持.*录音/)).toBeVisible();
    await page.getByLabel("金额", { exact: true }).fill("80");
    await page.getByLabel("备注，如 火锅、打车").fill("录音不可用时手动记账");
    await page.getByRole("button", { name: "保存账单", exact: true }).click();
    await expect(page.getByText("录音不可用时手动记账", { exact: true })).toBeVisible();
    const stored = unwrap(await admin.from("expenses").select("source,asr_provider").eq("circle_id", id));
    expect(stored).toEqual([{ source: "manual", asr_provider: null }]);
    return;
  }
  await expect(page.getByRole("button", { name: /录音 \d+s.*点按结束/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__qaRecordedBytes ?? 0)).toBeGreaterThan(0);
  await Promise.all([
    page.waitForRequest("**/functions/v1/asr-transcribe", { timeout: 15_000 }),
    page.getByRole("button", { name: /点按结束/ }).click(),
  ]);
  expect(
    await page.evaluate(() => (window as any).__qaUploadBytes),
  ).toBeGreaterThan(0);
  await expect(
    page.getByLabel("如：昨晚和小红吃火锅 360 三人平摊"),
  ).toHaveValue("我和周宁吃饭 80 平摊");
  await page.getByRole("button", { name: "AI 解析", exact: true }).click();
  await expect(page.getByLabel("金额", { exact: true })).toHaveValue("80");
  // Cancel another capture without replacing the already confirmed transcript.
  await page.getByRole("button", { name: "语音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消录音", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消录音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "语音", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存账单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账单记录" })).toBeVisible();
  const stored = unwrap(
    await admin
      .from("expenses")
      .select("source,asr_provider")
      .eq("circle_id", id),
  );
  expect(stored).toEqual([
    { source: "voice", asr_provider: "cloud:qa-fixture" },
  ]);
});

test("unsupported recorder recovers to a saved manual expense after consent closes", async ({ page, ledger }) => {
  const id = await ledger.createCircle();
  await page.addInitScript(() => {
    for (const key of ["SpeechRecognition", "webkitSpeechRecognition", "MediaRecorder"]) {
      Object.defineProperty(window, key, { value: undefined, configurable: true });
    }
  });
  await login(page, ledger.owner);
  await page.goto(`/#/circles/${id}/add`);
  await page.getByRole("button", { name: "语音", exact: true }).click();
  await page.getByRole("button", { name: "同意并录音", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "使用云端语音转写" })).toBeHidden();
  await expect(page.getByText(/不支持.*录音/)).toBeVisible();
  await page.getByLabel("金额", { exact: true }).fill("80");
  await expect(page.getByLabel("金额", { exact: true })).toHaveValue("80");
  await page.getByLabel("备注，如 火锅、打车").fill("语音不可用时手动保存");
  await page.getByRole("button", { name: "保存账单", exact: true }).click();
  await expect(page.getByText("语音不可用时手动保存", { exact: true })).toBeVisible();
  const stored = unwrap(await admin.from("expenses").select("source,asr_provider").eq("circle_id", id));
  expect(stored).toEqual([{ source: "manual", asr_provider: null }]);
});

test("microphone denial or unsupported capture and unavailable balances recover without false zero", async ({
  page,
  ledger,
}) => {
  const id = await ledger.createCircle();
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    localStorage.setItem("aa.voice-cloud-consent", "1");
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("denied", "NotAllowedError");
    };
  });
  await login(page, ledger.owner);
  await page.goto(`/#/circles/${id}/add`);
  const captureSupported = await supportsCloudCapture(page);
  await page.getByRole("button", { name: "语音", exact: true }).click();
  await expect(page.getByText(captureSupported ? /麦克风.*(拒绝|权限)/ : /不支持.*录音/)).toBeVisible();
  await page.getByLabel("金额", { exact: true }).fill("10");
  await expect(page.getByRole("button", { name: "保存账单" })).toBeEnabled();
  await page.route("**/rest/v1/circle_balances?**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "unavailable" }),
    }),
  );
  await page.goto(`/#/circles/${id}`);
  await expect(
    page.getByText("余额加载失败，暂时无法结算或退出。"),
  ).toBeVisible();
  await openLeave(page);
  await expect(
    page.getByRole("button", { name: "确认退出", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.unroute("**/rest/v1/circle_balances?**");
  await page.reload();
  await expect(page.locator(".balance-hero .balance-amount")).toHaveText(
    "¥0.00",
  );
});
