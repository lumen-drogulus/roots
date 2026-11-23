"""The Photos page (2026-11-23): Tree / Wheel / Photos. Needs a fresh apps-script/test/server.js on 8787 and the site
on 8000 (see e2e.py). Run: python3 apps-script/test/e2e_allphotos.py
Checks: the switch's third choice, on desktop and at 360 px without the top bar overflowing; every photo and document
the viewer may see, grouped by decade with "Date not known" last; each person named with how they're related to the
viewer and whose child they are; a relative's own unconfirmed upload shown only to them; Photos / Documents, one
person, newest added; tapping a photo opens the viewer on the page's list; a name opens the card, whose "See them on
the tree" switches back to the tree; Add photos or documents asks whose card first; Photos isn't remembered."""
import asyncio, json, struct, urllib.request, zlib
from playwright.async_api import async_playwright
API = 'http://localhost:8787'; SITE = 'http://127.0.0.1:8000'
def post(b): return json.load(urllib.request.urlopen(urllib.request.Request(API, json.dumps(b).encode(), {'Content-Type': 'text/plain'})))
KEY = urllib.request.urlopen(API + '/__key').read().decode()
fails = []
def ok(c, m):
    print(('  ok  ' if c else 'FAIL  ') + m)
    if not c: fails.append(m)
def png(w=40, h=30):
    raw = b''.join(b'\x00' + bytes([90, 120, 160]) * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
import base64
B64 = base64.b64encode(png()).decode()
OWNER = 'ownertokenownertokenowner2'; REL = 'relativetokenrelativetoken2'

async def main():
    s = post({'action': 'submit', 'token': OWNER, 'key': KEY, 'items': [
        {'kind': 'person', 'ref': 'new:gma', 'data': {'first_name': 'Beverly', 'birth_surname': 'Elliott', 'married_names': ['Ogle'], 'living': 'deceased', 'sex': 'female', 'birth_date': 'exact:1930', 'death_date': 'exact:2001'}},
        {'kind': 'person', 'ref': 'new:gpa', 'data': {'first_name': 'John', 'birth_surname': 'Borders', 'living': 'deceased', 'sex': 'male'}},
        {'kind': 'person', 'ref': 'new:mom', 'data': {'first_name': 'Debby', 'birth_surname': 'Borders', 'living': 'deceased', 'sex': 'female'}},
        {'kind': 'person', 'ref': 'new:aunt', 'data': {'first_name': 'Barbara', 'birth_surname': 'Borders', 'living': 'living', 'sex': 'female'}},
        {'kind': 'person', 'ref': 'new:me', 'data': {'first_name': 'Jonny', 'birth_surname': 'Ruzicka', 'living': 'living', 'sex': 'male'}},
        {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:gma', 'b': 'new:mom'}, {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:gpa', 'b': 'new:mom'},
        {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:gma', 'b': 'new:aunt'}, {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:gpa', 'b': 'new:aunt'},
        {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:mom', 'b': 'new:me'}, {'kind': 'claim', 'person': 'new:me'}]})
    ids = s['ids']; GMA, MOM, AUNT, ME = ids['new:gma'], ids['new:mom'], ids['new:aunt'], ids['new:me']
    up = lambda **k: post({'action': 'upload_photo', 'token': OWNER, 'key': KEY, 'image': B64, 'mime': 'image/png', **k})
    up(caption='Thanksgiving at Barbara\'s', date_taken='about:1978', place='Cleveland, Ohio', source="Grandma's album", tags=[AUNT, MOM])
    up(caption='Wedding day', date_taken='exact:1952-06-01', tags=[GMA])
    up(caption='Mystery picnic', tags=[MOM])
    post({'action': 'upload_photo', 'token': OWNER, 'key': KEY, 'image': base64.b64encode(b'%PDF-1.4 x').decode(), 'mime': 'application/pdf', 'caption': 'Obituary', 'date_taken': 'exact:2001', 'tags': [GMA]})
    # a relative (claimed as Jonny's cousin? no: a stranger device) uploads one, pending
    post({'action': 'upload_photo', 'token': REL, 'image': B64, 'mime': 'image/png', 'caption': 'Cousins at the lake', 'date_taken': 'exact:1985', 'tags': [AUNT]})
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctx(tok, owner=False, vp=None):
            c = await b.new_context(viewport=vp or {'width': 1280, 'height': 900})
            init = f"localStorage.setItem('roots_token',{json.dumps(tok)});localStorage.setItem('roots_intro_seen','1');"
            if owner: init += f"localStorage.setItem('roots_admin_key',{json.dumps(KEY)});"
            await c.add_init_script(init)
            pg = await c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
            return c, pg, errs

        # ---- owner (claimed as Jonny), desktop ----
        c, pg, errs = await ctx(OWNER, owner=True)
        await pg.click('#btnViewPhotos'); await pg.wait_for_timeout(400)
        ok(not await pg.locator('#photos').is_hidden() and await pg.locator('#stage').is_hidden(), 'Photos replaces the tree')
        ok(await pg.locator('.pgcard').count() == 4, f'4 cards for the owner (3 photos, 1 document): {await pg.locator(".pgcard").count()}')
        heads = await pg.eval_on_selector_all('.pgdec', 'els => els.map(e => e.textContent)')
        ok(heads == ['1950s', '1970s', '2000s', 'Date not known'], f'grouped by decade, unknown last: {heads}')
        t = ' '.join((await pg.inner_text('#photos')).split())
        ok('Barbara Borders your aunt' in t, 'Barbara: your aunt')
        ok('Debby Borders your mother' in t, 'Debby: your mother')
        ok('Beverly Ogle your grandmother' in t and '1930' in t, 'Beverly: your grandmother, with her years')
        ok('Child of Beverly' in t or 'Child of John' in t, 'whose child each one is')
        ok("From Grandma's album" in t and 'Cleveland, Ohio' in t and 'About 1978' in t, 'source, place and date shown')
        ok("who you're seeing (2)" in t.lower(), 'the heading counts who you\'re seeing')
        ok('Cousins at the lake' not in t, 'a relative\'s unconfirmed upload is not on the owner\'s page')
        await pg.screenshot(path='/tmp/roots_allphotos.png')
        # filters
        await pg.click('[data-kind="document"]'); await pg.wait_for_timeout(150)
        ok(await pg.locator('.pgcard').count() == 1 and 'about' in (await pg.inner_text('.pgcard')).lower(), 'Documents: just the obituary, "About"')
        await pg.click('[data-kind="all"]'); await pg.click('#pgWho'); await pg.fill('#qName', 'Barbara'); await pg.wait_for_timeout(150)
        await pg.click('#qList button >> nth=0'); await pg.wait_for_timeout(200)
        ok(await pg.locator('.pgcard').count() == 1 and 'Only Barbara' in await pg.inner_text('.pgfilters'), 'one person: only Barbara\'s photo')
        await pg.click('#pgWhoX'); await pg.select_option('#pgSort', 'added'); await pg.wait_for_timeout(150)
        first = await pg.inner_text('.pgcard h3 >> nth=0')
        ok(first == 'Obituary' and await pg.locator('.pgdec').count() == 0, f'newest added first, no decade headings: {first}')
        await pg.select_option('#pgSort', 'taken')
        # viewer from the page
        await pg.click('.pgimg >> nth=1'); await pg.wait_for_timeout(250)
        vt = await pg.inner_text('#viewer')
        ok('2 of 4' in vt and 'Thanksgiving' in vt and 'your aunt' in vt, 'a photo opens the viewer on the page\'s list, chips say how they\'re related')
        await pg.keyboard.press('Escape')
        # name opens the card, "See ... on the tree" goes back to the tree
        await pg.click('.pgname >> nth=0'); await pg.wait_for_timeout(250)
        ct = await pg.inner_text('#pCenter')
        ok(ct.startswith('See ') and ct.endswith(' on the tree'), f'card from Photos offers {ct!r}')
        await pg.click('#pCenter'); await pg.wait_for_timeout(500)
        ok(await pg.evaluate("STATE.view") == 'tree' and await pg.locator('#photos').is_hidden(), 'and that switches back to the tree')
        # add from the page
        await pg.click('#btnViewPhotos'); await pg.click('#pgAdd'); await pg.wait_for_timeout(200)
        ok('Add photos or documents' in await pg.inner_text('#panel') and await pg.locator('#qName').count() == 1, 'Add asks whose card first')
        await pg.fill('#qName', 'Debby'); await pg.wait_for_timeout(150); await pg.click('#qList button >> nth=0'); await pg.wait_for_timeout(200)
        ok(await pg.locator('#upGo').count() == 1, 'then the upload form')
        await pg.evaluate("closePanel()")
        await pg.reload(); await pg.wait_for_timeout(2500)
        ok(await pg.evaluate("STATE.view") == 'tree', 'Photos is not remembered: the next visit opens on the tree')
        ok(not errs, f'owner: no page errors {errs}'); await c.close()

        # ---- the relative: sees their own pending one, marked ----
        c, pg, errs = await ctx(REL)
        await pg.click('#btnViewPhotos'); await pg.wait_for_timeout(600)
        t = await pg.inner_text('#photos')
        ok('Cousins at the lake' in t and 'Only you see this' in t, 'the relative sees their own upload, marked')
        ok(await pg.locator('.pgcard.pend').count() == 1, 'with the dashed border')
        ok(not errs, f'relative: no page errors {errs}'); await c.close()

        # ---- phone 360: the top bar fits ----
        c, pg, errs = await ctx(OWNER, owner=True, vp={'width': 360, 'height': 780})
        await pg.click('#btnViewPhotos'); await pg.wait_for_timeout(400)
        over = await pg.evaluate("(() => { const t = document.querySelector('.topbar'); return [t.scrollWidth, t.clientWidth, [...t.querySelectorAll('button')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().right)).reduce((a, x) => Math.max(a, x), 0)]; })()")
        ok(over[0] <= over[1] and over[2] <= 360, f'360 px: top bar fits {over}')
        cover = await pg.evaluate("(() => { const c = document.querySelector('.pghead').getBoundingClientRect().top, t = Math.max(...[...document.querySelectorAll('.topbar,.banner')].filter(e => !e.hidden && e.getClientRects().length).map(e => e.getBoundingClientRect().bottom)); return [Math.round(c), Math.round(t)]; })()")
        ok(cover[0] >= cover[1], f'the page starts below the top bar and owner bar {cover}')
        await pg.screenshot(path='/tmp/roots_allphotos_phone.png', full_page=False)
        ok(not errs, f'phone: no page errors {errs}'); await c.close()
        await b.close()
    print('FAILED: ' + str(len(fails)) if fails else 'all passed')

asyncio.run(main())
