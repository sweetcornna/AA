from playwright.sync_api import sync_playwright

APP = "http://localhost:1420"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2)

    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_timeout(1500)
    pg.wait_for_selector("text=以「阿明」登录", timeout=20000)
    pg.click("text=以「阿明」登录", timeout=8000)
    pg.wait_for_selector("h1:has-text('我的圈子')", timeout=25000)
    pg.wait_for_timeout(1200)
    pg.screenshot(path="/tmp/g-home.png", full_page=True)
    print("home shot")

    pg.click("text=动态")
    pg.wait_for_selector("text=你所有圈子的最新", timeout=15000)
    pg.wait_for_timeout(900)
    pg.screenshot(path="/tmp/g-activity.png", full_page=True)
    print("activity shot")

    pg.click("text=圈子")
    pg.wait_for_selector("text=我的圈子", timeout=15000)
    pg.click("text=周末聚餐")
    pg.wait_for_selector("text=结余", timeout=15000)
    pg.wait_for_timeout(900)
    pg.screenshot(path="/tmp/g-detail.png", full_page=True)
    print("detail shot")

    b.close()
print("GLASS SHOTS DONE")
