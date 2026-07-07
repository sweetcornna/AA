"""UI smoke: 一句话记账 → AI 解析预填 → 保存,以及助手结算确认卡片.

Prereqs: `supabase start`(自带 edge runtime)、`node scripts/seed-demo.mjs`、
dev server 在 :1420(`npm run dev --workspace=@aa/app -- --port 1420`)。
"""
from playwright.sync_api import sync_playwright, expect

APP = "http://localhost:1420"
SENTENCE = "我和小红吃火锅 200 平摊"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2)

    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_selector("text=以「阿明」登录", timeout=15000)
    pg.click("text=以「阿明」登录")
    pg.wait_for_selector("text=全部圈子", timeout=15000)

    pg.click("text=周末聚餐")
    pg.wait_for_selector("text=结余", timeout=15000)

    pg.click("button:has-text('记一笔')")
    pg.wait_for_selector("text=一句话记账", timeout=15000)

    pg.fill("input[placeholder*='昨晚和小红']", SENTENCE)
    pg.click("text=AI 解析")
    # cold start: edge runtime + module download can take a while on first run
    pg.wait_for_selector("text=已由 AI 预填", timeout=90000)
    print("parsed + prefilled")

    amount = pg.input_value("input[placeholder='0']")
    print("amount field =", amount)
    assert amount == "200", f"expected amount 200, got {amount!r}"

    pg.screenshot(path="/tmp/aa-ai-prefilled.png", full_page=True)

    pg.click("button:has-text('保存')")
    pg.wait_for_selector("text=结余", timeout=15000)  # back on detail
    expect(pg.get_by_text("¥200.00").first).to_be_visible(timeout=15000)
    print("expense saved and visible on detail")

    # ---- assistant: settle proposal must wait for user confirmation ----
    pg.goto(APP + "/#/assistant", wait_until="networkidle")
    pg.fill("input[placeholder='问问你的账本…']", "帮我和小红结一下账")
    pg.press("input[placeholder='问问你的账本…']", "Enter")
    pg.wait_for_selector("text=结算确认", timeout=30000)
    print("settle confirmation card shown")

    pg.screenshot(path="/tmp/aa-assistant-settle.png", full_page=True)

    pg.click("button:has-text('确认结算')")
    pg.wait_for_selector("text=已记录这笔结算", timeout=15000)
    print("settlement recorded after user confirm")

    b.close()
print("AI PARSE E2E PASSED ✓")
