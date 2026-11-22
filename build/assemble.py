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

<div class="scrim" id="scrim"></div>''')
head = open('build/head.html').read()
open('index.html', 'w').write(head + '<body>' + body + '<script src="config.js"></script>\n<script src="assets/app.js"></script>\n</body>\n</html>\n')

# ---------------- JS ----------------
engine = between(script, "/* =====================================================================\n * Graph", "/* =====================================================================\n * Pop-out person panel")
keyjs = between(script, "/* ---- key: every symbol", "$('#btnKey').onclick = openKey;", inclusive_b=True)
engine = rep(engine, "  data.rels.forEach(([t, a, b, sub, pend]) => {", "  data.rels.forEach(([t, a, b, sub, pend]) => {\n    if (!g.people.has(a) || !g.people.has(b)) return;")
engine = rep(engine, "const isLiving = p => !!p.living || (!p.died && !p.placeholder && !(p.born && +String(p.born).replace(/\\D/g, '') < new Date().getFullYear() - 110));",
             "const isLiving = p => !p.placeholder && !!p.living;")
engine = rep(engine, "const STATE = { viewer: SAMPLE.viewer, focus: SAMPLE.viewer, open: new Set(), all: false, rootsBelow: true, selected: null };",
             "const STATE = { viewer: null, owner: null, focus: null, open: new Set(), all: false, rootsBelow: true, selected: null };")
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
# Full siblings stay on the left. Right-side half-siblings go past any current partners.
engine = rep(engine, between(engine, "  /* ---- siblings of the centered person (left), with their families folded ---- */", "  /* ---- step-siblings"),
  """  /* ---- siblings of the centered person, with their families folded: full on the left, half on their shared parent's side ---- */
  const sibs = siblingsOf(F).filter(s => !nodes.has(s.id));
  sibs.sort((a, b) => a.half - b.half);
  const myPars = parentsOf(F);
  const sibSide = s => {
    if (!s.half) return -1;
    const shared = parentsOf(s.id).filter(x => myPars.includes(x) && nodes.has(x));
    return shared.length === 1 && nodes.get(shared[0]).x > 0 ? 1 : -1;
  };
  for (const s of sibs) {
    const dir = sibSide(s), cx = (dir < 0 ? lx : rx) + dir * CW / 2;
    const block = [{ id: s.id, x: cx, y: 0, g: 0, kind: 'person', sibling: true, half: s.half }];
    const fam = partnersOf(s.id).length + childrenOf(s.id).length;
    if (fam) {
      if (isOpen('fam:' + s.id)) {
        let ox = cx;
        partnersOf(s.id).forEach(pt => { ox += dir * (CW + CG); block.push({ id: pt.id, x: ox, y: 0, g: 0, kind: 'person', partnerOf: s.id }); });
        const mid = partnersOf(s.id).length ? cx + dir * (CW + CG) / 2 : cx;
        const ks = childrenOf(s.id);
        let kx = mid - (ks.length * CW + (ks.length - 1) * GAP) / 2;
        ks.forEach(k => { block.push({ id: k, x: kx + CW / 2, y: genY(-1), g: -1, kind: 'person' }); kx += CW + GAP; });
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
    // Partners first, beside the aunt or uncle; then the cousins under the couple, each block clearing what's already there.
    let ox = n.x, mid = n.x;
    pts.forEach((pt, i) => { ox += dir * (CW + CG); const b = [{ id: pt, x: ox, y: n.y, g: n.g, kind: 'person', partnerOf: s }]; placeBlock(b, dir); ox = b[0].x; if (!i) mid = (n.x + ox) / 2; });
    let kx = mid - (ks.length * CW + (ks.length - 1) * GAP) / 2;
    if (ks.length) placeBlock(ks.map(k => { const c = { id: k, x: kx + CW / 2, y: genY(n.g - 1), g: n.g - 1, kind: 'person' }; kx += CW + GAP; return c; }), dir);
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
ui = open('build/app-ui.js').read()
ui = ui.replace("changes = Object.keys(now).filter(k => now[k] !== was[k] && !(k === 'living' && now[k] === 'unknown' && was[k] !== 'unknown' && false))", "changes = Object.keys(now).filter(k => now[k] !== was[k])")
app = open('build/app-data.js').read() + '\n' + engine + '\n' + ui + '\n' + keyjs + '\n\n' + open('build/app-boot.js').read()
open('assets/app.js', 'w').write(app)
print(len(app), 'bytes of JS;', app.count('\n'), 'lines')
