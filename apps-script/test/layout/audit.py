"""Layout audit: does the tree draw every family shape correctly, from every point of view?
Run from the repo root:  python3 apps-script/test/layout/audit.py
Builds made-up families (a hand-built messy one with every relationship shape we know of, and random ones up to
~500 people), loads each into the real Code.gs behind a local server, then, starting from the default center and
following every bud and every "+N", checks:
  - nobody is unreachable (everyone can be reached by opening buds and tapping +N)
  - no two cards overlap
  - no card sits between a couple whose children hang from their rings
  - centering on anyone draws all of their parents, children, partners and siblings
Exits non-zero on any problem."""
import asyncio, json, os, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SITE = 8796
FAMILIES = [  # (name, generator args, seed file, owner)
  ('messy (every shape)', ['messy.py'], '/tmp/roots_messy.json', lambda: 'V'),
  ('random, ~500 people', ['random_family.py', '7'], '/tmp/roots_random.json', lambda: open('/tmp/roots_random_viewer').read()),
  ('random, small, seed 7', ['random_family.py', '7', 'small'], '/tmp/roots_random.json', lambda: open('/tmp/roots_random_viewer').read()),
  ('random, seed 11', ['random_family.py', '11'], '/tmp/roots_random.json', lambda: open('/tmp/roots_random_viewer').read()),
]
JS = """async () => {
  const people = [...G.people.keys()];
  const ns = id => (P(id).first || '?') + ' ' + (P(id).last || '');
  const res = { overlaps: new Set(), apart: new Set(), errors: [] };
  function check(L, c) {
    const v = [...L.nodes.values()].filter(n => n.kind === 'person' || n.kind === 'bud');
    const w = n => n.kind === 'bud' ? BUDW : (n.id === c ? FW : CW);
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
      const a = v[i], b = v[j]; if (a.g !== b.g) continue;
      if (Math.abs(a.x - b.x) < (w(a) + w(b)) / 2 - 2) res.overlaps.add(`[${ns(c)}] ${a.kind==='bud'?a.label:ns(a.id)} / ${b.kind==='bud'?b.label:ns(b.id)}`);
    }
    for (const e of L.edges) if (e.kind === 'pc' && e.parents.length === 2) {
      const [a, b] = e.parents.map(x => L.nodes.get(x));
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x); const between = [...L.nodes.values()].filter(n => n.kind === 'person' && n.g === a.g && n.x > lo + 1 && n.x < hi - 1);
      if (a.g !== b.g || between.length) res.apart.add(`[${ns(c)}] ${ns(e.child)}'s parents ${ns(a.id)} and ${ns(b.id)} have ${between.map(n=>ns(n.id)).join(', ')} between them`);
    }
  }
  // reachability: start at the default center, open buds (Open all), follow every +N
  const start = STATE.focus, seen = new Set([start]), reached = new Set(), q = [start];
  while (q.length) {
    const c = q.shift(); STATE.focus = c; STATE.open.clear();
    for (const all of [false, true]) {
      STATE.all = all; const L = layout(); check(L, c);
      for (const n of L.nodes.values()) if (n.kind === 'person') { reached.add(n.id); if (all && n.more && !seen.has(n.id)) { seen.add(n.id); q.push(n.id); } }
    }
  }
  STATE.focus = start; STATE.all = false;
  // every person centered: their own close family always drawn?
  const famMiss = [];
  for (const c of people) { if (P(c).placeholder) continue; STATE.focus = c; STATE.all = false; STATE.open.clear(); const L = layout();
    const fam = [...parentsOf(c), ...childrenOf(c), ...partnersOf(c).map(x => x.id), ...siblingsOf(c).map(x => x.id)];
    const budded = new Set([...L.nodes.values()].filter(n => n.kind === 'bud').map(n => n.key));
    fam.forEach(x => { if (!L.nodes.has(x) && !(budded.has('fam:' + x))) famMiss.push(ns(c) + ' -> ' + ns(x)); }); }
  STATE.focus = start;
  const unreached = people.filter(x => !reached.has(x) && !P(x).placeholder).map(ns);
  return { people: people.length, reached: reached.size, unreached, centersVisited: seen.size, overlaps: [...res.overlaps].slice(0, 12), overlapCount: res.overlaps.size, apart: [...res.apart].slice(0, 12), apartCount: res.apart.size, famMiss: famMiss.slice(0, 10), famMissCount: famMiss.length };
}"""

def up(port, tries=40):
    for _ in range(tries):
        try: urllib.request.urlopen(f'http://localhost:{port}', timeout=1); return True
        except Exception: time.sleep(0.25)
    return False

async def run():
    site = subprocess.Popen([sys.executable, '-m', 'http.server', str(SITE)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bad = 0
    try:
        up(SITE)
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for i, (name, gen, seed, owner) in enumerate(FAMILIES):
                subprocess.run([sys.executable, *gen], cwd=HERE, check=True, stdout=subprocess.DEVNULL)
                port = 8797 + i
                api = subprocess.Popen(['node', 'server.js'], cwd=HERE, env={**os.environ, 'SEED': seed, 'OWNER': owner(), 'PORT': str(port)})
                try:
                    up(port)
                    pg = await b.new_page(viewport={'width': 1400, 'height': 900})
                    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
                    await pg.goto(f'http://localhost:{SITE}/index.html?nointro&api=http://localhost:{port}'); await pg.wait_for_timeout(3000)
                    r = await pg.evaluate(JS); await pg.close()
                    probs = len(r['unreached']) + r['overlapCount'] + r['apartCount'] + r['famMissCount'] + len(errs)
                    bad += probs
                    print(f"{'ok  ' if not probs else 'FAIL'} {name}: {r['people']} people, {r['centersVisited']} centers checked, "
                          f"unreachable {len(r['unreached'])}, overlaps {r['overlapCount']}, split couples {r['apartCount']}, missing close family {r['famMissCount']}, page errors {len(errs)}")
                    for k in ('unreached', 'overlaps', 'apart', 'famMiss'):
                        for x in r[k][:5]: print('       ', k, x)
                    for e in errs[:3]: print('        error', e)
                finally:
                    api.terminate()
            await b.close()
    finally:
        site.terminate()
    print('layout audit:', 'clean' if not bad else f'{bad} problems'); sys.exit(1 if bad else 0)

asyncio.run(run())
