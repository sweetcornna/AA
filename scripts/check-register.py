import uuid
from playwright.sync_api import sync_playwright, expect

APP = "http://localhost:1420"
EMAIL = f"reg-{uuid.uuid4().hex[:8]}@aa.local"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 980}, device_scale_factor=2)
    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_selector("text=密码登录", timeout=15000)

    # go to register
    pg.click("text=还没有账号？去注册")
    pg.wait_for_selector("text=创建账号", timeout=15000)
    pg.wait_for_timeout(400)
    pg.screenshot(path="/tmp/aa-register.png")
    print("register page shown")

    # validation: mismatched passwords
    pg.fill("input[placeholder='圈子里显示的名字']", "验收用户")
    pg.fill("input[placeholder='you@example.com']", EMAIL)
    pg.fill("input[placeholder='+8613800138000']", "+8613900001111")
    pg.fill("input[placeholder='至少 6 位']", "abc123")
    pg.fill("input[placeholder='再次输入密码']", "different")
    pg.click("text=注册并登录")
    expect(pg.get_by_text("两次输入的密码不一致")).to_be_visible(timeout=5000)
    print("validation: password mismatch caught")

    # fix and submit
    pg.fill("input[placeholder='再次输入密码']", "abc123")
    pg.click("text=注册并登录")
    pg.wait_for_selector("text=我的圈子", timeout=15000)
    print(f"registered + logged in as {EMAIL}")

    b.close()
print("REGISTER FLOW PASSED ✓")
