import re
src = open('prototype/index.html').read()
style = src.split('<style>', 1)[1].split('</style>', 1)[0]
body = src.split('<body>', 1)[1].split('<script>', 1)[0]
script = src.split('<script>', 1)[1].rsplit('</script>', 1)[0]

def between(s, a, b, inclusive_b=False):
    i = s.index(a); j = s.index(b, i)
    return s[i:j + (len(b) if inclusive_b else 0)]
def rep(s, old, new):
    assert old in s, ('missing', old[:90]); return s.replace(old, new, 1)

# ---------------- CSS ----------------
style = re.sub(r"\.sample \{[^}]*\}\n", "", style)
style = re.sub(r"/\* prototype-only options \*/.*?(?=@media \(prefers-reduced-motion)", "", style, flags=re.S)
style = style.replace("/* Roots, Forest and gilt.", "/* Roots tree page. Forest and gilt.")
style += open('build/app-extra.css').read()
open('assets/app.css', 'w').write(style.strip() + '\n')

# ---------------- HTML ----------------
body = re.sub(r'<div class="sample">.*?</div>\n', '', body)
i = body.index('<div class="mock">'); j = body.index('<div class="builtby">')
body = body[:i] + body[j:]
assert 'Prototype options' not in body
body = rep(body, '<div class="scrim" id="scrim"></div>', '''<div class="state" id="loading"><p>Growing the tree…</p></div>
<div class="state" id="empty" hidden></div>
<div class="banner owner" id="ownerBar" hidden>Owner mode: what you add goes live right away.<a href="admin.html">Approvals</a></div>
<div class="banner paused" id="paused" hidden>Adding is paused for a little while. You can still look around.</div>
<div class="mebar" id="meBar" hidden><span>Are you on the tree?</span><button class="primary" id="meYes">Find me or add me</button><button class="iconbtn" id="meNo">Not now</button></div>

<div class="scrim" id="scrim"></div>''')
# Version number (Jonny, 2026-11-22): 1.0 was the launch (d58d1bb, 2026-11-20); every update since adds .01.
# Bump build/VERSION by one with each deploy. Shown after "Built by", and in version.json.
VERSION = open('build/VERSION').read().strip()
body = rep(body, '<span>Built by Jonny Ruzicka</span>', f'<span>Built by Jonny Ruzicka</span><span class="ver" title="Roots version">v{VERSION}</span>')
# Review after saving (2026-11-22): what was just sent, laid out to read, with Edit. Sits above the buttons.
body = rep(body, '''    <div class="actions" style="justify-content:center">
      <button class="primary" id="thanksBack">''', '''    <div class="review" id="thanksReview" hidden></div>
    <div class="actions" style="justify-content:center">
      <button class="primary" id="thanksBack">''')
# Guide is called Help (2026-11-22): the word older relatives look for.
body = rep(body, '<span class="lbl">Guide</span>', '<span class="lbl">Help</span>')
# "Show all" became a menu of four levels (2026-11-22, see build/app-levels.js); the label shows the current one.
body = rep(body, 'aria-label="Show all branches"', 'aria-label="Choose how much of the family to show"')
body = rep(body, '<span class="lbl">Show all</span>', '<span class="lbl">Close family</span><svg class="caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')
# Wheel view (2026-11-22): a Tree / Wheel switch in the top bar, and the wheel's own layer beside the tree's.
body = rep(body, '  <button class="iconbtn" id="btnSearch"', '''  <div class="viewsw" role="group" aria-label="View">
    <button id="btnViewTree" aria-pressed="true" aria-label="Tree view"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="4" rx="1.5"/><rect x="3" y="16" width="6" height="4" rx="1.5"/><rect x="15" y="16" width="6" height="4" rx="1.5"/><path d="M12 7v4M6 16v-3h12v3"/></svg><span class="lbl">Tree</span></button>
    <button id="btnViewWheel" aria-pressed="false" aria-label="Wheel view"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10"/><path d="M2 12h7M15 12h7"/></svg><span class="lbl">Wheel</span></button>
  </div>
  <button class="iconbtn" id="btnSearch"''')
body = rep(body, '</main>\n', '</main>\n<div id="wheel" hidden></div>\n')
head = open('build/head.html').read()
open('index.html', 'w').write(head + '<body>' + body + '<script src="config.js"></script>\n<script src="assets/app.js"></script>\n</body>\n</html>\n')

# ---------------- JS ----------------
engine = between(script, "/* =====================================================================\n * Graph", "/* =====================================================================\n * Pop-out person panel")
keyjs = between(script, "/* ---- key: every symbol", "$('#btnKey').onclick = openKey;", inclusive_b=True)
engine = rep(engine, "  data.rels.forEach(([t, a, b, sub, pend]) => {", "  data.rels.forEach(([t, a, b, sub, pend]) => {\n    if (!g.people.has(a) || !g.people.has(b)) return;")
engine = rep(engine, "const isLiving = p => !!p.living || (!p.died && !p.placeholder && !(p.born && +String(p.born).replace(/\\D/g, '') < new Date().getFullYear() - 110));",
             "const isLiving = p => !p.placeholder && !!p.living;")
engine = rep(engine, "const STATE = { viewer: SAMPLE.viewer, focus: SAMPLE.viewer, open: new Set(), all: false, rootsBelow: true, selected: null };",
             "const STATE = { viewer: null, owner: null, focus: null, open: new Set(), level: 0, rootsBelow: true, selected: null };")
# Levels (2026-11-22): 0 close family, 1 every bud open, 2 all relatives, 3 plus in-laws. Buds count as open from level 1.
engine = rep(engine, "const isOpen = k => STATE.all || STATE.open.has(k);", "const isOpen = k => STATE.level >= 1 || STATE.open.has(k);")
engine = rep(engine, "  if (!STATE.all) for (const key of STATE.open) {", "  if (STATE.level < 1) for (const key of STATE.open) {")
engine = rep(engine, "  const v = STATE.viewer;\n  if (id === v) return 'You';", "  const v = STATE.viewer;\n  if (!v) return '';\n  if (id === v) return 'You';")
engine = rep(engine, "$('#btnHome').onclick = () => { closePanel(); STATE.focus = STATE.viewer; render(); };\n", "")
engine = rep(engine, "function render(opts = {}) {\n", "function render(opts = {}) {\n  if (!STATE.focus || !G.people.has(STATE.focus)) return;\n")
# Step, adoptive and foster parents: labels, separate lines, thinner dashed style.
engine = rep(engine, "const parentsOf = id => G.parents.get(id) || [];",
  "const parentsOf = id => G.parents.get(id) || [];\nconst pcKind = (a, b) => { const s = G.pcSub.get(a + '>' + b); return s === 'step' || s === 'adopted' || s === 'foster' ? s : ''; };")
engine = rep(engine, "  if (/^U+$/.test(path)) {",
  """  if (path === 'U' || path === 'D') {
    const k = path === 'U' ? pcKind(id, v) : pcKind(v, id);
    if (k === 'step') return path === 'U' ? w('Stepfather', 'Stepmother', 'Step-parent') : w('Stepson', 'Stepdaughter', 'Stepchild');
    if (k === 'adopted') return path === 'U' ? w('Adoptive father', 'Adoptive mother', 'Adoptive parent') : w('Adopted son', 'Adopted daughter', 'Adopted child');
    if (k === 'foster') return path === 'U' ? w('Foster father', 'Foster mother', 'Foster parent') : w('Foster son', 'Foster daughter', 'Foster child');
  }
  if (/^U+$/.test(path)) {""")
engine = rep(engine, "    const couple = pars.length === 2 && partnersOf(pars[0]).some(x => x.id === pars[1]);",
  "    // A couple shares one line from their rings, even when one is a step-parent (separate lines cross the other children's).\n    const couple = pars.length === 2 && partnersOf(pars[0]).some(x => x.id === pars[1]);")
engine = rep(engine, "      half: gp.length === 1 && parentsOf(n.id).length === 2 }));",
  "      half: (gp.length === 1 && parentsOf(n.id).length === 2 && parentsOf(n.id).every(x => !pcKind(x, n.id))) || !!n.half }));")
engine = rep(engine, "    r.dash = e.pending || P(e.child).placeholder || e.parents.some(x => P(x).placeholder) ? '0.02 0.03' : null;",
  "    const nonBirth = e.parents.every(x => pcKind(x, e.child));\n    if (nonBirth) el.style.strokeWidth = Math.max(1.1, (3.4 - gen * 0.55) * 0.6);\n    r.dash = e.pending || P(e.child).placeholder || e.parents.some(x => P(x).placeholder) ? '0.02 0.03' : nonBirth ? '0.07 0.045' : null;")
keyjs = rep(keyjs, "      ${row(keyLine('M46 31 C46 18 46 16 46 3', { dash: '2 4' }),",
  "      ${row(keyLine('M46 31 C46 18 46 16 46 3', { dash: '7 4', w: 1.6 }), 'Step, adoptive or foster parent', 'A thinner dashed line. With a birth parent beside them, they share the birth line; the card says Stepmother, Stepchild and so on.')}\n      ${row(keyLine('M46 31 C46 18 46 16 46 3', { dash: '2 4' }),")
# Cards: the name people use. Goes-by in quotes, else a middle initial, so two relatives with the same name differ.
engine = rep(engine, "function displayName(p) {",
  "function cardName(p) {\n  if (p.placeholder) return 'Unknown';\n  const nickOf = x => { const n = (x.nicknames || '').split(',')[0].trim(); return n && !sameNameE(n, x.first) ? n : ''; };\n  const short = x => [x.first, nickOf(x) ? `\"${nickOf(x)}\"` : x.middle ? x.middle.trim()[0] + '.' : '', x.last].filter(Boolean).join(' ');\n  const base = short(p);\n  // Two people who would read the same (a father and son both going by Jonny) also get their middle initial.\n  const clash = nickOf(p) && p.middle && [...G.people.values()].some(x => x.id !== p.id && !x.placeholder && short(x) === base);\n  return clash ? [p.first, `\"${nickOf(p)}\"`, p.middle.trim()[0] + '.', p.last].join(' ') : base;\n}\nconst sameNameE = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();\nfunction displayName(p) {")
engine = rep(engine, "<span class=\"nm\">${p.placeholder ? 'Unknown' : esc(displayName(p))}</span>", "<span class=\"nm\">${esc(cardName(p))}</span>")
# A relative's own unconfirmed changes to a confirmed person: same dashed card, tagged "Your edit".
engine = rep(engine, "+ (p.pending ? '<span class=\"tag\">Unconfirmed</span>' : '')", "+ (p.pending ? '<span class=\"tag\" data-info=\"' + TAG_INFO.pending + '\">Unconfirmed</span>' : p.edits ? '<span class=\"tag\" data-info=\"' + TAG_INFO.edit + '\">Your edit</span>' : '')")
engine = rep(engine, "(p.pending ? ' pending' : '')", "(p.pending || p.edits ? ' pending' : '')")
# A parent's other partner is a step-parent to the centered person: show them, don't fold them into a bud.
engine = rep(engine, "if (others.length) { if (isOpen('op:' + id)) t.extras.push(", "if (others.length) { if (depth === 1 || isOpen('op:' + id)) t.extras.push(")
# Step-siblings: a step-parent's other children. Labeled, and placed beside that step-parent's side of the tree.
engine = rep(engine, "  if (path === 'UP') return w('Stepfather', 'Stepmother', 'Step-parent');",
  "  if (path === 'UP') return w('Stepfather', 'Stepmother', 'Step-parent');\n  if (path === 'UPD' && !siblingsOf(v).some(x => x.id === id)) return w('Stepbrother', 'Stepsister', 'Step-sibling');")
engine = rep(engine, "  /* ---- married-in families (partners of the centered person and of their children) ---- */",
  """  /* ---- step-siblings: children of the centered person's step-parents, on that step-parent's side ---- */
  {
    const mine = parentsOf(F);
    const steps = [...new Set(mine.flatMap(pp => partnersOf(pp).map(x => x.id)))].filter(sp => !mine.includes(sp) && nodes.has(sp));
    for (const sp of steps) {
      const kids = childrenOf(sp).filter(c => c !== F && !nodes.has(c) && !parentsOf(c).some(x => mine.includes(x)));
      if (!kids.length) continue;
      const dir = nodes.get(sp).x >= 0 ? 1 : -1;
      let kx = nodes.get(sp).x;
      const block = kids.map(k => { const n = { id: k, x: kx, y: 0, g: 0, kind: 'person', sibling: true }; kx += dir * (CW + GAP); return n; });
      placeBlock(block, dir);
    }
  }

  /* ---- married-in families (partners of the centered person and of their children) ---- */""")
# Half-siblings sit on the side of the parent they share, so their line drops down instead of crossing the tree.
# Full siblings go on the side with fewer of the person's partners, left on a tie (2026-11-21: centered on Amanda, her
# ex sat left and her siblings were pushed out past him, reading as his family). Right-side half-siblings go past any
# current partners.
engine = rep(engine, between(engine, "  /* ---- siblings of the centered person (left), with their families folded ---- */", "  /* ---- step-siblings"),
  """  /* ---- siblings of the centered person, with their families folded: full on the side with fewer partners (left on a
     tie), half on their shared parent's side ---- */
  const sibs = siblingsOf(F).filter(s => !nodes.has(s.id));
  sibs.sort((a, b) => a.half - b.half);
  const myPars = parentsOf(F);
  const ptX = partnersOf(F).map(x => nodes.get(x.id)).filter(n => n && n.y === 0).map(n => n.x);
  const fullDir = ptX.filter(x => x < 0).length > ptX.filter(x => x > 0).length ? 1 : -1;
  const sibSide = s => {
    if (!s.half) return fullDir;
    const shared = parentsOf(s.id).filter(x => myPars.includes(x) && nodes.has(x));
    return shared.length === 1 && nodes.get(shared[0]).x > 0 ? 1 : -1;
  };
  for (const s of sibs) {
    const dir = sibSide(s), cx = (dir < 0 ? lx : rx) + dir * CW / 2;
    const block = [{ id: s.id, x: cx, y: 0, g: 0, kind: 'person', sibling: true, half: s.half }];
    const fam = partnersOf(s.id).length + childrenOf(s.id).length;
    if (fam) {
      if (isOpen('fam:' + s.id)) {
        // the same couples layout as descendants: partners beside the sibling, each couple's children under it
        const u = descUnit(s.id, 1);
        block.length = 0;
        descPlace(u, dir < 0 ? (lx - u.R) : (rx + u.L), 0, block);
        Object.assign(block[0], { sibling: true, half: s.half });
      } else {
        block.push({ id: 'bud:fam:' + s.id, key: 'fam:' + s.id, x: cx, y: -(STATE.rootsBelow ? 1 : -1) * (CH / 2 + 26), g: -0.5, kind: 'bud', label: (P(s.id).first || '') + "'s family", count: fam, anchor: s.id });
      }
    }
    placeBlock(block, dir);
    const spans = block.filter(n => n.g === 0).map(n => nodeSpan(n));
    if (dir < 0) lx = Math.min(...spans.map(x => x[0])) - GAP; else rx = Math.max(...spans.map(x => x[1])) + GAP;
  }

""")
# Aunts and uncles: an ancestor's sibling folds their own partner and children (the centered person's cousins)
# into a "Barbara's family" bud, tucked toward the children's row, the same way the centered person's siblings do.
engine = rep(engine, "  /* ---- married-in families (partners of the centered person and of their children) ---- */",
  """  /* ---- aunts and uncles: their partners and children (cousins), folded into a family bud ---- */
  for (const n of [...nodes.values()].filter(n => n.kind === 'person' && n.extraOf && !n.partnerOf && n.g > 0)) {
    const s = n.id, host = nodes.get(n.extraOf);
    const dir = host && n.x < host.x ? -1 : 1, down = STATE.rootsBelow ? -1 : 1;
    const pts = partnersOf(s).map(x => x.id).filter(x => !nodes.has(x));
    const ks = childrenOf(s).filter(x => !nodes.has(x));
    if (!pts.length && !ks.length) continue;
    const key = 'fam:' + s;
    if (!isOpen(key)) {
      placeBlock([{ id: 'bud:' + key, key, x: n.x, y: n.y + down * (CH / 2 + 26), g: n.g - 0.5, kind: 'bud', label: (P(s).first || 'Their') + "'s family", count: pts.length + ks.length, anchor: s }], dir);
      continue;
    }
    // Their partners already sit beside them in the row (see withPartners); each couple's children go under that couple.
    const prt = partnersOf(s).map(x => x.id).filter(x => nodes.has(x) && nodes.get(x).partnerOf === s);
    const byOther = new Map();
    ks.forEach(k => { const o = parentsOf(k).find(pp => prt.includes(pp)) || ''; if (!byOther.has(o)) byOther.set(o, []); byOther.get(o).push(k); });
    for (const [o, kids] of byOther) {
      const mid = o ? (n.x + nodes.get(o).x) / 2 : n.x;
      if (STATE.level >= 2) {
        // All relatives: each cousin with their partners and every generation below, the descendants' couples layout.
        const units = kids.map(k => descUnit(k, 1));
        const total = units.reduce((t, u) => t + u.L + u.R, 0) + (units.length - 1) * GAP;
        let kx = mid - total / 2;
        const block = [];
        units.forEach(u => { descPlace(u, kx + u.L, n.g - 1, block); kx += u.L + u.R + GAP; });
        const seenB = new Set();
        placeBlock(block.filter(b => !nodes.has(b.id) && !seenB.has(b.id) && seenB.add(b.id)), dir);
        continue;
      }
      let kx = mid - (kids.length * CW + (kids.length - 1) * GAP) / 2;
      placeBlock(kids.map(k => { const c = { id: k, x: kx + CW / 2, y: genY(n.g - 1), g: n.g - 1, kind: 'person' }; kx += CW + GAP; return c; }), dir);
    }
  }

  /* ---- married-in families (partners of the centered person and of their children) ---- */""")
# Former partners (never married, not together now) draw and read like divorced ones.
engine = rep(engine, "return sub === 'divorced' ? 'Former partner'", "return isFormer(sub) ? 'Former partner'")
engine = rep(engine, "prts.filter(pt => pt.sub !== 'divorced'), former = prts.filter(pt => pt.sub === 'divorced');", "prts.filter(pt => !isFormer(pt.sub)), former = prts.filter(pt => isFormer(pt.sub));")
engine = rep(engine, "(partnersOf(u.id).find(x => x.id === pid) || {}).sub === 'divorced');", "isFormer((partnersOf(u.id).find(x => x.id === pid) || {}).sub));")
engine = rep(engine, "cls += ' partner' + (e.sub === 'divorced' ? ' former' : '');", "cls += ' partner' + (isFormer(e.sub) ? ' former' : '');")
engine = rep(engine, "r.dash = e.sub === 'divorced' ? '0.05 0.05' : null;", "r.dash = isFormer(e.sub) ? '0.05 0.05' : null;")
engine = rep(engine, "r.deco.style.opacity = sub === 'divorced' ? .4 : 1;", "r.deco.style.opacity = isFormer(sub) ? .4 : 1;")
engine = rep(engine, "const parentsOf = id => G.parents.get(id) || [];", "const parentsOf = id => G.parents.get(id) || [];\nconst isFormer = s => s === 'divorced' || s === 'former';")
# ---- Couples: every partner sits beside the person, and each couple's children hang from that couple's rings. ----
# Before: a second current partner sat past the first, so the second couple's children drew from the first couple's
# rings (they read as the wrong spouse's), and a unit's width ignored that its children hang off-center, so cousins
# overlapped. Now: current partners right, former left, each side filled once before either doubles up (partners who
# share the most children sit nearest), and child groups are laid out left to right under their own couple.
engine = rep(engine, between(engine, "  /* ---- the centered person's row", "  /* ---- siblings of the centered person"),
  """  /* ---- partners beside a person: current right, former left, one each side before either doubles up ---- */
  function splitSides(id, pts) {
    const n = pid => childrenOf(id).filter(c => parentsOf(c).includes(pid)).length;
    const byKids = a => [...a].sort((x, y) => n(y.id) - n(x.id)).map(x => x.id);
    const right = byKids(pts.filter(pt => !isFormer(pt.sub))), left = byKids(pts.filter(pt => isFormer(pt.sub)));
    if (right.length > 1 && !left.length) left.push(right.pop());
    else if (left.length > 1 && !right.length) right.push(left.pop());
    return { left, right };
  }

  /* ---- the centered person's row ---- */
  const sidesF = splitSides(F, partnersOf(F).filter(pt => !nodes.has(pt.id)));
  const current = sidesF.right.map(id => ({ id })), former = sidesF.left.map(id => ({ id }));
  let rx = FW / 2 + CG, lx = -(FW / 2 + CG);
  const sideOf = {};
  sidesF.right.forEach(pid => { addNode(pid, rx + CW / 2, 0, { partnerOf: F }); occupy(0, rx, rx + CW); sideOf[pid] = 1; rx += CW + CG; });
  sidesF.left.forEach(pid => { addNode(pid, lx - CW / 2, 0, { partnerOf: F }); occupy(0, lx - CW, lx); sideOf[pid] = -1; lx -= CW + CG; });

  /* ---- descendants: each couple's children under that couple ---- */
  // A unit is measured from its person's x: L and R are how far it reaches left and right, every generation included.
  function descUnit(id, depth) {
    const u = { id, cards: [], groups: [], bud: null };
    const s = splitSides(id, partnersOf(id));
    s.right.forEach((pid, i) => u.cards.push({ id: pid, dx: (i + 1) * (CW + CG) }));
    s.left.forEach((pid, i) => u.cards.push({ id: pid, dx: -(i + 1) * (CW + CG) }));
    const midOf = pid => { const c = u.cards.find(c => c.id === pid); return c ? c.dx / 2 : 0; };
    let L = CW / 2 + s.left.length * (CW + CG), R = CW / 2 + s.right.length * (CW + CG);
    const kids = childrenOf(id);
    if (kids.length && (depth < MAX_DOWN || isOpen('down:' + id))) {
      const byOther = new Map();
      kids.forEach(k => { const o = parentsOf(k).find(pp => pp !== id && u.cards.some(c => c.id === pp)) || ''; if (!byOther.has(o)) byOther.set(o, []); byOther.get(o).push(k); });
      const order = [...[...s.left].reverse(), '', ...s.right].filter(o => byOther.has(o));
      let prev = -Infinity;
      const gs = order.map(o => {
        const units = byOther.get(o).map(k => descUnit(k, depth + 1));
        const gw = units.reduce((t, k) => t + k.L + k.R, 0) + (units.length - 1) * GAP;
        const want = midOf(o) - gw / 2, left = Math.max(want, prev + GAP);
        prev = left + gw;
        return { units, gw, want, left };
      });
      // groups pushed apart drift right; spread the drift so the whole family stays centered under its couples
      const drift = gs.reduce((t, g) => t + g.left - g.want, 0) / gs.length;
      for (const g of gs) {
        let cur = g.left - drift;
        L = Math.max(L, -cur); R = Math.max(R, cur + g.gw);
        for (const k of g.units) { u.groups.push({ unit: k, dx: cur + k.L }); cur += k.L + k.R + GAP; }
      }
    } else if (kids.length) {
      const near = s.right[0] || s.left[0];
      u.bud = { key: 'down:' + id, label: kids.length === 1 ? '1 child' : kids.length + ' children', dx: near ? midOf(near) : 0 };
      L = Math.max(L, BUDW / 2 - u.bud.dx); R = Math.max(R, u.bud.dx + BUDW / 2);
    }
    u.L = L; u.R = R;
    return u;
  }
  function descPlace(u, x, g, block) {
    block.push({ id: u.id, x, y: genY(g), g, kind: 'person' });
    u.cards.forEach(c => block.push({ id: c.id, x: x + c.dx, y: genY(g), g, kind: 'person', partnerOf: u.id }));
    if (u.bud) block.push({ id: 'bud:' + u.bud.key, key: u.bud.key, x: x + u.bud.dx, y: genY(g - 1), g: g - 1, kind: 'bud', label: u.bud.label, anchor: u.id });
    u.groups.forEach(k => descPlace(k.unit, x + k.dx, g - 1, block));
  }
  const groups = new Map();
  childrenOf(F).forEach(c => { const other = parentsOf(c).find(pp => pp !== F) || ''; if (!groups.has(other)) groups.set(other, []); groups.get(other).push(c); });
  const orderedGroups = [...groups.entries()].sort((a, b) => (sideOf[a[0]] || 0) - (sideOf[b[0]] || 0));
  for (const [other, kids] of orderedGroups) {
    const mid = other && nodes.has(other) && sideOf[other] ? nodes.get(other).x / 2 : 0;
    const units = kids.map(k => descUnit(k, 1));
    const total = units.reduce((s, u) => s + u.L + u.R, 0) + (units.length - 1) * GAP;
    const block = [];
    let kx = mid - total / 2;
    units.forEach(u => { descPlace(u, kx + u.L, -1, block); kx += u.L + u.R + GAP; });
    placeBlock(block, (sideOf[other] || 1));
  }

""")

# ---- "Plus in-laws" (level 3): everyone connected. Starting from what's drawn, nearest first, each person brings in
# their missing parents (row above), partners and siblings (beside, away from the middle) and children (row below,
# under the couple). No slots, so it reads as a web; the card positions still never overlap.
engine = rep(engine, "  /* ---- edges ---- */\n  const placed = new Set(nodes.keys());",
  """  /* ---- plus in-laws: everyone connected ---- */
  if (STATE.level >= 3) {
    const queue = [...nodes.values()].filter(n => n.kind === 'person').sort((a, b) => Math.abs(a.g) - Math.abs(b.g) || Math.abs(a.x) - Math.abs(b.x));
    const fresh = ids => [...new Set(ids)].filter(x => !nodes.has(x) && G.people.has(x));
    const put = (list, dir) => { const blk = list.filter(b => !nodes.has(b.id)); if (!blk.length) return; placeBlock(blk, dir); blk.forEach(b => queue.push(nodes.get(b.id))); };
    for (let qi = 0; qi < queue.length && qi < 20000; qi++) {
      const n = queue[qi], dir = n.x < 0 ? -1 : 1;
      const pars = fresh(parentsOf(n.id));
      // A missing parent whose partner is already drawn goes beside that partner, so the couple stays together.
      const mate = parentsOf(n.id).find(pp => nodes.has(pp) && pars.some(f => partnersOf(pp).some(x => x.id === f)));
      if (mate) {
        const m = nodes.get(mate), md = m.x <= n.x ? 1 : -1;
        let px = m.x; put(pars.map(id => { px += md * (CW + CG); return { id, x: px, y: m.y, g: m.g, kind: 'person', partnerOf: mate }; }), md);
      } else if (pars.length) put(pars.map((id, i) => ({ id, x: n.x + (i - (pars.length - 1) / 2) * (CW + CG), y: genY(n.g + 1), g: n.g + 1, kind: 'person' })), dir);
      const pts = fresh(partnersOf(n.id).map(x => x.id));
      if (pts.length) { let px = n.x; put(pts.map(id => { px += dir * (CW + CG); return { id, x: px, y: genY(n.g), g: n.g, kind: 'person', partnerOf: n.id }; }), dir); }
      const sibsW = fresh(siblingsOf(n.id).map(x => x.id));
      if (sibsW.length) { let sx = n.x; put(sibsW.map(id => { sx += dir * (CW + GAP); return { id, x: sx, y: genY(n.g), g: n.g, kind: 'person' }; }), dir); }
      const kids = fresh(childrenOf(n.id));
      if (kids.length) {
        const byOther = new Map();
        kids.forEach(k => { const o = parentsOf(k).find(pp => pp !== n.id && nodes.has(pp) && nodes.get(pp).g === n.g) || ''; if (!byOther.has(o)) byOther.set(o, []); byOther.get(o).push(k); });
        for (const [o, ks] of byOther) {
          const mid = o ? (n.x + nodes.get(o).x) / 2 : n.x;
          let kx = mid - (ks.length * CW + (ks.length - 1) * GAP) / 2;
          put(ks.map(id => { const b = { id, x: kx + CW / 2, y: genY(n.g - 1), g: n.g - 1, kind: 'person' }; kx += CW + GAP; return b; }), dir);
        }
      }
    }
  }

  /* ---- edges ---- */
  const placed = new Set(nodes.keys());""")

# ---- "+N" on any card whose close family isn't on screen and isn't behind a bud. Tap it to center there. ----
# Centering on anyone always draws their parents, partners, children and siblings, so this reaches everyone,
# including family shapes the layout has no special place for.
engine = rep(engine, "  // which opened groups hang from which card, so each can be folded again",
  """  // close family that no bud on this screen would reveal: shown as "+N", tap to center there.
  // "Reveal" is everyone drawn with every bud open (one extra layout pass, about a millisecond).
  let reveal = placed;
  if (STATE.level < 1) { STATE.level = 1; try { reveal = new Set(layout().nodes.keys()); } finally { STATE.level = 0; } }
  for (const n of nodes.values()) {
    if (n.kind !== 'person' || n.id === F || P(n.id).placeholder) continue;
    const fam = [...parentsOf(n.id), ...childrenOf(n.id), ...partnersOf(n.id).map(x => x.id), ...siblingsOf(n.id).map(x => x.id)];
    const hidden = new Set(fam.filter(x => !reveal.has(x) && !P(x).placeholder));
    if (hidden.size) n.more = hidden.size;
  }
  // which opened groups hang from which card, so each can be folded again""")
engine = rep(engine, "    rec.el.querySelectorAll('.fold').forEach(f => f.remove());",
  """    rec.el.querySelectorAll('.fold, .more').forEach(f => f.remove());
    if (n.more) {
      const m = document.createElement('button');
      m.className = 'more';
      m.style.top = ((n.id === STATE.focus ? FH : CH) / 2 - 12) + 'px';
      m.style.left = ((n.id === STATE.focus ? FW : CW) / 2 - 30) + 'px';
      m.textContent = '+' + n.more;
      const who = P(n.id).first || 'them';
      m.title = `${n.more} more ${n.more === 1 ? 'relative' : 'relatives'}. Tap to center on ${who}.`;
      m.setAttribute('aria-label', m.title);
      m.addEventListener('click', e => { e.stopPropagation(); closePanel(); STATE.focus = n.id; render(); });
      rec.el.appendChild(m);
    }""")
keyjs = rep(keyjs, "'A folded branch', 'More relatives live here. Tap the bud to open it; tap the small minus on the card to fold it again.')}",
  "'A folded branch', 'More relatives live here. Tap the bud to open it; tap the small minus on the card to fold it again.')}\n      ${row(`<svg viewBox=\"0 0 92 34\" aria-hidden=\"true\"><rect x=\"8\" y=\"4\" width=\"70\" height=\"26\" rx=\"6\" fill=\"#FFFDF9\" stroke=\"#1D2B24\" stroke-opacity=\".12\"/><rect x=\"58\" y=\"20\" width=\"28\" height=\"14\" rx=\"7\" fill=\"#1D2B24\"/><text x=\"72\" y=\"30.5\" text-anchor=\"middle\" font-size=\"9\" font-family=\"Jost, sans-serif\" font-weight=\"600\" fill=\"#FFFDF9\">+3</text></svg>`, 'More family off the tree', 'This person has relatives who aren\\'t on screen from here. Tap the number to center the tree on them.')}")
# An opened aunt or uncle brings their partners into the ancestors' row, one on each side of them, so no sibling
# lands between a couple (Christopher sat between Barbara and Tom with every branch open).
engine = rep(engine, "  function pedExtents(id, depth, side) {",
  """  function withPartners(s, side) {
    if (!isOpen('fam:' + s)) return [{ id: s }];
    const sd = splitSides(s, partnersOf(s).filter(pt => !lineSet.has(pt.id)));
    const inner = side === 'left' ? sd.right : sd.left, outer = side === 'left' ? sd.left : sd.right;
    return [...[...inner].reverse().map(pt => ({ id: pt, partnerOf: s, inner: true })), { id: s, coupleGap: inner.length > 0 }, ...outer.map(pt => ({ id: pt, partnerOf: s }))];
  }
  function pedExtents(id, depth, side) {""")
engine = rep(engine, "sibExtras.push(...sibs.map(s => ({ id: s })))", "sibExtras.push(...sibs.flatMap(s => withPartners(s, side)))")
engine = rep(engine, "const extraW = t.extras.reduce((s, e) => s + (e.bud ? BUDW : CW) + GAP, 0);",
  "const extraW = t.extras.reduce((s, e) => s + (e.bud ? BUDW : CW) + GAP + ((e.partnerOf && !e.inner) || e.coupleGap ? CG - GAP : 0), 0);")
engine = rep(engine, "      if (e.partnerOf) off += CG - GAP;", "      if ((e.partnerOf && !e.inner) || e.coupleGap) off += CG - GAP;")
# Nothing may land between an ancestor couple: the pedigree spreads them apart to fit their own parents, and that gap
# used to catch cousins, so the couple read as split.
engine = rep(engine, "    if (t.parents.length === 2) { pedPlace(t.parents[0], x - t.da, g + 1); pedPlace(t.parents[1], x + t.db, g + 1); }",
  "    if (t.parents.length === 2) { occupy(g + 1, x - t.da, x + t.db); pedPlace(t.parents[0], x - t.da, g + 1); pedPlace(t.parents[1], x + t.db, g + 1); }")
# A former partner (together once, never married) doesn't make their children stepchildren, or them a step-parent
# (2026-11-22: Sharon, Kayla's daughter with Caesar, read as Jonny's stepchild).
engine = rep(engine, "  if (path === 'UP') return w('Stepfather', 'Stepmother', 'Step-parent');\n",
  "  const ptSub = (x, y) => (partnersOf(x).find(z => z.id === y) || {}).sub;\n  if (path === 'UP' && ptSub(chain[0], id) !== 'former') return w('Stepfather', 'Stepmother', 'Step-parent');\n")
engine = rep(engine, "  if (path === 'UPD' && !siblingsOf(v).some(x => x.id === id))", "  if (path === 'UPD' && ptSub(chain[0], chain[1]) !== 'former' && !siblingsOf(v).some(x => x.id === id))")
engine = rep(engine, "  if (path === 'PD') return w('Stepson', 'Stepdaughter', 'Stepchild');", "  if (path === 'PD' && ptSub(v, chain[0]) !== 'former') return w('Stepson', 'Stepdaughter', 'Stepchild');")
ui = open('build/app-ui.js').read()
assert "STATE.all" not in ui
ui = ui.replace("changes = Object.keys(now).filter(k => now[k] !== was[k] && !(k === 'living' && now[k] === 'unknown' && was[k] !== 'unknown' && false))", "changes = Object.keys(now).filter(k => now[k] !== was[k])")
app = open('build/app-data.js').read() + '\n' + open('build/app-info.js').read() + '\n' + engine + '\n' + ui + '\n' + open('build/app-levels.js').read() + '\n' + keyjs + '\n\n' + open('build/app-wheel.js').read() + '\n' + open('build/app-related.js').read() + '\n' + open('build/app-boot.js').read()
assert 'STATE.all' not in app, 'STATE.all left over: ' + app[app.index('STATE.all') - 200:app.index('STATE.all') + 50]
# Busy = a form or card is open: the freshness check waits rather than reload under someone's typing.
app += "\nwindow.ROOTS_BUSY = () => panel.classList.contains('on') || !!formDirty || saving;\n"

# ---------------- versions: one id for this build, stamped everywhere ----------------
import hashlib
fresh = open('build/fresh.js').read()
admin_js = open('assets/admin.js').read()
admin_js = re.sub(r"\n/\* ---- Stay current\..*\Z", "", admin_js, flags=re.S).rstrip() + "\n"
# The approvals page shares the tree page's info buttons (merge and undo explain themselves); appended each build.
admin_js = re.sub(r"\n/\* =+\n \* Info buttons \(2026-11-22\).*\Z", "", admin_js, flags=re.S).rstrip() + "\n"
admin_js += "\n" + open('build/app-info.js').read()
hx = hashlib.sha256()
for part in (app, style, open('index.html').read(), re.sub(r'\?v=\w+', '', open('admin.html').read()), admin_js, open('assets/admin.css').read(), open('config.js').read(), fresh):
    hx.update(part.encode())
BUILD = hx.hexdigest()[:10]
app += '\n' + fresh.replace('__BUILD__', BUILD)
open('assets/app.js', 'w').write(app)
open('assets/admin.js', 'w').write(admin_js + '\n' + fresh.replace('__BUILD__', BUILD))
open('version.json', 'w').write('{"v": "%s", "version": "%s"}\n' % (BUILD, VERSION))
# Asset links carry the build id, so a refreshed page can't pair new HTML with old script.
stamp = lambda html: re.sub(r'(href|src)="((?:assets/(?:app|admin)\.(?:css|js))|config\.js)(?:\?v=\w+)?"', lambda m: '%s="%s?v=%s"' % (m.group(1), m.group(2), BUILD), html)
for page in ('index.html', 'admin.html'):
    html = open(page).read()          # read before opening for write, which empties the file
    open(page, 'w').write(stamp(html))
print(len(app), 'bytes of JS;', app.count('\n'), 'lines; build', BUILD)
