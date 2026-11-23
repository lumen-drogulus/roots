"""Editing a photo's details (2026-11-23): caption, when, where, photo or document. Needs a fresh
apps-script/test/server.js on 8787 and the site on 8000 (see e2e.py). Run: python3 apps-script/test/e2e_photoedit.py
Checks: "Add a caption and date" on the Photos page opens the viewer's form; the owner's edit applies at once; a
relative's edit to a confirmed photo goes to the queue and shows to them as "Your edit", nobody else; editing again
replaces their earlier change; Take back; the approvals card reads as a correction to the photo; approving makes it
public; a relative's own unconfirmed upload is fixed in place; a bad date is caught on the form."""
import asyncio, base64, json, struct, urllib.request, zlib
from playwright.async_api import async_playwright
API = 'http://localhost:8787'; SITE = 'http://127.0.0.1:8000'
def post(b): return json.load(urllib.request.urlopen(urllib.request.Request(API, json.dumps(b).encode(), {'Content-Type': 'text/plain'})))
KEY = urllib.request.urlopen(API + '/__key').read().decode()
fails = []
def ok(c, m):
    print(('  ok  ' if c else 'FAIL  ') + m)
    if not c: fails.append(m)
def png(w=30, h=20):
    raw = b''.join(b'\x00' + bytes([150, 110, 70]) * w for _ in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
B64 = base64.b64encode(png()).decode()
OWNER = 'ownertokenownertokenowner3'; REL = 'relativetokenrelativetoken3'; OTHER = 'othertokenothertokenother3'

async def main():
    s = post({'action': 'submit', 'token': OWNER, 'key': KEY, 'items': [
        {'kind': 'person', 'ref': 'new:me', 'data': {'first_name': 'Jonny', 'birth_surname': 'Hale', 'living': 'living'}},
        {'kind': 'person', 'ref': 'new:mom', 'data': {'first_name': 'Debby', 'birth_surname': 'Hale', 'living': 'deceased', 'sex': 'female'}},
        {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:mom', 'b': 'new:me'}, {'kind': 'claim', 'person': 'new:me'}]})
    MOM = s['ids']['new:mom']
    a = post({'action': 'upload_photo', 'token': OWNER, 'key': KEY, 'image': B64, 'mime': 'image/png', 'tags': [MOM]})
    b2 = post({'action': 'upload_photo', 'token': OWNER, 'key': KEY, 'image': B64, 'mime': 'image/png', 'tags': [MOM]})
    async with async_playwright() as p:
        br = await p.chromium.launch()
        async def ctx(tok, owner=False):
            c = await br.new_context(viewport={'width': 1280, 'height': 900})
            init = f"localStorage.setItem('roots_token',{json.dumps(tok)});localStorage.setItem('roots_intro_seen','1');"
            if owner: init += f"localStorage.setItem('roots_admin_key',{json.dumps(KEY)});"
            await c.add_init_script(init)
            pg = await c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
            return c, pg, errs
        pub = lambda: {f['id']: f for f in post({'action': 'tree', 'token': 'z' * 24})['photos']}

        # ---- owner: add a caption from the Photos page ----
        c, pg, errs = await ctx(OWNER, owner=True)
        await pg.click('#btnViewPhotos'); await pg.wait_for_timeout(400)
        ok(await pg.locator('.pgedit:has-text("Add a caption and date")').count() == 2, 'uncaptioned photos offer "Add a caption and date"')
        await pg.click('.pgedit >> nth=0'); await pg.wait_for_timeout(300)
        ok(not await pg.locator('#viewer').is_hidden() and await pg.locator('#peCap').count() == 1, 'it opens the viewer with the form')
        await pg.fill('#peWhen', 'sometime'); await pg.click('#peSave'); await pg.wait_for_timeout(200)
        ok(not await pg.locator('#peErr').is_hidden(), 'a date it can\'t read is caught on the form')
        await pg.fill('#peCap', 'Debby at the beach'); await pg.fill('#peWhen', 'about 1975'); await pg.fill('#pePlace', 'Huntington Beach')
        await pg.screenshot(path='/tmp/roots_photoedit.png')
        await pg.click('#peSave'); await pg.wait_for_timeout(2500)
        first = [f for f in pub().values() if f['caption'] == 'Debby at the beach']
        ok(len(first) == 1 and first[0]['date_taken'] == 'about:1975' and first[0]['place'] == 'Huntington Beach', 'owner: saved and public at once')
        ok('Debby at the beach' in await pg.inner_text('#viewer'), 'the viewer shows the new caption')
        EDITED = first[0]['id']; OTHERPH = a['id'] if b2['id'] == EDITED else b2['id']
        ok(not errs, f'owner: no page errors {errs}'); await c.close()

        # ---- relative: suggest a better caption on the confirmed photo ----
        c, pg, errs = await ctx(REL)
        await pg.click('#btnViewPhotos'); await pg.wait_for_timeout(400)
        idx = await pg.evaluate(f"pgList().findIndex(f => f.id === {json.dumps(EDITED)})")
        await pg.click(f'.pgedit >> nth={idx}'); await pg.wait_for_timeout(300)
        await pg.fill('#peCap', 'Debby and Barbara at the beach')
        await pg.click('#peSave'); await pg.wait_for_timeout(2500)
        vt = await pg.inner_text('#viewer')
        ok('Debby and Barbara at the beach' in vt and 'Your edit' in vt, 'relative: sees their change at once, marked Your edit')
        ok(pub()[EDITED]['caption'] == 'Debby at the beach', 'nobody else sees it yet')
        # edit again: replaces, not stacks
        await pg.click('#vEdit'); await pg.fill('#peCap', 'Debby and Barb at the beach'); await pg.click('#peSave'); await pg.wait_for_timeout(2500)
        mine = [x for x in post({'action': 'tree', 'token': REL})['own']['suggestions'] if x['target_id'] == EDITED]
        ok(len(mine) == 1 and mine[0]['value'] == 'Debby and Barb at the beach', f'editing again replaces the earlier change ({len(mine)})')
        await pg.screenshot(path='/tmp/roots_photoedit_rel.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        ok('Your edit' in await pg.inner_text('#photos'), 'the Photos page card says Your edit too')
        ok(not errs, f'relative: no page errors {errs}'); await c.close()

        # ---- another relative doesn't see it ----
        ok(not any(x['target_id'] == EDITED for x in (post({'action': 'tree', 'token': OTHER}).get('own') or {}).get('suggestions', [])), 'another device sees nothing pending')

        # ---- approvals: reads as a correction to the photo; approve ----
        c, pg, errs = await ctx(OWNER, owner=True)
        await pg.goto(f'{SITE}/admin.html?api={API}'); await pg.wait_for_selector('.batch', timeout=20000)
        at = ' '.join((await pg.inner_text('#queue')).split())
        ok('the photo "Debby at the beach": Caption' in at and 'Debby and Barb at the beach' in at, 'approvals: a correction to the photo, old and new')
        ok(await pg.locator('#queue a.btn:has-text("Open the file")').count() == 1, 'with Open the file')
        await pg.screenshot(path='/tmp/roots_photoedit_admin.png')
        await pg.click('.batch [data-all="approve"]'); await pg.wait_for_timeout(2500)
        ok(pub()[EDITED]['caption'] == 'Debby and Barb at the beach', 'approved: public')
        ok(not errs, f'approvals: no page errors {errs}'); await c.close()

        # ---- relative: their own unconfirmed upload is fixed in place; Take back of a change ----
        mineup = post({'action': 'upload_photo', 'token': REL, 'image': B64, 'mime': 'image/png', 'tags': [MOM]})
        post({'action': 'submit', 'token': REL, 'items': [{'kind': 'suggestion', 'target_id': OTHERPH, 'field': 'place', 'value': 'Long Beach'}]})
        c, pg, errs = await ctx(REL)
        await pg.click('#btnViewPhotos'); await pg.wait_for_timeout(400)
        idx = await pg.evaluate(f"pgList().findIndex(f => f.id === {json.dumps(mineup['id'])})")
        await pg.click(f'.pgedit >> nth={idx}'); await pg.wait_for_timeout(300)
        ok('Fixes what you sent' in await pg.inner_text('#vEditBox'), 'own unconfirmed upload: "Fixes what you sent"')
        await pg.fill('#peCap', 'Lake day'); await pg.click('#peKind [data-v="document"]'); await pg.click('#peSave'); await pg.wait_for_timeout(2500)
        own = next(f for f in post({'action': 'tree', 'token': REL})['own']['photos'] if f['id'] == mineup['id'])
        ok(own['caption'] == 'Lake day' and own['kind'] == 'document', 'fixed in place, still pending, kind changed')
        ok(not any(x['target_id'] == mineup['id'] for x in post({'action': 'tree', 'token': REL})['own']['suggestions']), 'no correction row for their own upload')
        await pg.keyboard.press('Escape')
        idx = await pg.evaluate(f"pgList().findIndex(f => f.id === {json.dumps(OTHERPH)})")
        await pg.click(f'.pgimg >> nth={idx}'); await pg.wait_for_timeout(300)
        await pg.click('#vEditsBack'); await pg.wait_for_timeout(2500)
        ok(not any(x['target_id'] == OTHERPH for x in post({'action': 'tree', 'token': REL})['own']['suggestions']), 'Take back removes their pending change')
        ok('Your edit' not in await pg.inner_text('#viewer'), 'and the viewer drops the Your edit note')
        ok(not errs, f'relative 2: no page errors {errs}'); await c.close()
        await br.close()
    print('FAILED: ' + str(len(fails)) if fails else 'all passed')

asyncio.run(main())
