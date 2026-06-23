from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 980}, device_scale_factor=2)
    pg.goto("http://localhost:1420", wait_until="networkidle")
    pg.wait_for_selector("text=密码登录", timeout=15000)
    pg.wait_for_timeout(400)
    pg.screenshot(path="/tmp/aa-login-pw.png")
    b.close()
print("ok")
