"""Are you on the tree?" offer (2026-11-22): a relative tapped "I'm not in the tree yet", never finished saving, and on
the next visit had no intro and no list. The offer stays until the device has a saved person.
Needs a fresh apps-script/test/server.js on 8787 and the site on 8000 (see e2e.py). Run: python3 apps-script/test/e2e_mebar.py"""
import asyncio, json, urllib.request, sys
from playwright.async_api import async_playwright
API='http://localhost:8787'; SITE='http://127.0.0.1:8000'; OUT='/home/claude/ptest/mebar_'
def post(body):
    r=urllib.request.Request(API, data=json.dumps(body).encode(), headers={'Content-Type':'text/plain'}); return json.loads(urllib.request.urlopen(r).read())
def rows(tab):
    d=json.loads(urllib.request.urlopen(API+'/__sheet').read())[tab]; h=d[0]; return [dict(zip(h,r)) for r in d[1:]]
key=urllib.request.urlopen(API+'/__key').read().decode()
r=post({'action':'submit','token':'ownertokenownertokenowner','key':key,'items':[
 {'kind':'person','ref':'new:me','data':{'first_name':'Jonny','birth_surname':'Ruzicka','living':'living'}},
 {'kind':'person','ref':'new:d','data':{'first_name':'Debby','birth_surname':'Borders','living':'deceased'}},
 {'kind':'relationship','type':'parent_child','a':'new:d','b':'new:me'},
 {'kind':'claim','person':'new:me'}]})
ME=r['ids']['new:me']; D=r['ids']['new:d']
fails=[]
def check(n, ok, info=''):
    print(('  ok  ' if ok else '  FAIL ')+n+('' if ok else '  '+str(info)))
    if not ok: fails.append(n)
async def ctx(b, tok, w=390, h=844, extra=''):
    c=await b.new_context(viewport={'width':w,'height':h})
    await c.add_init_script(f"if (!localStorage.getItem('roots_token')) localStorage.setItem('roots_token','{tok}');{extra}")
    pg=await c.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return pg, errs
bar = lambda pg: pg.is_visible('#meBar')
intro_on = lambda pg: pg.evaluate("document.querySelector('#intro').classList.contains('on')")
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        # ---- the reported case: picks "I'm not in the tree yet", backs out, comes back ----
        pg, errs = await ctx(b, 'cousinTokenCousinToken01')
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        check('first visit: intro shows, offer hidden behind it', await intro_on(pg) and not await bar(pg))
        await pg.click('#iNext'); await pg.wait_for_timeout(200); await pg.click('#iNext'); await pg.wait_for_timeout(300)
        await pg.click('#iList button[data-id="new"]'); await pg.wait_for_timeout(400)
        check('picker for closest relative opens', 'closest relative' in await pg.inner_text('#panel'))
        await pg.click('#pClose'); await pg.wait_for_timeout(400)
        check('backed out of the picker: offer shows', await bar(pg))
        await pg.screenshot(path=OUT+'phone.png')
        await pg.reload(); await pg.wait_for_timeout(2500)
        check('next visit: no intro, offer shows', not await intro_on(pg) and await bar(pg))
        await pg.click('#meNo'); await pg.wait_for_timeout(200)
        check('Not now hides it', not await bar(pg))
        await pg.reload(); await pg.wait_for_timeout(2500)
        check('back again on the next visit', await bar(pg))
        await pg.click('#meYes'); await pg.wait_for_timeout(400)
        check('Find me or add me opens "Which one is you?"', await intro_on(pg) and 'Which one is you' in await pg.inner_text('#intro') and not await bar(pg))
        check('list offers "I\'m not in the tree yet"', await pg.locator('#iList button[data-id="new"]').count() == 1)
        await pg.click('#iList button[data-id="new"]'); await pg.wait_for_timeout(400)
        await pg.click(f'#qList button[data-id="{ME}"]'); await pg.wait_for_timeout(400)
        check('add yourself form opens', 'Add yourself' in await pg.inner_text('#panel'))
        await pg.fill('#fFirst', 'Tyler'); await pg.fill('#fLast', 'Hauptfleisch')
        await pg.click('#pSave'); await pg.wait_for_timeout(2000)
        check('saved: thank-you', await pg.is_visible('#thanks'))
        await pg.click('#thanksBack'); await pg.wait_for_timeout(2200)
        check('saved: offer gone', not await bar(pg))
        ty=[x for x in rows('People') if x['first_name']=='Tyler']
        cl=[x for x in rows('Contributors') if x['person_id']==(ty[0]['id'] if ty else '-')]
        check('Sheet: Tyler pending, with his claim', len(ty)==1 and ty[0]['status']=='pending' and len(cl)==1, (ty, cl))
        await pg.reload(); await pg.wait_for_timeout(2500)
        check('next visit after saving: no offer', not await bar(pg))
        check('no page errors (cousin)', not errs, errs)
        # ---- someone who is already there: That's me from the offer ----
        pg, errs = await ctx(b, 'auntTokenAuntTokenAunt01', 1280, 800, "localStorage.setItem('roots_intro_seen','1');")
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        check('wide screen: offer shows for a device that skipped', await bar(pg))
        await pg.screenshot(path=OUT+'wide.png')
        box=await pg.locator('#meBar').bounding_box(); top=await pg.locator('.topbar').bounding_box()
        check('offer sits below the top bar', box and top and box['y'] >= top['y']+top['height']-1, (box, top))
        await pg.click('#meYes'); await pg.wait_for_timeout(400)
        await pg.click(f'#iList button[data-id="{ME}"]'); await pg.wait_for_timeout(1800)
        check('That\'s me: offer gone', not await bar(pg))
        check('no page errors (claim)', not errs, errs)
        # ---- owner mode never sees it ----
        pg, errs = await ctx(b, 'ownertokenownertokenowner', extra=f"localStorage.setItem('roots_intro_seen','1'); localStorage.setItem('roots_admin_key','{key}');")
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        check('owner mode: no offer', not await bar(pg))
        await b.close()
    print('\n%d failed' % len(fails) if fails else '\nall passed'); sys.exit(1 if fails else 0)
asyncio.run(main())
