from playwright.sync_api import sync_playwright

APP = "http://localhost:1420"
SUPA = "http://127.0.0.1:54321"
ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6"
    "ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)
EMAIL = "demo@aa.local"
PW = "Password123!"

# Sign in inside the page so the session is written to the SAME localStorage key
# the app's supabase client uses (derived from the URL), then reload to pick it up.
SIGNIN_JS = """async () => {
  const m = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = m.createClient(%r, %r);
  const { error } = await sb.auth.signInWithPassword({ email: %r, password: %r });
  return error ? ('ERR: ' + error.message) : 'ok';
}""" % (SUPA, ANON, EMAIL, PW)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 420, "height": 880}, device_scale_factor=2)

    page.goto(APP)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(600)
    page.screenshot(path="/tmp/aa-1-login.png")
    print("login screenshot done")

    print("signin:", page.evaluate(SIGNIN_JS))
    page.wait_for_timeout(600)
    page.reload()
    page.wait_for_load_state("networkidle")

    page.wait_for_selector("text=我的圈子", timeout=15000)
    page.wait_for_timeout(600)
    page.screenshot(path="/tmp/aa-2-circles.png")
    print("circles screenshot done")

    page.click("text=周末聚餐")
    page.wait_for_selector("text=结余", timeout=15000)
    page.wait_for_timeout(800)
    page.screenshot(path="/tmp/aa-3-detail.png", full_page=True)
    print("detail screenshot done")

    page.click("text=记一笔")
    page.wait_for_selector("text=和谁 AA", timeout=15000)
    page.wait_for_timeout(600)
    page.screenshot(path="/tmp/aa-4-add.png", full_page=True)
    print("add-expense screenshot done")

    browser.close()
print("ALL SCREENSHOTS DONE")
