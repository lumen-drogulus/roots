"""Adding yourself and the review after saving (2026-11-22). Option A: someone with no parent, sibling, partner or child
on the tree picks anyone (or nobody) and says how they're related; Jonny places them. After Save, "Here's what you
sent" shows what was typed, with Edit that comes back to it. Also the phone fixes: 16 px text boxes, words under the
top-bar icons, Add someone.
Needs a fresh apps-script/test/server.js on 8787 and the site on 8000 (see e2e.py). Run: python3 apps-script/test/e2e_review.py"""
import asyncio, json, urllib.request, sys
from playwright.async_api import async_playwright
API='http://localhost:8787'; SITE='http://127.0.0.1:8000'
def post(body):
    r=urllib.request.Request(API, data=json.dumps(body).encode(), headers={'Content-Type':'text/plain'}); return json.loads(urllib.request.urlopen(r).read())
def rows(tab):
    d=json.loads(urllib.request.urlopen(API+'/__sheet').read())[tab]; h=d[0]; return [dict(zip(h,r)) for r in d[1:]]
key=urllib.request.urlopen(API+'/__key').read().decode()
r=post({'action':'submit','token':'ownertokenownertokenowner','key':key,'items':[
 {'kind':'person','ref':'new:me','data':{'first_name':'Jonny','birth_surname':'Ruzicka','living':'living'}},
 {'kind':'person','ref':'new:b','data':{'first_name':'Barbara','birth_surname':'Hale','living':'living'}},
 {'kind':'person','ref':'new:g','data':{'first_name':'Walter','birth_surname':'Hale','living':'deceased'}},
 {'kind':'person','ref':'new:w1','data':{'first_name':'Tom','birth_surname':'Isaacs','living':'living'}},
 {'kind':'person','ref':'new:w2','data':{'first_name':'Rick','birth_surname':'Moss','living':'living'}},
 {'kind':'relationship','type':'parent_child','a':'new:g','b':'new:b'},
 {'kind':'relationship','type':'partner','a':'new:b','b':'new:w1','subtype':'divorced'},
 {'kind':'relationship','type':'partner','a':'new:b','b':'new:w2','subtype':'married'},
 {'kind':'claim','person':'new:me'}]})
B=r['ids']['new:b']; JONNY=r['ids']['new:me']
fails=[]
def check(n, ok, info=''):
    print(('  ok  ' if ok else '  FAIL ')+n+('' if ok else '  '+str(info)))
    if not ok: fails.append(n)
def person(first):
    return [x for x in rows('People') if x['first_name']==first]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        async def ctx(tok, w=390):
            c=await b.new_context(viewport={'width':w,'height':800})
            await c.add_init_script(f"if (!localStorage.getItem('roots_token')) localStorage.setItem('roots_token','{tok}');localStorage.setItem('roots_intro_seen','1')")
            pg=await c.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); return pg, errs
        # ---- Something else: picks Barbara, says "niece" ----
        pg, errs = await ctx('lindaTokenLindaToken0001')
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        check('phone: words under the top-bar icons', await pg.is_visible('#btnKey .plbl') and (await pg.inner_text('#btnHelp')).strip()=='Help')
        check('Add someone is on screen', await pg.is_visible('#btnAddSomeone'))
        await pg.click('#meYes'); await pg.wait_for_timeout(300)
        fs = await pg.evaluate("getComputedStyle(document.querySelector('#iName')).fontSize")
        check('text boxes are 16 px (no iPhone zoom)', fs=='16px', fs)
        await pg.fill('#iName','Linda'); await pg.click('#iAdd'); await pg.wait_for_timeout(400)
        check('picker has a way out', await pg.is_visible('#qEscape'))
        await pg.fill('#qName','Barb'); await pg.click(f'#qList button[data-id="{B}"]'); await pg.wait_for_timeout(300)
        check('one typed word carries into First name', await pg.input_value('#fFirst')=='Linda')
        check("last name isn't copied from the relative", await pg.input_value('#fLast')=='')
        check('no Are they living / Died / source / who-sent on your own form',
              not await pg.is_visible('#fLiving') and await pg.locator('#fDied').count()==0 and await pg.locator('#fSource').count()==0 and await pg.locator('#fWho').count()==0 and await pg.locator('#fNoName').count()==0)
        check('Child with two partners: no other parent chosen for you', await pg.input_value('#fOther') in ('', '__choose') and await pg.evaluate("document.querySelector('#fOther').value")=='__choose')
        await pg.click('#pSave'); await pg.wait_for_timeout(300)
        check('Save asks to choose the other parent', 'other parent' in await pg.inner_text('#formErr'))
        await pg.click('#fRel [data-v="other"]'); await pg.wait_for_timeout(200)
        check('Something else asks what you are to Barbara', await pg.is_visible('#fHow') and not await pg.is_visible('#fOtherWrap'))
        await pg.fill('#fFirst',''); await pg.click('#pSave'); await pg.wait_for_timeout(300)
        check('first name is required on your own form', 'first name' in await pg.inner_text('#formErr'))
        await pg.fill('#fFirst','Linda'); await pg.click('#pSave'); await pg.wait_for_timeout(300)
        check('how you are related is required', 'niece' in await pg.inner_text('#formErr'))
        await pg.fill('#fHow','niece'); await pg.fill('#fLast','Hale'); await pg.fill('#fNotes','My mom is Carol.')
        n0=len(rows('Relationships'))
        await pg.click('#pSave'); await pg.wait_for_timeout(1800)
        lp=person('Linda')
        check('saved Linda, unlinked, with the note for Jonny', len(lp)==1 and lp[0]['notes'].startswith('Related to Barbara Hale: niece') and 'Carol' in lp[0]['notes'] and len(rows('Relationships'))==n0, lp)
        c=[x for x in rows('Contributors') if x['token']=='lindaTokenLindaToken0001']
        check('claimed as Linda, sent by Linda Hale', c and c[0]['person_id']==lp[0]['id'] and c[0]['display_name']=='Linda Hale', c)
        txt=await pg.inner_text('#thanks')
        check('review shows what was sent', "here's what you sent" in txt.lower() and 'Linda Hale' in txt and "Barbara Hale's niece" in txt and 'My mom is Carol.' in txt and 'Related to' not in txt, txt[:500])
        await pg.click('#thanksReview [data-rv="0"]'); await pg.wait_for_timeout(1800)
        check('Edit opens your entry', await pg.input_value('#fFirst')=='Linda')
        await pg.fill('#fMiddle','Marie'); await pg.click('#pSave'); await pg.wait_for_timeout(1800)
        check('after Edit, back on the review with the change', await pg.is_visible('#thanksReview') and 'Linda Marie Hale' in await pg.inner_text('#thanksReview'))
        check('the change reached the Sheet', person('Linda')[0]['middle_name']=='Marie')
        await pg.click('#thanksBack'); await pg.wait_for_timeout(2500)
        check('tree opens on Barbara, with the waiting note', await pg.evaluate('STATE.focus')==B and await pg.is_visible('#waitBar'))
        check('no page errors (Linda)', not errs, errs)
        # ---- Nobody they know ----
        pg, errs = await ctx('samTokenSamTokenSam00001')
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        await pg.click('#meYes'); await pg.wait_for_timeout(300)
        await pg.fill('#iName','Sam Ortiz'); await pg.click('#iAdd'); await pg.wait_for_timeout(400)
        await pg.click('#qEscape'); await pg.wait_for_timeout(300)
        check('full typed name fills first and last', await pg.input_value('#fFirst')=='Sam' and await pg.input_value('#fLast')=='Ortiz')
        await pg.click('#pSave'); await pg.wait_for_timeout(300)
        check('asks how they are related', 'related' in await pg.inner_text('#formErr'))
        await pg.fill('#fHow','Barbara Hale is my godmother'); await pg.click('#pSave'); await pg.wait_for_timeout(1800)
        sp=person('Sam')
        check('saved Sam with how related', len(sp)==1 and sp[0]['notes']=="How I'm related: Barbara Hale is my godmother", sp)
        check('review says how', 'Barbara Hale is my godmother' in await pg.inner_text('#thanksReview'))
        check('no page errors (Sam)', not errs, errs)
        # ---- Add someone, then two at once ----
        pg, errs = await ctx('tomTokenTomTokenTom00001')
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        await pg.click('#btnAddSomeone'); await pg.wait_for_timeout(300)
        await pg.fill('#qName','Walt'); await pg.click('#qList button'); await pg.wait_for_timeout(300)
        await pg.click('#fRel [data-v="partner"]'); await pg.fill('#fFirst','Evelyn'); await pg.click('#fLiving [data-v="deceased"]'); await pg.fill('#fBorn','about 1925'); await pg.fill('#fSource','Grandma told me')
        await pg.click('#pMore'); await pg.wait_for_timeout(1800)
        await pg.click('#fRel [data-v="child"]'); await pg.fill('#fFirst','Gary'); await pg.click('#pSave'); await pg.wait_for_timeout(1800)
        txt=await pg.inner_text('#thanksReview')
        check('review lists both', 'Evelyn' in txt and 'Gary' in txt and 'Married to Walter Hale' in txt and 'about 1925' in txt and 'Grandma told me' in txt, txt)
        check('no page errors (Tom)', not errs, errs)
        # ---- person card: Add a relative is the main button ----
        await pg.click('#thanksBack'); await pg.wait_for_timeout(2000)
        await pg.evaluate(f"openPerson('{B}')"); await pg.wait_for_timeout(300)
        check('Add a relative is the main button on a card', await pg.get_attribute('#pAdd','class')=='primary')
        await b.close()
asyncio.run(main())
print('\n%d failed' % len(fails) if fails else '\nall passed'); sys.exit(1 if fails else 0)
