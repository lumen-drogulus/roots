"""Privacy views, adoption choice, and photos and documents (2026-11-22). Needs a fresh apps-script/test/server.js on
8787 and the site on 8000 (see e2e.py). Run: python3 apps-script/test/e2e_photos.py
Checks: the public, family and owner views of a living person's card (owner sees his own birthday); gender words for
living people; the Send warning; the "Which one is you?" explainer; the adopted person's choice; adding a photo and a
PDF from a computer (file picker), tagging a second person, the photos showing on both tagged cards marked
Unconfirmed, the viewer, Tag someone, Take back; the phone's three buttons; the approvals page's document warning;
approving, then the public view (a document about a living person stays family-only); an owner upload going live."""
import asyncio, base64, json, struct, urllib.request, zlib
from playwright.async_api import async_playwright
API = 'http://localhost:8787'; SITE = 'http://127.0.0.1:8000'
def post(b): return json.load(urllib.request.urlopen(urllib.request.Request(API, json.dumps(b).encode(), {'Content-Type': 'text/plain'})))
KEY = urllib.request.urlopen(API + '/__key').read().decode()
fails = []
def ok(c, m):
    print(('  ok  ' if c else 'FAIL  ') + m)
    if not c: fails.append(m)

def png(w=40, h=30):
    raw = b''.join(b'\x00' + bytes([200, 120, 60]) * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

OWNER_TOK = 'ownertokenownertokenowner1'
REL_TOK = 'relativetokenrelativetoken1'
KID_TOK = 'adopteetokenadopteetoken12'

async def main():
    seed = post({'action': 'submit', 'token': OWNER_TOK, 'key': KEY, 'items': [
        {'kind': 'person', 'ref': 'new:me', 'data': {'first_name': 'Jonny', 'birth_surname': 'Hale', 'living': 'living', 'sex': 'male',
            'birth_date': 'exact:1983-05-11', 'birth_place': 'Westminster, CA'}},
        {'kind': 'person', 'ref': 'new:mom', 'data': {'first_name': 'Carol', 'birth_surname': 'Maidenly', 'married_names': ['Hale'], 'living': 'living',
            'sex': 'female', 'birth_date': 'exact:1950-01-02', 'birth_place': 'Cleveland, Ohio', 'notes': 'Carol tells the best stories'}},
        {'kind': 'person', 'ref': 'new:kid', 'data': {'first_name': 'Sam', 'birth_surname': 'Hale', 'living': 'living', 'sex': 'male'}},
        {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:mom', 'b': 'new:me'},
        {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:me', 'b': 'new:kid', 'subtype': 'adopted'},
        {'kind': 'claim', 'person': 'new:me'}]})
    ids = seed['ids']; ME, MOM, KID = ids['new:me'], ids['new:mom'], ids['new:kid']
    # The relative (Linda) is confirmed as herself; the adoptee (Sam) as himself.
    lr = post({'action': 'submit', 'token': REL_TOK, 'display_name': 'Linda', 'items': [
        {'kind': 'person', 'ref': 'new:l', 'data': {'first_name': 'Linda', 'birth_surname': 'Hale', 'living': 'living'}},
        {'kind': 'relationship', 'type': 'parent_child', 'a': MOM, 'b': 'new:l'}, {'kind': 'claim', 'person': 'new:l'}]})
    post({'action': 'submit', 'token': KID_TOK, 'items': [{'kind': 'claim', 'person': KID}]})
    q = post({'action': 'admin_queue', 'key': KEY})
    LINDA = lr['ids']['new:l']
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctx(tok=None, owner=False, vp=None, intro=True):
            c = await b.new_context(viewport=vp or {'width': 1280, 'height': 850})
            init = (f"localStorage.setItem('roots_token',{json.dumps(tok)});" if tok else '') + ("localStorage.setItem('roots_intro_seen','1');" if intro else '')
            if owner: init += f"localStorage.setItem('roots_admin_key',{json.dumps(KEY)});"
            await c.add_init_script(init)
            pg = await c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            return c, pg, errs
        async def card(pg, pid):
            await pg.evaluate(f"openPerson({json.dumps(pid)})"); await pg.wait_for_timeout(300)
            return await pg.inner_text('#panel')

        # ---- public: a stranger ----
        c, pg, errs = await ctx('strangertokenstrangertoken1', intro=False)
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_selector('#intro.on', timeout=20000)
        await pg.click('#iNext'); await pg.click('#iNext'); await pg.wait_for_timeout(200)
        ok('some things stay hidden from you' in await pg.inner_text('#intro'), 'public: "Which one is you?" says what stays hidden until confirmed')
        await pg.click('#iNext'); await pg.wait_for_timeout(800)
        t = await card(pg, MOM)
        ok('1950' in t and 'January' not in t and 'Cleveland' not in t and 'best stories' not in t, 'public: birth year only, no birthday, place or story')
        ok('Maidenly' in t, 'public: maiden name shows')
        ok('show to family once' in t and await pg.locator('#pFindMe').count() == 1, 'public: note explains, with Find me or add me')
        ok(await pg.evaluate(f"relation({json.dumps(MOM)})") == '', 'public: no viewer yet, so no relation word (sanity)')
        await pg.evaluate("closePanel()"); await pg.click('#btnSend'); await pg.wait_for_timeout(300)
        st = await pg.inner_text('#panel')
        ok('Think about who you send this to' in st and 'no passwords' in st, 'Send: the warning shows')
        await pg.screenshot(path='/tmp/roots_send.png')
        ok(not errs, f'public: no page errors {errs}'); await c.close()

        # ---- family: Linda once confirmed ----
        post({'action': 'admin_approve', 'key': KEY, 'items': [{'kind': i['kind'], 'id': i['row']['id']} for bt in q['batches'] for i in bt['items']]})
        c, pg, errs = await ctx(REL_TOK)
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        ok(await pg.evaluate("VIEW()") == 'family', 'family: the server says family view')
        t = await card(pg, MOM)
        ok('January 2, 1950' in t and 'Cleveland' in t and 'best stories' in t, 'family: birthday, birthplace and story show')
        ok('because Jonny Ruzicka has confirmed you' in t, 'family: note says why')
        ok(await pg.evaluate(f"relation({json.dumps(MOM)})") == 'Mother', 'gender words for the living: Mother')
        ok(await pg.evaluate(f"relation({json.dumps(ME)})") == 'Brother', 'gender words for the living: Brother')
        await pg.screenshot(path='/tmp/roots_family_card.png')
        t = await card(pg, KID)
        ok('adopted' not in t.lower(), 'family: Sam\'s adoption stays private for others')

        # ---- upload from a computer: a photo and a PDF, tagged on Carol plus Jonny ----
        await card(pg, MOM)
        await pg.click('#pAddPhoto'); await pg.wait_for_timeout(200)
        ok(await pg.locator('[data-pick="upFile"]').count() == 1 and await pg.locator('#upDrop').count() == 1 and await pg.locator('[data-pick="upCam"]').count() == 0,
           'computer: "Choose files from your computer" and the drop zone, no camera button')
        await pg.set_input_files('#upFile', [{'name': 'reunion.png', 'mimeType': 'image/png', 'buffer': png()},
                                             {'name': 'certificate.pdf', 'mimeType': 'application/pdf', 'buffer': PDF}])
        await pg.wait_for_timeout(300)
        ok(await pg.locator('.uprow').count() == 2, 'two files listed')
        kinds = await pg.evaluate("[...document.querySelectorAll('.uprow')].map(r => r.querySelector('.seg [aria-pressed=\"true\"]').dataset.v)")
        ok(kinds == ['photo', 'document'], f'kind guessed: PNG photo, PDF document ({kinds})')
        await pg.fill('.uprow >> nth=0 >> .upcap', 'Reunion at the park'); await pg.fill('.uprow >> nth=0 >> .upwhen', 'about 1995')
        await pg.fill('.uprow >> nth=1 >> .upcap', 'Birth certificate')
        await pg.fill('#upTagQ', 'Jonny'); await pg.wait_for_timeout(150); await pg.click('#upTagList button >> nth=0')
        ok(await pg.locator('#upTags .chip').count() == 2, 'tagged Carol and Jonny')
        ok((await pg.inner_text('#upGo')) == 'Upload 2', 'button reads Upload 2')
        await pg.screenshot(path='/tmp/roots_upload.png')
        await pg.click('#upGo'); await pg.wait_for_timeout(3500)
        t = await card(pg, MOM)
        ok(await pg.locator('#panel .photo.real.pend').count() == 2, 'Carol\'s card: both show, marked Unconfirmed')
        ok(await pg.locator('#panel .photo.real img').count() >= 1, 'the photo has its preview from the upload')
        await card(pg, ME)
        ok(await pg.locator('#panel .photo.real').count() == 2, 'Jonny\'s card: tagged, so they show there too')
        await pg.screenshot(path='/tmp/roots_card_photos.png')
        # viewer
        await pg.click('#panel .photo.real >> nth=0'); await pg.wait_for_timeout(300)
        vt = await pg.inner_text('#viewer')
        ok(not await pg.locator('#viewer').is_hidden() and '1 of 2' in vt and 'Unconfirmed' in vt, 'viewer opens: 1 of 2, Unconfirmed')
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(150)
        ok('2 of 2' in await pg.inner_text('#viewer'), 'arrow key moves to the next')
        await pg.screenshot(path='/tmp/roots_viewer.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        ok(await pg.locator('#viewer').is_hidden(), 'Escape closes the viewer')
        rows = post({'action': 'admin_tree', 'key': KEY})['Photos']
        ok(sorted((r['kind'], r['mime']) for r in rows) == [('document', 'application/pdf'), ('photo', 'image/jpeg')], f'stored as photo (shrunk to JPEG) and document (PDF as is): {[(r["kind"], r["mime"]) for r in rows]}')
        ok(not errs, f'family: no page errors {errs}'); await c.close()

        # ---- the adoptee decides ----
        c, pg, errs = await ctx(KID_TOK)
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        t = await card(pg, KID)
        ok('without saying you were adopted' in t and await pg.locator('#pAdopt').count() == 1, 'Sam\'s own card asks about his adoption')
        await pg.screenshot(path='/tmp/roots_adopt.png')
        await pg.click('#pAdopt'); await pg.wait_for_timeout(2500)
        ok(next(r for r in post({'action': 'tree', 'token': 'x' * 24})['relationships'] if r['b'] == KID)['subtype'] == 'adopted', 'after Show it: the public tree shows adopted')
        ok('Keep it private' in await pg.inner_text('#panel'), 'and the button now offers Keep it private')
        ok(not errs, f'adoptee: no page errors {errs}'); await c.close()

        # ---- phone: the three buttons ----
        c = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        await c.add_init_script(f"localStorage.setItem('roots_token',{json.dumps(REL_TOK)});localStorage.setItem('roots_intro_seen','1')")
        pg = await c.new_page(); await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        await card(pg, MOM); await pg.click('#pAddPhoto'); await pg.wait_for_timeout(200)
        btns = await pg.evaluate("[...document.querySelectorAll('[data-pick]')].map(b => b.textContent.trim())")
        ok(btns == ['Choose from your photos', 'Take a photo', 'Choose a file'], f'phone: {btns}')
        await pg.screenshot(path='/tmp/roots_upload_phone.png'); await c.close()

        # ---- approvals page: document warning, approve ----
        c, pg, errs = await ctx(OWNER_TOK, owner=True)
        await pg.goto(f'{SITE}/admin.html?api={API}'); await pg.wait_for_function("document.querySelectorAll('.livingwarn').length >= 2", timeout=20000)
        at = ' '.join((await pg.inner_text('#queue')).split())
        ok('new document' in at.lower() and 'Document about 2 living people' in at and 'confirmed family only' in at, 'approvals: the document warning')
        ok('new photo' in at.lower() and 'Approving makes this photo public' in at, 'approvals: the photo warning')
        ok(await pg.locator('#queue a.btn:has-text("Open the file")').count() == 2, 'approvals: Open the file on each')
        await pg.screenshot(path='/tmp/roots_admin_docs.png', full_page=True)
        for _ in range(2):
            await pg.click('.batch [data-all="approve"] >> nth=0'); await pg.wait_for_timeout(2500)
        pub = post({'action': 'tree', 'token': 'y' * 24})['photos']
        ok([f['caption'] for f in pub] == ['Reunion at the park'], f'public sees the photo, not the certificate about living Carol: {[f["caption"] for f in pub]}')
        fam = post({'action': 'tree', 'token': REL_TOK})['photos']
        ok(len(fam) == 2, 'family sees both')

        # ---- owner: his own birthday, and an upload that goes live ----
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        ok(await pg.evaluate("VIEW()") == 'owner', 'owner: the server says owner view')
        t = await card(pg, ME)
        ok('May 11, 1983' in t and 'Westminster' in t, 'owner sees his own birthday and birthplace')
        t = await card(pg, KID)
        ok('adopted' in t.lower(), 'owner sees the adoption')
        await card(pg, ME); await pg.click('#pAddPhoto')
        await pg.set_input_files('#upFile', [{'name': 'me.png', 'mimeType': 'image/png', 'buffer': png(20, 20)}])
        await pg.click('#upGo'); await pg.wait_for_timeout(3000)
        ok(len(post({'action': 'tree', 'token': 'z' * 24})['photos']) == 2, 'owner upload is live at once')
        ok(not errs, f'owner: no page errors {errs}'); await c.close()

        # ---- tag someone from the viewer, as Linda ----
        c, pg, errs = await ctx(REL_TOK)
        await pg.goto(f'{SITE}/index.html?api={API}'); await pg.wait_for_timeout(2500)
        await card(pg, MOM); await pg.click('#panel .photo.real >> nth=0'); await pg.wait_for_timeout(300)
        await pg.click('#vTag'); await pg.fill('#vTagQ', 'Linda'); await pg.wait_for_timeout(150)
        await pg.click('#vTagList button >> nth=0'); await pg.wait_for_timeout(2500)
        ok('unconfirmed' in (await pg.inner_text('#viewer')).lower(), 'Tag someone: Linda shows as an unconfirmed tag')
        await pg.keyboard.press('Escape')
        await card(pg, LINDA)
        ok(await pg.locator('#panel .photo.real').count() == 1, 'and the photo is on Linda\'s card for her')
        ok(not errs, f'tagging: no page errors {errs}'); await c.close()
        await b.close()
    print('FAILED: ' + str(len(fails)) if fails else 'all passed')

asyncio.run(main())
