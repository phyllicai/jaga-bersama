# Drives the static demo (docs/) and records it; writes timeline.json with when each narration segment starts.
import json, time, sys, subprocess
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8818/'
segs = {s['id']: s for s in json.load(open('segments.json'))}
for s in segs.values():
    s['dur'] = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f"{s['id']}.mp3"], capture_output=True, text=True).stdout)
timeline = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}, record_video_dir='raw', record_video_size={'width': 1280, 'height': 720})
    pg = ctx.new_page(); T0 = time.time()
    pg.goto(URL + '?empty'); pg.wait_for_selector('.chip'); pg.wait_for_timeout(500)
    def seg(id):
        st = time.time(); timeline.append({'id': id, 't': st - T0}); return st + segs[id]['dur'] + 0.4
    def until(t):
        r = t - time.time()
        if r > 0: pg.wait_for_timeout(int(r * 1000))
    def scroll(sel, block='start'):
        pg.evaluate(f"document.querySelector('{sel}').scrollIntoView({{behavior:'smooth', block:'{block}'}})"); pg.wait_for_timeout(900)
    def chip(label, wait=1800):
        pg.click(f'.chip:has-text("{label}")'); pg.wait_for_timeout(wait)
    def approve(who, idx=0):
        sel = pg.query_selector_all('[data-who]')[idx]; pid = sel.get_attribute('data-who')
        sel.select_option(who); pg.wait_for_timeout(700); pg.click(f'[data-approve="{pid}"]'); pg.wait_for_timeout(1400)

    end = seg('intro'); pg.wait_for_timeout(12000); pg.hover('#text'); until(end)
    end = seg('chat')
    chip('Aisyah: clinic', 3500); chip('Farid: supplies', 3000); chip('Hakim: physio', 2500); chip('Hakim: 中文', 2500)
    scroll('#ledger', 'center'); until(end)
    end = seg('split'); scroll('#stats', 'start'); pg.wait_for_timeout(2500); pg.hover('#split'); until(end)
    pg.screenshot(path='../screenshot.png')
    end = seg('plan'); scroll('body'); chip('Settle this month', 2500); scroll('#props-card', 'start'); until(end)
    end = seg('paypal')
    approve('aisyah'); scroll('#pp', 'center'); pg.wait_for_timeout(4500)
    pg.click('[data-simpay]'); pg.wait_for_timeout(5000)
    scroll('#split', 'center'); pg.wait_for_timeout(1500)
    pg.click('[data-checkout="hakim"]'); pg.wait_for_timeout(3500); pg.click('#co-pay'); pg.wait_for_timeout(2500)
    scroll('#props-card', 'start'); until(end)
    end = seg('payout')
    approve('farid'); approve('hakim'); pg.wait_for_timeout(1500)
    scroll('#pp', 'center'); pg.wait_for_timeout(3000); scroll('#ledger', 'start'); pg.wait_for_timeout(2500)
    scroll('body'); chip("Who hasn", 2000); until(end)
    end = seg('trust')
    pg.evaluate("document.querySelector('details').open = true"); scroll('details', 'start'); pg.wait_for_timeout(9000)
    pg.evaluate("window.scrollBy({top: 300, behavior: 'smooth'})"); until(end)
    end = seg('outro'); scroll('body'); pg.wait_for_timeout(1000)
    pg.set_viewport_size({'width': 420, 'height': 720}); pg.wait_for_timeout(3500); pg.evaluate("window.scrollBy({top: 700, behavior: 'smooth'})"); until(end)
    pg.set_viewport_size({'width': 1280, 'height': 720}); pg.wait_for_timeout(300)
    total = time.time() - T0
    vid = pg.video.path(); ctx.close(); b.close()
json.dump({'timeline': timeline, 'total': total, 'video': str(vid)}, open('timeline.json', 'w'), indent=1)
print(json.dumps(timeline), total, vid)
