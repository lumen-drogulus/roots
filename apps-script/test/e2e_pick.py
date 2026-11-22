"""Linking someone already in the tree (Bo's Marilyn case, 2026-11-21): the "Already in the tree" picker and the
missing-parent question on a relative's own unconfirmed card. Fresh server.js on 8787 plus the site on 8000.
Run: python3 apps-script/test/e2e_pick.py"""
import asyncio, json, urllib.request, sys
fails = []
def check(n, ok, info=''):
    print(('  ok  ' if ok else '  FAIL ') + n + ('' if ok else '  ' + str(info)))
    if not ok: fails.append(n)
from playwright.async_api import async_playwright
API='http://localhost:8787'; SITE='http://127.0.0.1:8000'
def post(b):
    r=urllib.request.Request(API,data=json.dumps(b).encode(),headers={'Content-Type':'text/plain'}); return json.loads(urllib.request.urlopen(r).read())
def rows(t):
    d=json.loads(urllib.request.urlopen(API+'/__sheet').read())[t]; return [dict(zip(d[0],r)) for r in d[1:]]
key=urllib.request.urlopen(API+'/__key').read().decode()
o=post({'action':'submit','token':'ownertokenownertokenowner','key':key,'items':[
 {'kind':'person','ref':'new:b','data':{'first_name':'Bo','birth_surname':'Ross','living':'living'}}]})
B=o['ids']['new:b']; BT='boTokenBoTokenBoTokenBo12'
r=post({'action':'submit','token':BT,'items':[
 {'kind':'person','ref':'new:a','data':{'first_name':'Amanda','birth_surname':'Ross','living':'living'}},
 {'kind':'relationship','type':'parent_child','a':'new:a','b':B},
 {'kind':'person','ref':'new:m','data':{'first_name':'Marilyn','birth_surname':'Beaudry','living':'living'}},
 {'kind':'relationship','type':'parent_child','a':'new:m','b':'new:a'},
 {'kind':'person','ref':'new:u','data':{'first_name':'Unise','nicknames':'great Grandma','living':'deceased'}},
 {'kind':'relationship','type':'parent_child','a':'new:u','b':'new:m'},
 {'kind':'person','ref':'new:x','data':{'first_name':'Unknown','living':'deceased','notes':'story'}},
 {'kind':'relationship','type':'partner','a':'new:u','b':'new:x','subtype':'widowed'},
 {'kind':'person','ref':'new:r','data':{'first_name':'Rob','birth_surname':'Massey','living':'living'}},
 {'kind':'relationship','type':'parent_child','a':'new:u','b':'new:r'},
 {'kind':'relationship','type':'parent_child','a':'new:x','b':'new:r'}]})
I=r['ids']; M=I['new:m']; X=I['new:x']; U=I['new:u']
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        c=await b.new_context(viewport={'width':390,'height':844})
        await c.add_init_script(f"localStorage.setItem('roots_token','{BT}')")
        pg=await c.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(f'{SITE}/index.html?api={API}&nointro&from={B}'); await pg.wait_for_timeout(2200)
        await pg.evaluate(f"openPerson('{M}')"); await pg.wait_for_timeout(300)
        check('own unconfirmed card asks about the other parent', await pg.locator('.nudge').count() == 1 and 'Unknown' in await pg.inner_text('.nudge'))
        await pg.click('#pAdd'); await pg.wait_for_timeout(300)
        await pg.locator('#fRel button[data-v="parent"]').click()
        await pg.locator('#fWhich button[data-v="existing"]').click(); await pg.wait_for_timeout(200)
        lst = await pg.inner_text('#fPickList')
        check('picker hides the name fields', not await pg.is_visible('#fFirst'))
        check('the Unknown partner is first under Most likely', lst.upper().startswith('MOST LIKELY') and lst.split('\n')[1] == 'Unknown', lst[:120])
        await pg.click('#pSave'); await pg.wait_for_timeout(300)
        check('saving without a pick explains itself', 'Tap who they are' in await pg.inner_text('#formErr'))
        await pg.locator('#fPickList button').first.click(); await pg.wait_for_timeout(200)
        await pg.click('#pSave'); await pg.wait_for_timeout(2000)
        links=[x for x in rows('Relationships') if x['person_b']==M and x['type']=='parent_child' and x['status']=='pending']
        check('Marilyn now has both parents', sorted(x['person_a'] for x in links) == sorted([U, X]))
        check('no duplicate couple link', len([x for x in rows('Relationships') if x['type']=='partner' and {x['person_a'],x['person_b']}=={U,X} and x['status']!='withdrawn']) == 1)
        check('no page errors', not errs, errs)
        print('\nclean' if not fails else '\nFAILED: ' + ', '.join(fails))
        if fails: sys.exit(1)
asyncio.run(main())
