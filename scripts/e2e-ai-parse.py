from playwright.sync_api import sync_playwright, expect

APP = "http://localhost:1420"
SENTENCE = "我和小红吃火锅 200 平摊"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2)

    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_selector("text=以「阿明」登录", timeout=15000)
    pg.click("text=以「阿明」登录")
    pg.wait_for_selector("text=我的圈子", timeout=15000)

    pg.click("text=周末聚餐")
    pg.wait_for_selector("text=结余", timeout=15000)

    pg.click("text=+ 记一笔")
    pg.wait_for_selector("text=一句话记账", timeout=15000)

    pg.fill("input[placeholder*='昨晚和小红']", SENTENCE)
    pg.click("text=AI 解析")
    # cold start: edge runtime + module download can take a while on first run
    pg.wait_for_selector("text=已由 AI 预填", timeout=90000)
    print("parsed + prefilled")

    amount = pg.input_value("input[placeholder='0.00']")
    print("amount field =", amount)
    assert amount == "200", f"expected amount 200, got {amount!r}"

    pg.screenshot(path="/tmp/aa-ai-prefilled.png", full_page=True)

    pg.click("text=保存账单")
    pg.wait_for_selector("text=结余", timeout=15000)  # back on detail
    expect(pg.get_by_text("¥200.00").first).to_be_visible(timeout=15000)
    print("expense saved and visible on detail")

    b.close()
print("AI PARSE E2E PASSED ✓")
