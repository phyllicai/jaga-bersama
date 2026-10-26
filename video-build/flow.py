# End-to-end browser check of the static demo (also the basis for the video recording).
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8818/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(1000)
        await pg.click('text=Hakim: 中文'); await pg.wait_for_timeout(500)
        await pg.click('text=Settle this month'); await pg.wait_for_timeout(500)
        async def approve(i, who):
            sel = (await pg.query_selector_all('[data-who]'))[i]
            pid = await sel.get_attribute('data-who')
            await sel.select_option(who)
            await pg.click(f'[data-approve="{pid}"]'); await pg.wait_for_timeout(400)
        pg.set_default_timeout(5000)
        await approve(0, 'aisyah')  # Farid's invoice; Hakim pays by Checkout instead
        st = await pg.evaluate("window.JB_API('GET','/api/state')")
        print('invoices', [(i['memberId'], i['status'], i['due']) for i in st['invoices']])
        await pg.click('[data-simpay]'); await pg.wait_for_timeout(500)
        await pg.click('[data-checkout]'); await pg.wait_for_timeout(400)
        await pg.click('#co-pay'); await pg.wait_for_timeout(700)
        st = await pg.evaluate("window.JB_API('GET','/api/state')")
        print('fund', st['fundBalance'], 'invoices', [(i['memberId'], i['status']) for i in st['invoices']], 'orders', [(o['memberId'], o['status']) for o in st['orders']])
        await approve(0, 'farid'); await approve(0, 'hakim')
        st = await pg.evaluate("window.JB_API('GET','/api/state')")
        print('payouts', [(x['memberId'], x['status']) for x in st['payouts']], 'props', [(x['type'], x['status'], x.get('error')) for x in st['proposals']])
        await pg.click('text=Who hasn\'t paid?'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='/tmp/flow.png', full_page=True)
        print('errors', errs)
        await b.close()
asyncio.run(main())
