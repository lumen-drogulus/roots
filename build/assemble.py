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
ui = open('build/app-ui.js').read()
ui = ui.replace("changes = Object.keys(now).filter(k => now[k] !== was[k] && !(k === 'living' && now[k] === 'unknown' && was[k] !== 'unknown' && false))", "changes = Object.keys(now).filter(k => now[k] !== was[k])")
app = open('build/app-data.js').read() + '\n' + engine + '\n' + ui + '\n' + keyjs + '\n\n' + open('build/app-boot.js').read()
open('assets/app.js', 'w').write(app)
print(len(app), 'bytes of JS;', app.count('\n'), 'lines')
