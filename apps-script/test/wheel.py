"""Wheel view checks (2026-11-22). Run from the repo root:  python3 apps-script/test/wheel.py
Loads made-up families (the layout audit's messy one with every relationship shape, and a ~500-person random one)
into the real Code.gs behind a local server, switches to the wheel, and centers on every person in turn, checking:
  - it draws without errors, and the whole wheel fits on the screen (desktop and phone)
  - the first ring below the line holds exactly the person's wheel parents (birth first, adoptive only to fill a gap,
    never a step-parent who is only a partner), plus a "+ parent" spot for each one missing
  - the first ring above the line holds exactly their children
  - no more than 5 rings on a wide screen, 3 on a phone
Then on the messy family: Tree / Wheel switch and its memory across a reload, tapping a person opens their card with
"Put them in the middle", which re-centers the wheel, tapping a "+" spot opens Add with Parent chosen, Back to you, and
the wheel's Key. Exits non-zero on any problem. Uses ports 8790-8792."""
import asyncio, os, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
LAY = os.path.join(HERE, 'layout')
SITE = 8790
FAMILIES = [
  ('messy (every shape)', ['messy.py'], '/tmp/roots_messy.json', lambda: 'V'),
  ('random, ~500 people', ['random_family.py', '7'], '/tmp/roots_random.json', lambda: open('/tmp/roots_random_viewer').read()),
]
CHECK = """async (vp) => {
  const errs = [];
  const people = [...G.people.keys()];
  for (const id of people) {
    STATE.focus = id;
    try { renderWheel({ quiet: true }); } catch (e) { errs.push('render ' + id + ': ' + e.message); continue; }
    const svg = document.querySelector('#wheel svg'); if (!svg) { errs.push('no svg for ' + id); continue; }
    const b = svg.querySelector('.hub').getBoundingClientRect();
    // every wedge on screen
    for (const g of svg.querySelectorAll('.wedge')) {
      const r = g.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > vp.w + 1 || r.bottom > vp.h + 1) { errs.push(`[${id}] wedge off screen`); break; }
    }
    const all = [...svg.querySelectorAll('.wedge')];
    if (!all.length && (parentsOf(id).length || childrenOf(id).length)) errs.push(`[${id}] empty wheel`);
    const first = all.filter(g => g.dataset.ring === '1');
    const below = first.filter(g => g.dataset.side === 'anc' && g.dataset.id).map(g => g.dataset.id);
    const adds = first.filter(g => g.dataset.add).map(g => g.dataset.add);
    const above = first.filter(g => g.dataset.side === 'des').map(g => g.dataset.id);
    const wp = P(id).placeholder ? [] : wheelParents(id);
    const want = new Set(wp), got = new Set(below);
    if (!P(id).placeholder && (wp.length !== below.length || wp.some(x => !got.has(x)))) errs.push(`[${id}] parents ring ${below} vs ${wp}`);
    if (!P(id).placeholder && adds.length !== 2 - wp.length) errs.push(`[${id}] ${adds.length} add spots for ${wp.length} parents`);
    if (wp.some(x => !parentsOf(id).includes(x))) errs.push(`[${id}] a non-parent in a parent spot`);
    const kids = childrenOf(id);
    if (kids.length !== above.length || kids.some(k => !above.includes(k))) errs.push(`[${id}] children ring ${above.length} vs ${kids.length}`);
    const rings = Math.max(0, ...all.map(g => +g.dataset.ring));
    if (rings > vp.max) errs.push(`[${id}] ${rings} rings`);
    if (errs.length > 20) break;
  }
  return errs;
}"""
def up(port, tries=40):
    for _ in range(tries):
        try: urllib.request.urlopen(f'http://localhost:{port}/', timeout=1); return
        except Exception: time.sleep(.25)
    raise SystemExit(f'server on {port} did not start')

async def run():
    site = subprocess.Popen([sys.executable, '-m', 'http.server', str(SITE)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fails = 0
    try:
        up(SITE)
        async with async_playwright() as pw:
            br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
            for i, (name, gen, seed, owner) in enumerate(FAMILIES):
                subprocess.run([sys.executable, *gen], cwd=LAY, check=True, stdout=subprocess.DEVNULL)
                port = 8791 + i
                api = subprocess.Popen(['node', 'server.js'], cwd=LAY, env={**os.environ, 'SEED': seed, 'OWNER': owner(), 'PORT': str(port)}, stdout=subprocess.DEVNULL)
                try:
                    up(port)
                    for vw, vh, mx in ((1280, 900, 5), (390, 844, 3)):
                        ctx = await br.new_context(viewport={'width': vw, 'height': vh})
                        pg = await ctx.new_page(); errs = []
                        pg.on('pageerror', lambda e: errs.append(str(e)))
                        await pg.goto(f'http://localhost:{SITE}/index.html?nointro&api=http://localhost:{port}'); await pg.wait_for_timeout(2500)
                        await pg.click('#btnViewWheel'); await pg.wait_for_timeout(300)
                        res = await pg.evaluate(CHECK, {'w': vw, 'h': vh, 'max': mx})
                        res += errs
                        print(f'{name} @ {vw}px: {"ok" if not res else str(len(res)) + " problems"}')
                        for r in res[:12]: print('   ', r)
                        fails += len(res)
                        if i == 0 and vw == 1280: fails += await flows(pg)
                        await ctx.close()
                finally:
                    api.kill()
            await br.close()
    finally:
        site.kill()
    print('FAILED' if fails else 'All wheel checks passed')
    sys.exit(1 if fails else 0)

async def flows(pg):
    bad = []
    def ok(c, msg):
        if not c: bad.append(msg)
    # the switch remembers across a reload
    await pg.reload(); await pg.wait_for_timeout(2500)
    ok(await pg.evaluate("STATE.view") == 'wheel', 'wheel not remembered after reload')
    ok(await pg.is_hidden('#stage'), 'tree still showing on the wheel')
    ok(await pg.is_hidden('#btnAll'), 'Open all showing on the wheel')
    viewer = await pg.evaluate("STATE.focus")
    # tap a parent: their card, then put them in the middle
    pid = await pg.evaluate("wheelParents(STATE.focus)[0]")
    await pg.click(f'#wheel .wedge[data-id="{pid}"]'); await pg.wait_for_timeout(400)
    txt = await pg.inner_text('#pCenter')
    ok(txt.startswith('Put ') and txt.endswith(' in the middle'), f'center button reads {txt!r}')
    ok(await pg.locator(f'#wheel .wedge.sel[data-id="{pid}"]').count() == 1, 'tapped wedge not marked')
    await pg.click('#pCenter'); await pg.wait_for_timeout(400)
    ok(await pg.evaluate("STATE.focus") == pid, 'did not re-center')
    ok(await pg.evaluate(f"document.querySelector('#wheel .hub').dataset.id") == pid, 'hub is not the new center')
    # back to you
    await pg.click('#btnHome'); await pg.wait_for_timeout(300)
    ok(await pg.evaluate("STATE.focus") == viewer, 'Back to you did not return')
    # a + spot opens Add with Parent chosen (center on someone with a missing parent)
    target = await pg.evaluate("[...G.people.keys()].find(x => !P(x).placeholder && wheelParents(x).length < 2)")
    await pg.evaluate(f"STATE.focus = {target!r}; render()"); await pg.wait_for_timeout(300)
    await pg.click(f'#wheel .wedge.add[data-add="{target}"]'); await pg.wait_for_timeout(400)
    ok(await pg.locator('#fRel [data-v="parent"][aria-pressed="true"]').count() == 1, '+ spot did not open Add with Parent')
    await pg.evaluate("closePanel()")
    # the wheel's Key
    await pg.click('#btnKey'); await pg.wait_for_timeout(300)
    ok('Reading the wheel' in await pg.inner_text('#panel'), 'Key is not the wheel key')
    await pg.evaluate("closePanel()")
    # back to the tree
    await pg.click('#btnViewTree'); await pg.wait_for_timeout(900)
    ok(await pg.is_visible('#stage') and await pg.locator('#nodes .card').count() > 0, 'tree did not come back')
    ok(await pg.is_hidden('#wheel'), 'wheel still showing on the tree')
    print('flows:', 'ok' if not bad else bad)
    return len(bad)

asyncio.run(run())
