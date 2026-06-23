from playwright.sync_api import sync_playwright

APP = "http://localhost:1420"
SUPA = "http://127.0.0.1:54321"
ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6"
    "ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)
SIGNIN = """async ([url, key]) => {
  const m = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = m.createClient(url, key);
  const { error } = await sb.auth.signInWithPassword({ email: 'demo@aa.local', password: 'Password123!' });
  return error ? ('ERR ' + error.message) : 'ok';
}"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2)

    pg.goto(APP, wait_until="networkidle")
    pg.wait_for_selector("text=密码登录", timeout=15000)
    pg.wait_for_timeout(500)
    pg.screenshot(path="/tmp/aa-r-login.png")

    pg.goto(APP + "/#/register", wait_until="networkidle")
    pg.wait_for_selector("text=创建账号", timeout=15000)
    pg.wait_for_timeout(400)
    pg.screenshot(path="/tmp/aa-r-register.png", full_page=True)

    pg.goto(APP, wait_until="networkidle")
    print("signin:", pg.evaluate(SIGNIN, [SUPA, ANON]))
    pg.wait_for_timeout(500)
    pg.reload()
    pg.wait_for_load_state("networkidle")
    pg.wait_for_selector("text=我的圈子", timeout=15000)
    pg.wait_for_timeout(700)
    pg.screenshot(path="/tmp/aa-r-circles.png", full_page=True)

    pg.click("text=周末聚餐")
    pg.wait_for_selector("text=结余", timeout=15000)
    pg.wait_for_timeout(800)
    pg.screenshot(path="/tmp/aa-r-detail.png", full_page=True)

    pg.click("text=+ 记一笔")
    pg.wait_for_selector("text=和谁 AA", timeout=15000)
    pg.fill("input[placeholder='0.00']", "120")
    pg.fill("input[placeholder='如：火锅、打车']", "奶茶")
    pg.wait_for_timeout(500)
    pg.screenshot(path="/tmp/aa-r-add.png", full_page=True)

    pg.goto(APP + "/#/profile", wait_until="networkidle")
    pg.wait_for_selector("text=个人资料", timeout=15000)
    pg.wait_for_timeout(500)
    pg.screenshot(path="/tmp/aa-r-profile.png", full_page=True)

    b.close()
print("ALL SHOTS DONE")
