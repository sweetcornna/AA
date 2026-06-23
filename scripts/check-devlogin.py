from playwright.sync_api import sync_playwright

APP = "http://localhost:1420"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 880}, device_scale_factor=2)
    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_selector("text=开发快捷登录", timeout=15000)
    pg.wait_for_timeout(500)
    pg.screenshot(path="/tmp/aa-login-dev.png")
    pg.click("text=以「阿明」登录")
    pg.wait_for_selector("text=我的圈子", timeout=15000)
    pg.wait_for_timeout(600)
    pg.screenshot(path="/tmp/aa-after-devlogin.png")
    b.close()
print("DEV LOGIN OK")
