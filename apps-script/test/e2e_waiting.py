"""Waiting count on the owner bar's Approvals link (2026-11-22): owner mode on desktop and phone shows "N waiting", a relative never sees the bar.
Needs a fresh apps-script/test/server.js on 8787 and the site on 8000 (see e2e.py). Run: python3 apps-script/test/e2e_waiting.py"""
import asyncio, json, urllib.request
from playwright.async_api import async_playwright
API='http://localhost:8787'; SITE='http://127.0.0.1:8000'
def post(b): return json.load(urllib.request.urlopen(urllib.request.Request(API, json.dumps(b).encode(), {'Content-Type':'text/plain'})))
KEY=urllib.request.urlopen(API+'/__key').read().decode()
ok=lambda c,m: print(('  ok  ' if c else 'FAIL  ')+m)
async def main():
    # Owner seeds one person; a relative sends two pending ones.
    r=post({'action':'submit','token':'ownertokenownertokenowner','key':KEY,'items':[{'kind':'person','ref':'new:a','data':{'first_name':'Ann','birth_surname':'Hale','living':'deceased'}}]})
    tree=post({'action':'tree','token':'x'*24}); pid=tree['people'][0]['id']
    r2=post({'action':'submit','token':'relativetokenrelativetoken','display_name':'Cousin','items':[{'kind':'person','ref':'new:b','data':{'first_name':'Bea','birth_surname':'Hale','living':'deceased'}},{'kind':'relationship','type':'parent_child','a':pid,'b':'new:b'}]})
    print('relative submit ok:', r2.get('ok'), r2.get('error'))
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for name, vp in [('desk',{'width':1280,'height':800}),('phone',{'width':390,'height':844})]:
            c=await b.new_context(viewport=vp, device_scale_factor=2 if name=='phone' else 1)
            await c.add_init_script(f"localStorage.setItem('roots_admin_key',{json.dumps(KEY)});localStorage.setItem('roots_intro_seen','1')")
            pg=await c.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
            await pg.goto(f'{SITE}/index.html?api={API}')
            await pg.wait_for_selector('#ownerBar .qbadge', timeout=20000)
            t=await pg.inner_text('#ownerBar a'); ok('waiting' in t and any(ch.isdigit() for ch in t), f'{name}: link reads {t!r}')
            await pg.screenshot(path=f'/tmp/roots_wait_{name}.png')
            ok(not errs, f'{name}: no page errors {errs}')
            await c.close()
        # relative never sees it
        c=await b.new_context(); pg=await c.new_page()
        await c.add_init_script("localStorage.setItem('roots_intro_seen','1')")
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(3000)
        ok(await pg.locator('#ownerBar').is_hidden(), 'relative: no owner bar')
        await b.close()
asyncio.run(main())
