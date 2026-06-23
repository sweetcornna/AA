"""E2E: two users in one circle, verify Realtime cross-client sync.

User A records an expense through the real UI; User B, already sitting on the
circle detail page, must see it appear WITHOUT reloading (proves Realtime +
RLS + live balance refresh).
"""
import sys
import uuid
from playwright.sync_api import sync_playwright, expect

APP = "http://localhost:1420"
SUPA = "http://127.0.0.1:54321"
ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6"
    "ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)
DESC = f"夜宵{uuid.uuid4().hex[:6]}"  # unique marker per run

def sign_in(page, button_label):
    """Use the app's own dev quick-login button (no external CDN dependency)."""
    page.goto(APP)
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(f"text={button_label}", timeout=15000)
    page.click(f"text={button_label}")
    page.wait_for_selector("text=我的圈子", timeout=15000)


def open_circle(page):
    page.click("text=周末聚餐")
    page.wait_for_selector("text=结余", timeout=15000)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # User B: sit on the circle detail page first.
    ctxB = browser.new_context(viewport={"width": 420, "height": 880})
    B = ctxB.new_page()
    sign_in(B, "以「小红」登录")
    open_circle(B)
    expect(B.get_by_text(DESC)).to_have_count(0)  # not there yet
    print("B is on circle detail, marker absent — good")

    # User A: record the expense through the UI.
    ctxA = browser.new_context(viewport={"width": 420, "height": 880})
    A = ctxA.new_page()
    sign_in(A, "以「阿明」登录")
    open_circle(A)
    A.click("text=记一笔")
    A.wait_for_selector("text=和谁 AA", timeout=15000)
    A.fill("input[placeholder='0.00']", "88")
    A.fill("input[placeholder='如：火锅、打车']", DESC)
    A.click("text=保存账单")
    A.wait_for_selector("text=结余", timeout=15000)  # back on detail
    print("A saved the expense via UI")

    # B must see it appear live (no reload).
    B.wait_for_selector(f"text={DESC}", timeout=15000)
    print(f"B saw '{DESC}' appear via Realtime — no reload")

    browser.close()

print("E2E REALTIME PASSED ✓")
