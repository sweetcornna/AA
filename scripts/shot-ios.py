from playwright.sync_api import sync_playwright

APP = "http://localhost:1420"


def shot(pg, path):
    pg.wait_for_timeout(700)
    pg.screenshot(path=path, full_page=True)
    print("shot", path)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)

    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_timeout(1200)
    pg.wait_for_selector("text=以「阿明」登录", timeout=20000)
    shot(pg, "/tmp/i-login.png")

    pg.goto(APP + "/#/register", wait_until="networkidle")
    pg.wait_for_selector("text=创建账号", timeout=15000)
    shot(pg, "/tmp/i-register.png")

    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_selector("text=以「阿明」登录", timeout=15000)
    pg.click("text=以「阿明」登录")
    pg.wait_for_selector("h1:text-is('圈子')", timeout=25000)
    shot(pg, "/tmp/i-circles.png")

    pg.goto(APP + "/#/activity", wait_until="networkidle")
    pg.wait_for_selector("h1:text-is('动态')", timeout=15000)
    shot(pg, "/tmp/i-activity.png")

    pg.goto(APP + "/#/assistant", wait_until="networkidle")
    pg.wait_for_selector("h1:text-is('助手')", timeout=15000)
    shot(pg, "/tmp/i-assistant.png")

    pg.goto(APP + "/#/profile", wait_until="networkidle")
    pg.wait_for_selector("text=个人资料", timeout=15000)
    shot(pg, "/tmp/i-profile.png")

    pg.goto(APP + "/", wait_until="networkidle")
    pg.wait_for_selector("text=周末聚餐", timeout=15000)
    pg.click("text=周末聚餐")
    pg.wait_for_selector("text=成员结余", timeout=15000)
    shot(pg, "/tmp/i-detail.png")

    pg.get_by_role("button", name="记一笔", exact=True).first.click()
    pg.wait_for_selector("text=如何分摊", timeout=15000)
    pg.fill("input[placeholder='0']", "120")
    shot(pg, "/tmp/i-add.png")

    b.close()
print("IOS SHOTS DONE")
