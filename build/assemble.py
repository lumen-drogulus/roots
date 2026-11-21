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
  "      half: gp.length === 1 && parentsOf(n.id).length === 2 && parentsOf(n.id).every(x => !pcKind(x, n.id)) }));")
engine = rep(engine, "    r.dash = e.pending || P(e.child).placeholder || e.parents.some(x => P(x).placeholder) ? '0.02 0.03' : null;",
  "    const nonBirth = e.parents.every(x => pcKind(x, e.child));\n    if (nonBirth) el.style.strokeWidth = Math.max(1.1, (3.4 - gen * 0.55) * 0.6);\n    r.dash = e.pending || P(e.child).placeholder || e.parents.some(x => P(x).placeholder) ? '0.02 0.03' : nonBirth ? '0.07 0.045' : null;")
keyjs = rep(keyjs, "      ${row(keyLine('M46 31 C46 18 46 16 46 3', { dash: '2 4' }),",
  "      ${row(keyLine('M46 31 C46 18 46 16 46 3', { dash: '7 4', w: 1.6 }), 'Step, adoptive or foster parent', 'A thinner dashed line. With a birth parent beside them, they share the birth line; the card says Stepmother, Stepchild and so on.')}\n      ${row(keyLine('M46 31 C46 18 46 16 46 3', { dash: '2 4' }),")
# Cards: the name people use. Goes-by in quotes, else a middle initial, so two relatives with the same name differ.
engine = rep(engine, "function displayName(p) {",
  "function cardName(p) {\n  if (p.placeholder) return 'Unknown';\n  const nick = (p.nicknames || '').split(',')[0].trim();\n  const mid = nick && !sameNameE(nick, p.first) ? `\"${nick}\"` : p.middle ? p.middle.trim()[0] + '.' : '';\n  return [p.first, mid, p.last].filter(Boolean).join(' ');\n}\nconst sameNameE = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();\nfunction displayName(p) {")
engine = rep(engine, "<span class=\"nm\">${p.placeholder ? 'Unknown' : esc(displayName(p))}</span>", "<span class=\"nm\">${esc(cardName(p))}</span>")
ui = open('build/app-ui.js').read()
ui = ui.replace("changes = Object.keys(now).filter(k => now[k] !== was[k] && !(k === 'living' && now[k] === 'unknown' && was[k] !== 'unknown' && false))", "changes = Object.keys(now).filter(k => now[k] !== was[k])")
app = open('build/app-data.js').read() + '\n' + engine + '\n' + ui + '\n' + keyjs + '\n\n' + open('build/app-boot.js').read()
open('assets/app.js', 'w').write(app)
print(len(app), 'bytes of JS;', app.count('\n'), 'lines')
