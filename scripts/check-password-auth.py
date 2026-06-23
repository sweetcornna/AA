import uuid
from playwright.sync_api import sync_playwright

APP = "http://localhost:1420"
EMAIL = f"pw-{uuid.uuid4().hex[:8]}@aa.local"
PW = "secret123"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 880}, device_scale_factor=2)
    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_selector("text=密码登录", timeout=15000)

    # register
    pg.click("text=还没有账号？去注册")
    pg.fill("input[placeholder='圈子里显示的名字']", "验收测试")
    pg.fill("input[placeholder='you@example.com']", EMAIL)
    pg.fill("input[placeholder='至少 6 位']", PW)
    pg.click("text=注册并登录")
    pg.wait_for_selector("text=我的圈子", timeout=15000)
    print(f"register -> logged in as {EMAIL}")
    pg.screenshot(path="/tmp/aa-pw-after-register.png")

    # sign out
    pg.click("text=退出登录")
    pg.wait_for_selector("text=密码登录", timeout=15000)
    print("signed out")

    # sign in with password
    pg.fill("input[placeholder='you@example.com']", EMAIL)
    pg.fill("input[placeholder='密码']", PW)
    pg.get_by_role("button", name="登录", exact=True).click()
    pg.wait_for_selector("text=我的圈子", timeout=15000)
    print("password sign-in OK")

    b.close()
print("PASSWORD AUTH PASSED ✓")
