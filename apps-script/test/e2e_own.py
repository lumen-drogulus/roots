"""A relative's own unconfirmed work: they see it, fix it, take it back (feedback from Jonny's son and Bo, 2026-11-21).
Needs a fresh apps-script/test/server.js on 8787 and the site on 8000 (see e2e.py). Run: python3 apps-script/test/e2e_own.py"""
import asyncio, json, urllib.request, sys
from playwright.async_api import async_playwright
API='http://localhost:8787'; SITE='http://127.0.0.1:8000'; OUT='/home/claude/ptest/own_'
def post(body):
    r=urllib.request.Request(API, data=json.dumps(body).encode(), headers={'Content-Type':'text/plain'}); return json.loads(urllib.request.urlopen(r).read())
def sheet(): return json.loads(urllib.request.urlopen(API+'/__sheet').read())
def rows(tab):
    d=sheet()[tab]; h=d[0]; return [dict(zip(h,r)) for r in d[1:]]
key=urllib.request.urlopen(API+'/__key').read().decode()
r=post({'action':'submit','token':'ownertokenownertokenowner','key':key,'items':[
 {'kind':'person','ref':'new:me','data':{'first_name':'Jonny','birth_surname':'Ruzicka','living':'living'}},
 {'kind':'person','ref':'new:k','data':{'first_name':'Kayla','birth_surname':'Vorhees','living':'living'}},
 {'kind':'person','ref':'new:s','data':{'first_name':'Sonny','birth_surname':'Ruzicka','living':'living'}},
 {'kind':'person','ref':'new:b','data':{'first_name':'Bo','birth_surname':'Ross','living':'living'}},
 {'kind':'person','ref':'new:u','data':{'is_placeholder':True}},
 {'kind':'relationship','type':'parent_child','a':'new:me','b':'new:s'},
 {'kind':'relationship','type':'parent_child','a':'new:k','b':'new:s'},
 {'kind':'relationship','type':'partner','a':'new:s','b':'new:b','subtype':'married'},
 {'kind':'relationship','type':'parent_child','a':'new:u','b':'new:k'},
 {'kind':'claim','person':'new:me'}]})
I=r['ids']; U=I['new:u']; S=I['new:s']; B=I['new:b']; K=I['new:k']
fails=[]
def check(n, ok, info=''):
    print(('  ok  ' if ok else '  FAIL ')+n+('' if ok else '  '+str(info)))
    if not ok: fails.append(n)
async def page(b, tok, frm):
    c=await b.new_context(viewport={'width':390,'height':844})
    await c.add_init_script(f"localStorage.setItem('roots_token','{tok}'); localStorage.setItem('roots_intro_done','1')")
    pg=await c.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(f'{SITE}/index.html?api={API}&nointro&from={frm}'); await pg.wait_for_timeout(2200)
    return pg, errs
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        # ---------------- the son: fills in Kayla's Unknown parent ----------------
        pg, errs = await page(b, 'sonTokenSonTokenSonToken1', S)
        await pg.evaluate(f"openPerson('{U}')"); await pg.wait_for_timeout(300)
        await pg.click('#pEdit'); await pg.wait_for_timeout(300)
        await pg.fill('#fFirst','Freddy'); await pg.fill('#fLast','vorhees'); await pg.fill('#fSource','from grandson')
        await pg.click('#pSave'); await pg.wait_for_timeout(1800)
        check('son: thank-you mentions Your edit', 'Your edit' in await pg.inner_text('#thanks'))
        await pg.click('#thanksBack'); await pg.wait_for_timeout(2200)
        card = pg.locator(f'.card[data-id="{U}"]')
        if not await card.count(): card = pg.locator('.card', has_text='Freddy')
        txt = await card.first.inner_text() if await card.count() else ''
        check('son: card now says Freddy, tagged Your edit', 'Freddy' in txt and 'your edit' in txt.lower(), txt)
        await pg.screenshot(path=OUT+'son_tree.png')
        await pg.evaluate(f"openPerson('{U}')"); await pg.wait_for_timeout(300)
        body = await pg.inner_text('#panel')
        check('son: card says waiting for Jonny, with Take back', 'Waiting for Jonny' in body and 'Take back' in body, body)
        check('son: shown as not sure, not living', 'Living' not in (await pg.inner_text('#panel .head .sub')), await pg.inner_text('#panel .head .sub'))
        await pg.screenshot(path=OUT+'son_card.png')
        # re-edit: Frederica, nickname Freddy -> replaces, doesn't stack
        await pg.click('#pEdit'); await pg.wait_for_timeout(300)
        check('son: edit form shows his version', await pg.input_value('#fFirst') == 'Freddy')
        await pg.fill('#fFirst','Frederica'); await pg.fill('#fNick','Freddy'); await pg.fill('#fLast','Vorhees')
        await pg.click('#pSave'); await pg.wait_for_timeout(1800); await pg.click('#thanksBack'); await pg.wait_for_timeout(2200)
        sug=[x for x in rows('Suggestions') if x['submitted_by'] and x['target_id']==U]
        live=[x for x in sug if x['status']=='pending']; wd=[x for x in sug if x['status']=='withdrawn']
        check('son: re-edit replaced his earlier changes', len(wd)==3 and sorted(x['field'] for x in live)==['birth_surname','first_name','is_placeholder','nicknames'], [(x['field'],x['status'],x['proposed_value']) for x in sug])
        # take back
        await pg.evaluate(f"openPerson('{U}')"); await pg.wait_for_timeout(300)
        await pg.locator('[data-tb="0"]').click(); await pg.wait_for_timeout(200)
        await pg.screenshot(path=OUT+'son_confirm.png')
        await pg.locator('[data-go]').click(); await pg.wait_for_timeout(2500)
        check('son: take back returns the card to Unknown', await pg.evaluate(f"P('{U}').placeholder && !P('{U}').edits"))
        check('son: no page errors', not errs, errs)

        # ---------------- Bo: adds her mother with "Mom" nickname, fixes it, adds an unknown, takes back ----------------
        pg, errs = await page(b, 'boTokenBoTokenBoTokenBo12', B)
        await pg.evaluate(f"openPerson('{B}')"); await pg.wait_for_timeout(300)
        await pg.click('#pAdd'); await pg.wait_for_timeout(300)
        await pg.locator('#fRel button[data-v="parent"]').click()
        await pg.fill('#fFirst','Amanda'); await pg.fill('#fLast','Ross'); await pg.fill('#fNick','Mom'); await pg.wait_for_timeout(100)
        check('bo: "Mom" as nickname gets a gentle note', await pg.is_visible('#fNickWarn'))
        await pg.screenshot(path=OUT+'bo_nickwarn.png')
        await pg.fill('#fNick','Mandy'); await pg.wait_for_timeout(100)
        check('bo: a real nickname clears the note', not await pg.is_visible('#fNickWarn'))
        await pg.fill('#fNick','Mom')
        await pg.click('#pSave'); await pg.wait_for_timeout(1800); await pg.click('#thanksBack'); await pg.wait_for_timeout(2200)
        A=[x for x in rows('People') if x['first_name']=='Amanda'][0]['id']
        await pg.evaluate(f"openPerson('{A}')"); await pg.wait_for_timeout(300)
        check('bo: her unconfirmed card has Edit and Take back', await pg.is_visible('#pEdit') and await pg.is_visible('#pTakeBack'))
        await pg.screenshot(path=OUT+'bo_card.png')
        await pg.click('#pEdit'); await pg.wait_for_timeout(300)
        await pg.fill('#fNick',''); await pg.fill('#fMiddle','Renee')
        await pg.click('#pSave'); await pg.wait_for_timeout(1800)
        check('bo: fix thank-you', 'Fixed' in await pg.inner_text('#thanks'))
        await pg.click('#thanksBack'); await pg.wait_for_timeout(2200)
        a=[x for x in rows('People') if x['id']==A][0]
        check('bo: fix rewrote her own entry, still pending', a['nicknames']=='' and a['middle_name']=='Renee' and a['status']=='pending', a)
        check('bo: card shows the fix', 'Amanda' in await pg.evaluate(f"cardName(P('{A}'))") and 'Mom' not in await pg.evaluate(f"cardName(P('{A}'))"))
        # someone whose name she doesn't know, as Amanda's partner
        await pg.evaluate(f"openPerson('{A}')"); await pg.wait_for_timeout(300)
        await pg.click('#pAdd'); await pg.wait_for_timeout(300)
        await pg.locator('#fRel button[data-v="partner"]').click()
        await pg.check('#fNoName'); await pg.wait_for_timeout(100)
        check('bo: no-name hides the name fields', not await pg.is_visible('#fFirst') and await pg.is_visible('#fNoNameHint'))
        await pg.locator('#fLiving button[data-v="deceased"]').click(); await pg.fill('#fNotes','Rob\'s father. Nobody remembers his name.')
        await pg.screenshot(path=OUT+'bo_noname.png')
        await pg.click('#pSave'); await pg.wait_for_timeout(1800); await pg.click('#thanksBack'); await pg.wait_for_timeout(2200)
        unk=[x for x in rows('People') if x['notes'].startswith("Rob's")]
        check('bo: saved as Unknown with the story', unk and unk[0]['first_name']=='Unknown' and unk[0]['status']=='pending', unk)
        # Bo's own pending link on a confirmed card (Amanda as Bo's parent) shows on Bo's card
        await pg.evaluate(f"openPerson('{B}')"); await pg.wait_for_timeout(300)
        body=await pg.inner_text('#panel')
        check('bo: her card lists the link she added', 'You linked Amanda' in body, body)
        # take back Amanda from her own card while centered on her
        await pg.evaluate(f"STATE.focus='{A}'; render(); openPerson('{A}')"); await pg.wait_for_timeout(600)
        await pg.click('#pTakeBack'); await pg.wait_for_timeout(200)
        ask=await pg.inner_text('.ownwork')
        check('bo: take back asks first, naming the links', 'Take back Amanda' in ask and 'links' in ask, ask)
        await pg.screenshot(path=OUT+'bo_confirm.png')
        await pg.locator('[data-go]').click(); await pg.wait_for_timeout(2600)
        st={x['id']:x['status'] for x in rows('People')}
        check('bo: Amanda withdrawn; the unknown partner (only linked to her) too', st[A]=='withdrawn' and st[unk[0]['id']]=='withdrawn', st)
        check('bo: tree recentered on someone who stays', await pg.evaluate("G.people.has(STATE.focus)") and await pg.locator('.card').count() > 0)
        await pg.screenshot(path=OUT+'bo_after.png')
        q=post({'action':'admin_queue','key':key})
        check('queue is empty after all the take-backs', 'Amanda' not in json.dumps(q) and 'Frederica' not in json.dumps(q), json.dumps(q)[:300])
        # Bo's own unconfirmed Unknown parent: Fill in names it, in place
        hp=post({'action':'submit','token':'boTokenBoTokenBoTokenBo12','items':[{'kind':'person','ref':'new:x','data':{'is_placeholder':True}},{'kind':'relationship','type':'parent_child','a':'new:x','b':B}]})['ids']['new:x']
        await pg.evaluate("reload()"); await pg.wait_for_timeout(1500)
        await pg.evaluate(f"openPerson('{hp}')"); await pg.wait_for_timeout(300)
        check('bo: her unconfirmed Unknown offers Fill in', (await pg.inner_text('#pEdit')) == 'Fill in')
        await pg.click('#pEdit'); await pg.wait_for_timeout(300)
        await pg.fill('#fFirst','Joseph'); await pg.fill('#fLast','Russel')
        await pg.click('#pSave'); await pg.wait_for_timeout(1800); await pg.click('#thanksBack'); await pg.wait_for_timeout(2000)
        x=[r for r in rows('People') if r['id']==hp][0]
        check('bo: filled in, no longer a placeholder, still pending', x['first_name']=='Joseph' and x['is_placeholder']=='' and x['status']=='pending', x)
        check('bo: no page errors', not errs, errs)
        print(f"\n{'clean' if not fails else 'FAILED: ' + ', '.join(fails)}")
        if fails: sys.exit(1)
asyncio.run(main())
