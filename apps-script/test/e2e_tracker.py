"""The tracker and staying in touch (Jonny, 2026-11-24).
Tree page: the first load of a visit is logged (whose link, phone or computer, first time), a reopening within 30 minutes
isn't, owner mode and ?notrack never are; Help and the lock box say so. "Stay in touch?" right after That's me and on the
thank-you page after adding yourself, never on "Which one is you?"; a bad address is caught; Skip isn't asked again; the
own card shows the address with Change and Remove. Approvals page: Visits (tiles, chart, whose link, log), Activity
(one line per relative per day, what became of it), Contacts (one row per person, BCC for groups, Copy addresses).
Needs a fresh apps-script/test/server.js on 8787 and the site on 8000 (see e2e.py). Run: python3 apps-script/test/e2e_tracker.py"""
import asyncio, json, urllib.request, sys
from playwright.async_api import async_playwright
API='http://localhost:8787'; SITE='http://127.0.0.1:8000'; SHOT='/tmp/roots_trk_'
def post(body):
    r=urllib.request.Request(API, data=json.dumps(body).encode(), headers={'Content-Type':'text/plain'}); return json.loads(urllib.request.urlopen(r).read())
def rows(tab):
    d=json.loads(urllib.request.urlopen(API+'/__sheet').read()).get(tab) or [[]]; h=d[0]; return [dict(zip(h,r)) for r in d[1:]]
key=urllib.request.urlopen(API+'/__key').read().decode()
r=post({'action':'submit','token':'ownertokenownertokenowner','key':key,'items':[
 {'kind':'person','ref':'new:me','data':{'first_name':'Jonny','birth_surname':'Ruzicka','living':'living'}},
 {'kind':'person','ref':'new:b','data':{'first_name':'Barbara','birth_surname':'Hale','living':'living'}},
 {'kind':'person','ref':'new:t','data':{'first_name':'Tyler','birth_surname':'Isaacs','living':'living'}},
 {'kind':'person','ref':'new:g','data':{'first_name':'Walter','birth_surname':'Hale','living':'deceased'}},
 {'kind':'relationship','type':'parent_child','a':'new:g','b':'new:b'},
 {'kind':'relationship','type':'parent_child','a':'new:b','b':'new:t'},
 {'kind':'claim','person':'new:me'}]})
ME=r['ids']['new:me']; B=r['ids']['new:b']; T=r['ids']['new:t']
fails=[]
def check(n, ok, info=''):
    print(('  ok  ' if ok else '  FAIL ')+n+('' if ok else '  '+str(info)[:400]))
    if not ok: fails.append(n)
def contributor(tok): return next((x for x in rows('Contributors') if x['token']==tok), None)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        async def ctx(tok, w=390, h=844, extra='', mobile=True):
            c=await b.new_context(viewport={'width':w,'height':h}, is_mobile=mobile, has_touch=mobile,
                user_agent=('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' if mobile else None))
            await c.add_init_script(f"if (!localStorage.getItem('roots_token')) localStorage.setItem('roots_token','{tok}');{extra}")
            pg=await c.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); return c, pg, errs

        # ---- Tyler opens Barbara's link on his phone, first time ever ----
        c, pg, errs = await ctx('tylerTokenTylerToken0001')
        await pg.goto(f'{SITE}/index.html?api={API}&from={B}'); await pg.wait_for_timeout(2500)
        v=rows('Visits')
        check('first open is logged: Barbara\'s link, phone, iPhone Safari, first visit', len(v)==1 and v[0]['from']==B and v[0]['kind']=='phone' and v[0]['browser']=='iPhone Safari' and v[0]['first']=='yes', v)
        check('the log holds no device token', 'tylerToken' not in json.dumps(v))
        # Help says what's tracked
        await pg.click('#iNext'); await pg.wait_for_timeout(250)
        txt=await pg.inner_text('#intro')
        check('Help: says Jonny sees when the tree is opened and whose link', 'whose link it came from' in txt and 'Nothing else about your device' in txt, txt[-400:])
        await pg.click('#iNext'); await pg.wait_for_timeout(250)
        check('"Which one is you?" has no email box', await pg.locator('#intro #stayEmail').count()==0)
        # That's me, then Stay in touch
        await pg.fill('#iName','Tyler'); await pg.wait_for_timeout(200)
        await pg.click(f'#iList button[data-id="{T}"]'); await pg.wait_for_timeout(1500)
        check('Stay in touch? opens right after That\'s me', await pg.is_visible('#stayEmail') and 'Stay in touch?' in await pg.inner_text('#panel'))
        ptxt=await pg.inner_text('#panel')
        check('it says why, and who sees it', 'big news' in ptxt and 'something you added' in ptxt and 'Only Jonny sees it' in ptxt and 'never shown on the tree' in ptxt, ptxt)
        fs=await pg.evaluate("getComputedStyle(document.querySelector('#stayEmail')).fontSize")
        check('email box is 16 px (no iPhone zoom)', fs=='16px', fs)
        await pg.screenshot(path=SHOT+'stay_phone.png')
        await pg.click('#stayShare'); await pg.wait_for_timeout(200)
        check('empty: asks to type or Skip', 'Skip' in await pg.inner_text('#stayErr'))
        await pg.fill('#stayEmail','tyler at home'); await pg.click('#stayShare'); await pg.wait_for_timeout(200)
        check('bad address caught on the page', "doesn't look like" in await pg.inner_text('#stayErr'))
        await pg.fill('#stayEmail',' Tyler.Isaacs@Example.com '); await pg.click('#stayShare'); await pg.wait_for_timeout(1500)
        cr=contributor('tylerTokenTylerToken0001')
        check('saved to his Contributors row, lower case, with a date', cr and cr['email']=='tyler.isaacs@example.com' and cr['email_given_at'], cr)
        check('panel closed, thanks toast', not await pg.evaluate("document.querySelector('#panel').classList.contains('on')") and 'can reach you at' in await pg.inner_text('#toast'))
        # Reopen within 30 minutes: same visit
        await pg.reload(); await pg.wait_for_timeout(2500)
        check('reopening within 30 minutes is the same visit', len(rows('Visits'))==1, rows('Visits'))
        # His own card: the address, Change, Remove; public lock box carries the visit line
        await pg.evaluate(f"openPerson('{T}')"); await pg.wait_for_timeout(300)
        ctext=await pg.inner_text('#panel')
        check('own card: Jonny can reach you at the address', 'tyler.isaacs@example.com' in ctext and await pg.is_visible('#cChange') and await pg.is_visible('#cRemove'), ctext)
        check('own card lock box carries the visit line', 'whose link it came from' in ctext)
        await pg.evaluate(f"openPerson('{B}')"); await pg.wait_for_timeout(300)
        check('family-less view of someone else: no email box on their card', await pg.locator('#stayCard').count()==0)
        await pg.evaluate(f"openPerson('{T}')"); await pg.wait_for_timeout(300)
        await pg.click('#cChange'); await pg.wait_for_timeout(300)
        check('Change opens the form filled in, with Cancel', await pg.input_value('#stayEmail')=='tyler.isaacs@example.com' and (await pg.inner_text('#staySkip'))=='Cancel')
        await pg.fill('#stayEmail','tyler@example.org'); await pg.click('#stayShare'); await pg.wait_for_timeout(1500)
        check('changed', contributor('tylerTokenTylerToken0001')['email']=='tyler@example.org' and 'tyler@example.org' in await pg.inner_text('#panel'))
        await pg.click('#cRemove'); await pg.wait_for_timeout(200)
        check('Remove asks first', 'Remove your email?' in await pg.inner_text('#stayCard'))
        await pg.click('#cKeep'); await pg.wait_for_timeout(200)
        check('Keep leaves it', contributor('tylerTokenTylerToken0001')['email']=='tyler@example.org')
        await pg.click('#cRemove'); await pg.wait_for_timeout(200); await pg.click('#cRemoveYes'); await pg.wait_for_timeout(1500)
        cr=contributor('tylerTokenTylerToken0001')
        check('removed: both cells cleared, card offers to share again', cr['email']=='' and cr['email_given_at']=='' and await pg.is_visible('#cShare'), cr)
        await pg.click('#cShare'); await pg.fill('#stayEmail','tyler@example.org'); await pg.click('#stayShare'); await pg.wait_for_timeout(1500)
        check('shared again from the card', contributor('tylerTokenTylerToken0001')['email']=='tyler@example.org')
        check('Tyler: no page errors', not errs, errs)
        await c.close()

        # ---- Barbara: That's me, then Skip; never asked again on this device ----
        c, pg, errs = await ctx('barbTokenBarbToken000001', extra="localStorage.setItem('roots_intro_seen','1')")
        await pg.goto(f'{SITE}/index.html?api={API}&from={ME}'); await pg.wait_for_timeout(2500)
        check('a device that has seen the intro before isn\'t a first visit', rows('Visits')[-1]['first']=='' and rows('Visits')[-1]['from']==ME, rows('Visits')[-1])
        await pg.click('#meYes'); await pg.fill('#iName','Barb'); await pg.wait_for_timeout(200)
        await pg.click(f'#iList button[data-id="{B}"]'); await pg.wait_for_timeout(1500)
        await pg.click('#staySkip'); await pg.wait_for_timeout(300)
        check('Skip closes it, nothing saved', not await pg.evaluate("document.querySelector('#panel').classList.contains('on')") and contributor('barbTokenBarbToken000001')['email']=='')
        await pg.evaluate(f"openPerson('{B}')"); await pg.wait_for_timeout(300)
        check('after Skip her card keeps a quiet way back', await pg.is_visible('#cShare'))
        await pg.evaluate("closePanel(); claimMe(" + json.dumps(B) + ")"); await pg.wait_for_timeout(1500)
        check('not asked again on this device', await pg.locator('#panel #stayEmail').count()==0)
        check('Barbara: no page errors', not errs, errs)
        await c.close()

        # ---- Linda adds herself on a computer; the thank-you page asks ----
        c, pg, errs = await ctx('lindaTokenLindaToken0001', w=1280, h=800, mobile=False)
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        v=rows('Visits')[-1]
        check('computer visit with a plain link', v['kind']=='computer' and v['from']=='' and 'Chrome' in v['browser'], v)
        await pg.click('#iNext'); await pg.click('#iNext'); await pg.wait_for_timeout(200)
        await pg.fill('#iName','Linda Zed'); await pg.wait_for_timeout(200); await pg.click('#iAdd'); await pg.wait_for_timeout(400)
        await pg.fill('#qName','Barb'); await pg.click(f'#qList button[data-id="{B}"]'); await pg.wait_for_timeout(300)
        await pg.click('#fRel [data-v="other"]'); await pg.fill('#fHow','niece'); await pg.click('#pSave'); await pg.wait_for_timeout(2000)
        check('thank-you page asks Stay in touch?, above the review', await pg.is_visible('#thanksStay #stayEmail') and await pg.evaluate("document.querySelector('#thanksStay').compareDocumentPosition(document.querySelector('#thanksReview')) & 4"))
        await pg.screenshot(path=SHOT+'thanks_desk.png')
        await pg.fill('#thanksStay #stayEmail','linda@example.com'); await pg.click('#thanksStay #stayShare'); await pg.wait_for_timeout(1500)
        check('saved from the thank-you page, thanks in place', contributor('lindaTokenLindaToken0001')['email']=='linda@example.com' and 'linda@example.com' in await pg.inner_text('#thanksStay'))
        check('Linda: no page errors', not errs, errs)
        await c.close()

        # ---- owner mode and ?notrack: never logged; owner never asked for an email ----
        n=len(rows('Visits'))
        c, pg, errs = await ctx('ownertokenownertokenowner', w=1280, mobile=False, extra=f"localStorage.setItem('roots_admin_key',{json.dumps(key)});localStorage.setItem('roots_intro_seen','1')")
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        await pg.evaluate(f"openPerson('{ME}')"); await pg.wait_for_timeout(300)
        check('owner: not logged, no email box on his card', len(rows('Visits'))==n and await pg.locator('#stayCard').count()==0)
        await c.close()
        c, pg, errs = await ctx('claudeCheckToken00000001', extra="localStorage.setItem('roots_intro_seen','1')")
        await pg.goto(f'{SITE}/index.html?api={API}&notrack'); await pg.wait_for_timeout(2500)
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2000)
        check('?notrack keeps the device out for good', len(rows('Visits'))==n)
        await c.close()

        # ---- approvals page: Visits, Activity, Contacts ----
        for name, w in [('desk', 1280), ('phone', 390)]:
            c=await b.new_context(viewport={'width':w,'height':900}, permissions=['clipboard-read','clipboard-write'])
            await c.add_init_script(f"localStorage.setItem('roots_admin_key',{json.dumps(key)})")
            pg=await c.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(f'{SITE}/admin.html?api={API}'); await pg.wait_for_selector('#app:not([hidden])', timeout=20000)
            await pg.click('#tabVisits'); await pg.wait_for_selector('#visits .tile', timeout=15000)
            tiles=await pg.inner_text('#visits .tiles')
            check(f'{name}: tiles count 3 visits, 3 devices, 2 first-timers', tiles.split()[0]=='3' and '\n3\n' in '\n'+tiles and '2\nfirst-timers' in tiles, tiles)
            check(f'{name}: 30 bars in the chart', await pg.locator('#visits .vcol').count()==30)
            sender=await pg.inner_text('#visits .ttable')
            check(f'{name}: whose link: Barbara Hale, Jonny Ruzicka, plain link', 'Barbara Hale' in sender and 'Jonny Ruzicka' in sender and 'Plain link' in sender, sender)
            log=await pg.inner_text('#visits .vlog')
            check(f'{name}: log names them, says whose link and device', 'Tyler Isaacs (not confirmed yet)' in log and "Barbara Hale's link" in log and 'iPhone Safari' in log and 'first visit' in log.lower(), log)
            await pg.hover('#visits .vcol:last-child') if name=='desk' else await pg.click('#visits .vcol:last-child')
            check(f'{name}: a bar says its day and count', 'Today: 3 visits' in await pg.inner_text('#vTip'), await pg.inner_text('#vTip'))
            await pg.screenshot(path=SHOT+f'visits_{name}.png', full_page=True)
            await pg.click('#tabActivity'); await pg.wait_for_selector('#activity .arow', timeout=15000)
            act=await pg.inner_text('#activity')
            check(f'{name}: activity: Linda sent a person and said who she is, waiting; owner hidden', 'Linda Zed (not confirmed yet)' in act and '1 person' in act and 'said who they are' in act and '1 waiting' in act and 'You' not in act.split('Include')[1], act[:600])
            await pg.click('#actMine'); await pg.wait_for_timeout(200)
            act=await pg.inner_text('#activity')
            check(f'{name}: Include what you added: your own line too', 'You' in act and '4 people' in act and '6 approved' in act, act[:600])
            await pg.click('#tabContacts'); await pg.wait_for_selector('#contacts .clist', timeout=15000)
            con=await pg.inner_text('#contacts')
            check(f'{name}: contacts: Tyler and Linda, not Barbara (skipped)', 'tyler@example.org' in con and 'linda@example.com' in con and 'Barbara' not in con, con)
            check(f'{name}: everyone ticked, button says so', (await pg.inner_text('#cWrite'))=='Write email to everyone')
            check(f'{name}: group email is BCC, addresses readable', await pg.evaluate("contactHref(['a@x.com','b+t@y.org'])")=='mailto:?bcc=a@x.com,b+t@y.org')
            check(f'{name}: one person is plain To', await pg.evaluate("contactHref(['a@x.com'])")=='mailto:a@x.com')
            await pg.locator('#contacts [data-c]').first.uncheck(); await pg.wait_for_timeout(100)
            check(f'{name}: unticking one: Write email to 1, Everyone box half', (await pg.inner_text('#cWrite'))=='Write email to 1' and await pg.evaluate("document.querySelector('#cAll').indeterminate"))
            await pg.click('#cCopy'); await pg.wait_for_timeout(300)
            clip=await pg.evaluate("navigator.clipboard.readText()")
            check(f'{name}: Copy addresses copies only the ticked ones', clip.count('@')==1, clip)
            await pg.screenshot(path=SHOT+f'contacts_{name}.png', full_page=True)
            check(f'{name}: approvals page: no page errors', not errs, errs)
            await c.close()
        await b.close()
    print(f'\n{"FAILED: "+str(len(fails)) if fails else "all passed"}')
    if fails: sys.exit(1)
asyncio.run(main())
