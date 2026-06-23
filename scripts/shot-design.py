import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/aa-design.png"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1360, "height": 1000}, device_scale_factor=2)
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1200)  # let webfonts settle
    pg.screenshot(path=OUT, full_page=True)
    b.close()
print("saved", OUT)
