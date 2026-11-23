"""Opening or folding a bud holds your place (2026-11-23, v1.33). Fresh server.js on 8787 plus the site on 8000.
Run: python3 apps-script/test/e2e_holdspot.py
On a phone-sized screen: pan so a far bud sits at the edge, tap it, and check the card it hangs from stays where it
was (the camera used to glide back to the centered person), the new cards come on screen, and the minus that folds
it again leaves that card in place too. Then the same on a desktop-sized screen."""
import asyncio, json, urllib.request, sys
fails = []
def check(n, ok, info=''):
    print(('  ok  ' if ok else '  FAIL ') + n + ('' if ok else '  ' + str(info)))
    if not ok: fails.append(n)
from playwright.async_api import async_playwright
API = 'http://localhost:8787'; SITE = 'http://127.0.0.1:8000'
def post(b):
    r = urllib.request.Request(API, data=json.dumps(b).encode(), headers={'Content-Type': 'text/plain'}); return json.loads(urllib.request.urlopen(r).read())
key = urllib.request.urlopen(API + '/__key').read().decode()
P = lambda ref, first, living='living': {'kind': 'person', 'ref': 'new:' + ref, 'data': {'first_name': first, 'birth_surname': 'Test', 'living': living}}
PC = lambda a, b: {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:' + a, 'b': 'new:' + b}
PT = lambda a, b, s: {'kind': 'relationship', 'type': 'partner', 'a': 'new:' + a, 'b': 'new:' + b, 'subtype': s}
items = [P('gran', 'Gran', 'deceased'), P('gpa', 'Grandpa', 'deceased'), PT('gran', 'gpa', 'married'),
  P('mom', 'Mom'), P('dad', 'Dad'), PT('mom', 'dad', 'married'), PC('gran', 'mom'), PC('gpa', 'mom'),
  P('me', 'Me'), PC('mom', 'me'), PC('dad', 'me'),
  P('dgran', 'Nana', 'deceased'), P('dgpa', 'Pop', 'deceased'), PT('dgran', 'dgpa', 'married'), PC('dgran', 'dad'), PC('dgpa', 'dad'),
  P('ggm', 'Greatgran', 'deceased'), P('ggp', 'Greatpa', 'deceased'), PC('ggm', 'gran'), PC('ggp', 'gran')]
for i, a in enumerate(['Aunt', 'Uncle', 'Auntie']):
    items += [P('s%d' % i, a), PC('gran', 's%d' % i), PC('gpa', 's%d' % i)]
    for j in range(3): items += [P('c%d%d' % (i, j), 'Cousin%d%d' % (i, j)), PC('s%d' % i, 'c%d%d' % (i, j))]
for i, a in enumerate(['Uncdad', 'Auntdad']):
    items += [P('d%d' % i, a), PC('dgran', 'd%d' % i), PC('dgpa', 'd%d' % i)]
o = post({'action': 'submit', 'token': 'ownertokenownertokenowner', 'key': key, 'items': items})
ID = {k[4:]: v for k, v in o['ids'].items()}

async def run(pw, w, h, tag):
    br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx = await br.new_context(viewport={'width': w, 'height': h}, has_touch=w < 640, is_mobile=w < 640)
    await ctx.add_init_script("localStorage.setItem('roots_intro_seen', '1');")
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(f'{SITE}/index.html?nointro&api={API}'); await pg.wait_for_timeout(2500)
    await pg.evaluate(f"STATE.focus = {json.dumps(ID['me'])}; render({{ camera: 'instant' }})"); await pg.wait_for_timeout(1200)
    buds = await pg.evaluate("[...currentLayout.nodes.values()].filter(n => n.kind === 'bud').map(n => [n.id, n.anchor, n.x, n.y, n.label])")
    check(f'{tag}: there are buds to open', len(buds) >= 2, buds)
    bid, anchor, bx, by, label = max(buds, key=lambda b: abs(b[2]) + abs(b[3]) * .5)
    # pan so the bud sits near the screen's edge, like a finger-drag out to it
    side = 1 if bx > 0 else -1
    await pg.evaluate(f"""(() => {{ const s = cam.s, n = currentLayout.nodes.get({json.dumps(bid)});
      cam.x = ({w} / 2 + {side} * ({w} / 2 - 90)) - n.x * s; cam.y = {h} * .5 - n.y * s; cam.tx = cam.x; cam.ty = cam.y; cam.moving = false; applyCam(); }})()""")
    await pg.wait_for_timeout(300)
    center = lambda nid: pg.evaluate(f"(() => {{ const r = live.get({json.dumps(nid)}); const b = r.el.firstChild.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }})()")
    a0 = await center(anchor); f0 = await center(ID['me'])
    bb = await pg.evaluate(f"(() => {{ const b = live.get({json.dumps(bid)}).el.firstChild.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }})()")
    if w < 640: await pg.touchscreen.tap(bb[0], bb[1])
    else: await pg.mouse.click(bb[0], bb[1])
    await pg.wait_for_timeout(1400)
    await pg.screenshot(path=f'/tmp/holdspot_{tag}_open.png')
    opened = await pg.evaluate(f"STATE.open.has({json.dumps(bid[4:])})")
    check(f'{tag}: tapping "{label}" opened it', opened)
    a1 = await center(anchor); f1 = await center(ID['me'])
    drift = ((a1[0] - a0[0]) ** 2 + (a1[1] - a0[1]) ** 2) ** .5
    check(f'{tag}: the card it hangs from stays near your finger (moved {drift:.0f}px)', drift < (w * .45), (a0, a1))
    check(f'{tag}: the anchor card is still on screen', 0 <= a1[0] <= w and 60 <= a1[1] <= h, a1)
    check(f'{tag}: the camera did not glide back to the centered person', abs(f1[0] - w / 2) > 60, (f0, f1))
    new = await pg.evaluate(f"""(() => {{ const out = []; for (const n of currentLayout.nodes.values()) {{
      if (n.kind !== 'person') continue; const b = live.get(n.id).el.firstChild.getBoundingClientRect();
      out.push([n.id, b.left >= -2 && b.right <= {w} + 2 && b.top >= 50 && b.bottom <= {h} + 2]); }} return out; }})()""")
    newids = await pg.evaluate(f"""(() => {{ const k = {json.dumps(bid[4:])}; const before = new Set(); STATE.open.delete(k); const L = layout(); for (const id of L.nodes.keys()) before.add(id); STATE.open.add(k); return [...currentLayout.nodes.keys()].filter(id => !before.has(id) && !id.startsWith('bud:')); }})()""")
    onscreen = [i for i, on in new if i in newids and on]
    span = await pg.evaluate(f"(() => {{ const ids = {json.dumps(newids)}.concat([{json.dumps(anchor)}]); let l = 1e9, r = -1e9; for (const id of ids) {{ const b = live.get(id).el.firstChild.getBoundingClientRect(); l = Math.min(l, b.left); r = Math.max(r, b.right); }} return r - l; }})()")
    need = len(newids) if span <= w - 32 else 1  # wider than the screen: the tapped card stays, as many as fit beside it
    check(f'{tag}: the newly opened cards are on screen ({len(onscreen)} of {len(newids)}, {need} needed)', newids and len(onscreen) >= need, (newids, new))
    if span > w - 32:
        ab = await pg.evaluate(f"(() => {{ const b = live.get({json.dumps(anchor)}).el.firstChild.getBoundingClientRect(); return [b.left, b.right]; }})()")
        check(f'{tag}: too wide to fit, so the view slid as far as it could (the tapped card at the edge)', ab[0] < 30 or ab[1] > w - 30, ab)
    # fold it again with the minus on the anchor card
    fb = await pg.evaluate(f"(() => {{ const f = live.get({json.dumps(anchor)}).el.querySelector('.fold'); if (!f) return null; const b = f.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }})()")
    check(f'{tag}: the minus to fold it is on the card', fb is not None)
    if fb:
        a2 = await center(anchor)
        if w < 640: await pg.touchscreen.tap(fb[0], fb[1])
        else: await pg.mouse.click(fb[0], fb[1])
        await pg.wait_for_timeout(1400)
        await pg.screenshot(path=f'/tmp/holdspot_{tag}_fold.png')
        a3 = await center(anchor)
        d = ((a3[0] - a2[0]) ** 2 + (a3[1] - a2[1]) ** 2) ** .5
        check(f'{tag}: folding leaves the card in place (moved {d:.0f}px)', d < 4, (a2, a3))
        check(f'{tag}: folded again', not await pg.evaluate(f"STATE.open.has({json.dumps(bid[4:])})"))
    # picking a new person still glides to them
    await pg.evaluate(f"STATE.focus = {json.dumps(ID['gran'])}; render()"); await pg.wait_for_timeout(1200)
    g = await center(ID['gran'])
    check(f'{tag}: centering on someone still glides to them', abs(g[0] - w / 2) < 30, g)
    check(f'{tag}: no page errors', not errs, errs)
    await pg.screenshot(path=f'/tmp/holdspot_{tag}.png')
    await br.close()

async def main():
    async with async_playwright() as pw:
        await run(pw, 390, 844, 'phone')
        await run(pw, 1280, 800, 'desktop')
asyncio.run(main())
print('FAILED: ' + ', '.join(fails) if fails else 'clean')
sys.exit(1 if fails else 0)
