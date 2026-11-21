"""End-to-end run of the real pages against the local API (apps-script/test/server.js).
Start: node apps-script/test/server.js 8787 & python3 -m http.server 8000 --bind 127.0.0.1 &
Run:   python3 apps-script/test/e2e.py"""
import asyncio, json, urllib.request
from playwright.async_api import async_playwright

API = 'http://localhost:8787'
SITE = 'http://127.0.0.1:8000'
OUT = '/home/claude/ptest/e2e_'
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('  ok  ' if ok else '  FAIL ') + name + (f'   [{info}]' if info and not ok else ''))

async def wait_api(pg):
    await pg.wait_for_function("() => !document.querySelector('#loading') || document.querySelector('#loading').hidden", timeout=10000)
    await pg.wait_for_timeout(900)

async def main():
    key = urllib.request.urlopen(API + '/__key').read().decode()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        errs = []

        # ---------- owner: sign in on the approvals page ----------
        owner = await b.new_context(viewport={'width': 1366, 'height': 820})
        op = await owner.new_page(); op.on('pageerror', lambda e: errs.append('owner: ' + str(e)))
        await op.goto(f'{SITE}/admin.html?api={API}'); await op.wait_for_timeout(500)
        await op.fill('#keyInput', 'wrong-key'); await op.click('#gateForm button'); await op.wait_for_timeout(700)
        check('wrong admin key is refused', await op.is_visible('#gateErr'))
        await op.fill('#keyInput', key); await op.click('#gateForm button'); await op.wait_for_timeout(900)
        check('right key unlocks the queue', await op.is_visible('#app') and 'Nothing waiting' in await op.inner_text('#queue'))

        # ---------- owner: plant the tree ----------
        tp = await owner.new_page(); tp.on('pageerror', lambda e: errs.append('owner tree: ' + str(e)))
        await tp.goto(f'{SITE}/index.html?api={API}&nointro'); await wait_api(tp)
        check('owner mode banner shows', await tp.is_visible('#ownerBar'))
        check('empty tree invites the owner to start', await tp.is_visible('#empty') and 'ready to plant' in await tp.inner_text('#empty'))
        await tp.click('#eStart'); await tp.wait_for_timeout(300)
        await tp.fill('#fFirst', 'Jonny'); await tp.fill('#fLast', 'Ruzicka')
        await tp.click('#pSave'); await tp.wait_for_timeout(1500)
        check('thank-you after planting yourself', await tp.is_visible('#thanks.on'))
        await tp.click('#thanksBack'); await tp.wait_for_timeout(2000)
        check('you appear as the center, labeled You', await tp.locator('.card.focus', has_text='Jonny').count() == 1 and 'You' in await tp.inner_text('.card.focus'))
        # parents, with Save & add another
        await tp.locator('.card.focus').click(); await tp.wait_for_timeout(400)
        await tp.click('#pAdd'); await tp.wait_for_timeout(300)
        await tp.locator('#fRel button[data-v="parent"]').click()
        check('first parent: no "together with" question', not await tp.is_visible('#fOtherWrap') and not await tp.is_visible('#fKindWrap'))
        await tp.fill('#fFirst', 'Robert'); await tp.fill('#fLast', 'Ruzicka'); await tp.locator('#fLiving button[data-v="deceased"]').click()
        await tp.fill('#fBorn', '1941'); await tp.fill('#fDied', '2015'); await tp.fill('#fNotes', 'Ran a hardware store.'); await tp.fill('#fSource', 'family Bible')
        await tp.click('#pMore'); await tp.wait_for_timeout(2200)
        check('save and add another keeps the form open', await tp.is_visible('#addForm') and '1 saved' in await tp.inner_text('#panel .head .sub'))
        check('second parent: asks if together with the first', await tp.is_visible('#fOtherWrap') and 'Robert' in await tp.inner_text('#fOther') and await tp.is_visible('#fKindWrap'))
        await tp.fill('#fFirst', 'Joan'); await tp.fill('#fLast', 'Ruzicka')
        await tp.fill('#fMiddle', 'Marie'); await tp.fill('#fNick', 'Jo')
        await tp.click('#fNamesBtn'); await tp.fill('#fBirthName', 'Whitlock')
        await tp.click('#fAddName'); await tp.locator('.fOtherName').nth(0).fill('Hale')
        await tp.click('#fAddName'); await tp.locator('.fOtherName').nth(1).fill('Oops')
        await tp.locator('.namerow .rm').nth(1).click()
        check('last-name rows add and remove', await tp.locator('.fOtherName').count() == 1)
        await tp.fill('#fBorn', 'about 1944'); await tp.fill('#fDied', 'March 3, 2020')
        check('typing a death date flips to Passed away', await tp.get_attribute('#fLiving button[data-v="deceased"]', 'aria-pressed') == 'true')
        await tp.click('#pSave'); await tp.wait_for_timeout(1500)
        check('batch thank-you counts both', '2 people' in await tp.inner_text('#thanksTitle'), await tp.inner_text('#thanksTitle'))
        await tp.click('#thanksBack'); await tp.wait_for_timeout(2200)
        # partner and child
        await tp.locator('.card.focus').click(); await tp.wait_for_timeout(300); await tp.click('#pAdd'); await tp.wait_for_timeout(300)
        await tp.locator('#fRel button[data-v="partner"]').click()
        check('partner form hides the other-parent question', not await tp.is_visible('#fOtherWrap') and await tp.is_visible('#fKindWrap'))
        await tp.fill('#fFirst', 'Dana'); await tp.fill('#fLast', 'Ruzicka')
        await tp.locator('#fLiving button[data-v="living"]').click(); await tp.click('#pSave'); await tp.wait_for_timeout(1500)
        await tp.click('#thanksBack'); await tp.wait_for_timeout(2000)
        await tp.locator('.card.focus').click(); await tp.wait_for_timeout(300); await tp.click('#pAdd'); await tp.wait_for_timeout(300)
        await tp.locator('#fRel button[data-v="child"]').click(); await tp.wait_for_timeout(100)
        check('child form offers the other parent', await tp.is_visible('#fOther') and 'Dana' in await tp.inner_text('#fOther'))
        await tp.fill('#fFirst', 'Sam'); await tp.locator('#fLiving button[data-v="living"]').click()
        await tp.click('#pSave'); await tp.wait_for_timeout(1500); await tp.click('#thanksBack'); await tp.wait_for_timeout(2200)
        names = await tp.eval_on_selector_all('.card .nm', 'e => e.map(x => x.textContent)')
        check('owner additions are live', all(any(n.startswith(x) for n in names) for x in ['Robert', 'Joan', 'Dana', 'Sam']), names)
        labels = await tp.eval_on_selector_all('.card', 'e => e.map(x => x.getAttribute("aria-label"))')
        check('relationship labels', any('Robert Ruzicka, Parent' == l for l in labels) and any(l.startswith('Sam') and 'Child' in l for l in labels), labels)
        await tp.screenshot(path=OUT + '01_owner_tree.png')
        owner_state = json.loads(urllib.request.urlopen(API + '/__sheet').read())
        P = {r[0]: r for r in owner_state['People'][1:]}
        rid = next(i for i, r in P.items() if r[2] == 'Robert'); jid = next(i for i, r in P.items() if r[2] == 'Joan')
        check('parents linked as a married couple', any(r[2] == 'partner' and {r[3], r[4]} == {rid, jid} and r[5] == 'married' for r in owner_state['Relationships'][1:]))
        check('maiden, in-between and current names stored', P[jid][4] == 'Whitlock' and json.loads(P[jid][5]) == ['Hale', 'Ruzicka'], P[jid][4:6])
        check('middle name and goes-by stored', P[jid][3] == 'Marie' and P[jid][6] == 'Jo', P[jid][3:7])
        check('first person not given extra names', P[rid][4] == 'Ruzicka' and P[rid][5] in ('', '[]'), P[rid][4:6])
        await tp.locator('.card', has_text='Joan').first.click(); await tp.wait_for_timeout(400)
        ptx = await tp.inner_text('#panel')
        check('panel shows full name and goes-by', 'Joan "Jo" Marie Ruzicka' in ptx, ptx[:200])
        check('panel ties the married name to the spouse', 'Whitlock' in ptx and 'Hale' in ptx and 'from marriage to Robert Ruzicka' in ptx, ptx[:400])
        await tp.click('#pClose'); await tp.wait_for_timeout(200)
        jonny_id = next(r[0] for r in owner_state['People'][1:] if r[2] == 'Jonny')
        robert_id = next(r[0] for r in owner_state['People'][1:] if r[2] == 'Robert')

        # ---------- relative: first visit from the forwarded link ----------
        rel = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        rp = await rel.new_page(); rp.on('pageerror', lambda e: errs.append('relative: ' + str(e)))
        await rp.goto(f'{SITE}/index.html?api={API}&from={jonny_id}'); await wait_api(rp)
        check('first visit shows the intro', await rp.is_visible('#intro.on'))
        check('intro has Jonny\'s story', 'Card games at someone' in await rp.inner_text('#introInner'))
        await rp.click('#iNext'); await rp.wait_for_timeout(300); await rp.click('#iNext'); await rp.wait_for_timeout(300)
        check('third step asks who you are', 'Which one is you' in await rp.inner_text('#introInner'))
        await rp.locator('#iList button[data-id="new"]').click(); await rp.wait_for_timeout(400)
        await rp.fill('#qName', 'jon'); await rp.wait_for_timeout(200)
        await rp.locator('#qList button', has_text='Jonny').click(); await rp.wait_for_timeout(400)
        check('adding yourself next to a relative', 'Add yourself' in await rp.inner_text('#panel h2'))
        await rp.locator('#fRel button[data-v="sibling"]').click()
        await rp.fill('#fFirst', 'Kate'); await rp.fill('#fLast', 'Ruzicka')
        check('relative is asked for their name', await rp.is_visible('#fWho'))
        await rp.fill('#fWho', 'Kate, Jonny\'s sister')
        await rp.click('#pSave'); await rp.wait_for_timeout(1600)
        check('relative thank-you mentions approval', 'Jonny Ruzicka looks over' in await rp.inner_text('#thanksBody'))
        await rp.click('#thanksBack'); await rp.wait_for_timeout(2200)
        kate = rp.locator('.card', has_text='Kate')
        check('relative sees her own entry, unconfirmed', await kate.count() == 1 and 'unconfirmed' in (await kate.inner_text()).lower())
        check('tree opens centered on the relative now', 'Kate' in await rp.inner_text('.card.focus'))
        # add a deceased grandparent to Robert
        await rp.locator('.card', has_text='Robert').first.click(); await rp.wait_for_timeout(400)
        await rp.click('#pAdd'); await rp.wait_for_timeout(300); await rp.locator('#fRel button[data-v="parent"]').click()
        await rp.fill('#fFirst', 'Walter'); await rp.fill('#fBorn', 'about 1912'); await rp.locator('#fLiving button[data-v="deceased"]').click()
        await rp.fill('#fNotes', 'Machinist.'); await rp.click('#pSave'); await rp.wait_for_timeout(1600); await rp.click('#thanksBack'); await rp.wait_for_timeout(2000)
        # duplicate check while typing
        await rp.locator('.card', has_text='Robert').first.click(); await rp.wait_for_timeout(300); await rp.click('#pAdd'); await rp.wait_for_timeout(300)
        await rp.fill('#fFirst', 'Jo'); await rp.wait_for_timeout(200)
        check('duplicate check offers existing people', 'Joan' in await rp.inner_text('#dups') or 'Jonny' in await rp.inner_text('#dups'))
        # bad date message
        await rp.fill('#fFirst', 'Test'); await rp.fill('#fBorn', 'sometime in spring'); await rp.click('#pSave'); await rp.wait_for_timeout(400)
        check('unreadable date gets a plain message', await rp.is_visible('#formErr') and 'year like 1932' in await rp.inner_text('#formErr'))
        await rp.click('#pClose'); await rp.wait_for_timeout(200)
        check('closing with typing asks to save', await rp.locator('.guard').count() == 1)
        await rp.click('#gDiscard'); await rp.wait_for_timeout(300)
        # suggest a correction to Robert
        await rp.locator('.card', has_text='Robert').first.click(); await rp.wait_for_timeout(300); await rp.click('#pEdit'); await rp.wait_for_timeout(300)
        await rp.fill('#fPlace', 'Cleveland, Ohio'); await rp.fill('#fSource', 'his obituary'); await rp.click('#pSave'); await rp.wait_for_timeout(1600)
        check('correction thank-you', 'changes to Robert' in await rp.inner_text('#thanksTitle'))
        await rp.click('#thanksBack'); await rp.wait_for_timeout(1500)
        await rp.screenshot(path=OUT + '02_relative_phone.png')
        # send link carries her id
        await rp.click('#btnSend'); await rp.wait_for_timeout(300)
        link = await rp.input_value('#sLink')
        check('send link carries the sender', '?from=P-' in link, link)
        await rp.click('#pClose')

        # ---------- stranger: what the public sees ----------
        st = await b.new_context(viewport={'width': 1366, 'height': 820})
        sp = await st.new_page(); sp.on('pageerror', lambda e: errs.append('stranger: ' + str(e)))
        await sp.goto(f'{SITE}/index.html?api={API}&nointro'); await wait_api(sp)
        snames = await sp.eval_on_selector_all('.card .nm', 'e => e.map(x => x.textContent)')
        check('pending entries are invisible to others', not any(n.startswith(('Kate', 'Walter')) for n in snames), snames)
        await sp.locator('.card', has_text='Dana').first.click(); await sp.wait_for_timeout(300)
        check('living person shows the privacy note', 'only their names show' in await sp.inner_text('#panel'))
        raw = urllib.request.urlopen(urllib.request.Request(API, data=json.dumps({'action': 'tree'}).encode(), headers={'Content-Type': 'text/plain'})).read().decode()
        check('public API has no tokens or living details', 'token' not in raw and 'Kate' not in raw)

        # ---------- owner approves ----------
        await op.click('#tabQueue'); await op.wait_for_timeout(900)
        qtext = await op.inner_text('#queue')
        check('queue shows who sent it', "Kate, Jonny's sister" in qtext, qtext[:200])
        check('queue shows the correction as before and after', 'Birthplace' in qtext and 'Cleveland, Ohio' in qtext)
        await op.screenshot(path=OUT + '03_queue.png', full_page=True)
        while await op.locator('[data-all="approve"]').count():
            await op.locator('[data-all="approve"]').first.click(); await op.wait_for_timeout(900)
        check('queue empties after approving', 'Nothing waiting' in await op.inner_text('#queue'))
        await op.click('#tabPeople'); await op.wait_for_timeout(900)
        check('everyone tab lists people', await op.locator('.prow').count() >= 6)

        # ---------- after approval ----------
        await rp.reload(); await wait_api(rp)
        kate = rp.locator('.card', has_text='Kate')
        check('approved entry is no longer marked unconfirmed', await kate.count() == 1 and 'unconfirmed' not in (await kate.inner_text()).lower())
        await rp.locator('.card', has_text='Robert').first.click(); await rp.wait_for_timeout(300)
        ptxt = await rp.inner_text('#panel')
        check('approved correction shows on the card', 'Cleveland, Ohio' in ptxt and 'Ran a hardware store' in ptxt, ptxt[:300])
        check('who added it is shown', 'Added by Jonny Ruzicka' in ptxt)
        await rp.click('#pClose')
        await sp.reload(); await wait_api(sp)
        snames = await sp.eval_on_selector_all('.card .nm', 'e => e.map(x => x.textContent)')
        check('approved additions reach everyone', any(n.startswith('Walter') for n in snames), snames)
        await sp.screenshot(path=OUT + '04_public.png')

        # ---------- step, adoptive and foster parents ----------
        await tp.reload(); await wait_api(tp)
        await tp.locator('.card', has_text='Dana').first.click(); await tp.wait_for_timeout(400)
        await tp.click('#pAdd'); await tp.wait_for_timeout(300)
        await tp.locator('#fRel button[data-v="child"]').click()
        check('child form asks what kind of parent', await tp.is_visible('#fPcWrap') and 'Dana' in await tp.inner_text('#fPcLab'))
        await tp.locator('#fPc button[data-v="step"]').click()
        check('step hint only for adding a parent', not await tp.is_visible('#fPcHint'))
        await tp.fill('#fFirst', 'Max'); await tp.locator('#fLiving button[data-v="living"]').click()
        await tp.click('#pSave'); await tp.wait_for_timeout(1500); await tp.click('#thanksBack'); await tp.wait_for_timeout(2200)
        st8 = json.loads(urllib.request.urlopen(API + '/__sheet').read())
        P8 = {r[0]: r for r in st8['People'][1:]}
        mid = next(i for i, r in P8.items() if r[2] == 'Max'); did = next(i for i, r in P8.items() if r[2] == 'Dana')
        pcs = {(r[3], r[4]): r[5] for r in st8['Relationships'][1:] if r[2] == 'parent_child'}
        check('stepchild stored as step to Dana, birth to Jonny', pcs.get((did, mid)) == 'step' and pcs.get((jonny_id, mid)) == 'biological', pcs)
        edge_ids = await tp.eval_on_selector_all('[data-edge]', 'e => e.map(x => x.dataset.edge)') if await tp.locator('[data-edge]').count() else []
        await tp.locator('.card', has_text='Max').first.click(); await tp.wait_for_timeout(400)
        check('panel says who the step-parent is', 'is Max\'s step-parent' in await tp.inner_text('#panel'), await tp.inner_text('#panel'))
        await tp.click('#pClose'); await tp.wait_for_timeout(200)
        await tp.locator('.card', has_text='Walter').first.click(); await tp.wait_for_timeout(300)
        await tp.click('#pAdd'); await tp.wait_for_timeout(300); await tp.locator('#fRel button[data-v="parent"]').click()
        await tp.locator('#fPc button[data-v="step"]').click()
        check('adding a step-parent warns about the parent spot', await tp.is_visible('#fPcHint'))
        await tp.locator('#fPc button[data-v="biological"]').click()
        check('warning goes away for a birth parent', not await tp.is_visible('#fPcHint'))
        await tp.click('#pClose'); await tp.wait_for_timeout(300)
        if await tp.locator('#gDiscard').count(): await tp.click('#gDiscard'); await tp.wait_for_timeout(300)
        # correct an existing link
        await tp.locator('.card', has_text='Robert').first.click(); await tp.wait_for_timeout(300); await tp.click('#pEdit'); await tp.wait_for_timeout(300)
        wsel = tp.locator('select[data-parent]', has_text='Birth parent').first
        check('edit lists the parents with their kind', await tp.locator('select[data-parent]').count() >= 1)
        await wsel.select_option('adopted'); await tp.click('#pSave'); await tp.wait_for_timeout(1500)
        await tp.click('#thanksBack'); await tp.wait_for_timeout(2000)
        st9 = json.loads(urllib.request.urlopen(API + '/__sheet').read())
        wid = next(r[0] for r in st9['People'][1:] if r[2] == 'Walter')
        check('edit changed Walter to adoptive', any(r[2] == 'parent_child' and r[3] == wid and r[4] == robert_id and r[5] == 'adopted' for r in st9['Relationships'][1:]))
        await tp.locator('.card', has_text='Robert').first.click(); await tp.wait_for_timeout(300)
        check('panel shows the adoptive parent', "is Robert's adoptive parent" in await tp.inner_text('#panel'))
        await tp.click('#pClose'); await tp.wait_for_timeout(200)
        await tp.click('#btnKey'); await tp.wait_for_timeout(300)
        check('key explains the dashed parent line', 'Step, adoptive or foster parent' in await tp.inner_text('#panel'))
        await tp.click('#pClose'); await tp.wait_for_timeout(200)
        await tp.screenshot(path=OUT + '05_kinds.png')
        # marriage status from the edit form
        await tp.locator('.card.focus').click(); await tp.wait_for_timeout(300); await tp.click('#pEdit'); await tp.wait_for_timeout(300)
        check('edit lists marriages with their status', await tp.locator('select[data-partner]').count() == 1)
        await tp.locator('select[data-partner]').select_option('divorced'); await tp.click('#pSave'); await tp.wait_for_timeout(1500)
        await tp.click('#thanksBack'); await tp.wait_for_timeout(2000)
        st10 = json.loads(urllib.request.urlopen(API + '/__sheet').read())
        check('marriage marked divorced', any(r[2] == 'partner' and {r[3], r[4]} == {jonny_id, did} and r[5] == 'divorced' for r in st10['Relationships'][1:]))
        check('former partner label', 'Former partner' in await tp.inner_text('.card:has-text("Dana")'))
        # middle name and goes-by for a living person reach everyone
        await tp.locator('.card', has_text='Kate').first.click(); await tp.wait_for_timeout(300); await tp.click('#pEdit'); await tp.wait_for_timeout(300)
        await tp.fill('#fMiddle', 'Lynn'); await tp.fill('#fNick', 'Katie'); await tp.click('#pSave'); await tp.wait_for_timeout(1500)
        await tp.click('#thanksBack'); await tp.wait_for_timeout(1500)
        await sp.reload(); await wait_api(sp)
        check('stranger sees a living goes-by on the card', await sp.locator('.card', has_text='"Katie"').count() == 1)
        await sp.locator('.card', has_text='Katie').first.click(); await sp.wait_for_timeout(300)
        check('stranger sees the full name of a living person', 'Kate "Katie" Lynn Ruzicka' in await sp.inner_text('#panel'))
        await sp.click('#pClose')
        await tp.click('#btnSend') if False else None
        lbl = await tp.locator('#fSource').count()

        # ---------- pause ----------
        await op.click('#btnPause'); await op.wait_for_timeout(700)
        await rp.reload(); await wait_api(rp)
        check('relatives see the pause notice', await rp.is_visible('#paused'))
        await rp.locator('.card', has_text='Kate').first.click(); await rp.wait_for_timeout(300); await rp.click('#pAdd'); await rp.wait_for_timeout(300)
        await rp.fill('#fFirst', 'Paused'); await rp.click('#pSave'); await rp.wait_for_timeout(1000)
        check('adding while paused gets a clear message', 'paused' in (await rp.inner_text('#formErr')).lower())
        await op.click('#btnPause'); await op.wait_for_timeout(500)

        print('\nERRORS', errs)
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
asyncio.run(main())
