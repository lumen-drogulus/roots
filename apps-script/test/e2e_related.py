"""How are we related? and the Gender dropdown (2026-11-22). Fresh server.js on 8787 plus the site on 8000.
Run: python3 apps-script/test/e2e_related.py
A made-up family: grandparents Gran (female) and Grandpa (male), their daughters Mom (no gender yet) and Aunt
(female), Me (Mom's child) and Cousin (Aunt's child); Me's former partner Ex, their child Kid, Ex's later child Half
with Other; Kid married Spouse, whose parent is InLaw. Checks the words and diagrams for blood, a blood bridge, one
marriage, a chain of steps, comparing two people, showing the path on the tree, and that choosing a gender on the
form is saved and turns "parent" into "mother"."""
import asyncio, json, urllib.request, sys
fails = []
def check(n, ok, info=''):
    print(('  ok  ' if ok else '  FAIL ') + n + ('' if ok else '  ' + str(info)))
    if not ok: fails.append(n)
from playwright.async_api import async_playwright
API = 'http://localhost:8787'; SITE = 'http://127.0.0.1:8000'
def post(b):
    r = urllib.request.Request(API, data=json.dumps(b).encode(), headers={'Content-Type': 'text/plain'}); return json.loads(urllib.request.urlopen(r).read())
def rows(t):
    d = json.loads(urllib.request.urlopen(API + '/__sheet').read())[t]; return [dict(zip(d[0], r)) for r in d[1:]]
key = urllib.request.urlopen(API + '/__key').read().decode()
P = lambda ref, first, living='living', sex='': {'kind': 'person', 'ref': 'new:' + ref, 'data': {'first_name': first, 'birth_surname': 'Test', 'living': living, 'sex': sex}}
PC = lambda a, b: {'kind': 'relationship', 'type': 'parent_child', 'a': 'new:' + a, 'b': 'new:' + b}
PT = lambda a, b, s: {'kind': 'relationship', 'type': 'partner', 'a': 'new:' + a, 'b': 'new:' + b, 'subtype': s}
o = post({'action': 'submit', 'token': 'ownertokenownertokenowner', 'key': key, 'items': [
  P('gran', 'Gran', 'deceased', 'female'), P('gpa', 'Grandpa', 'deceased', 'male'), PT('gran', 'gpa', 'married'),
  P('mom', 'Mom', 'deceased'), PC('gran', 'mom'), PC('gpa', 'mom'),
  P('aunt', 'Aunt', 'deceased', 'female'), PC('gran', 'aunt'), PC('gpa', 'aunt'),
  P('me', 'Me'), PC('mom', 'me'), P('cous', 'Cousin'), PC('aunt', 'cous'),
  P('ex', 'Ex'), PT('me', 'ex', 'former'), P('kid', 'Kid'), PC('me', 'kid'), PC('ex', 'kid'),
  P('oth', 'Other'), PT('ex', 'oth', 'partner'), P('half', 'Half'), PC('ex', 'half'), PC('oth', 'half'),
  P('sp', 'Spouse'), PT('kid', 'sp', 'married'), P('inl', 'InLaw'), PC('inl', 'sp')]})
ID = {k[4:]: v for k, v in o['ids'].items()}

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await br.new_context(viewport={'width': 390, 'height': 844})
        await ctx.add_init_script(f"localStorage.setItem('roots_admin_key', {json.dumps(key)}); localStorage.setItem('roots_intro_seen', '1');")
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'{SITE}/index.html?nointro&api={API}'); await pg.wait_for_timeout(2500)
        await pg.evaluate(f"STATE.viewer = {json.dumps(ID['me'])}")
        rel = lambda b, a=None: pg.evaluate(f"(() => {{ const r = findRelation({json.dumps(a or ID['me'])}, {json.dumps(ID[b])}); const w = relationWords(r); return [r.kind, w.head, w.body]; }})()")

        k, h, b = await rel('cous'); check('first cousin', k == 'blood' and h == 'Cousin Test is your first cousin.', h)
        check('cousin explanation names the shared grandparents', 'share grandparents' in b and 'Gran' in b and 'Grandpa' in b, b)
        k, h, b = await rel('gran'); check('gender word for a grandparent who has died', h.endswith('your grandmother.'), h)
        k, h, b = await rel('aunt'); check('aunt', h.endswith('your aunt.'), h)
        k, h, b = await rel('mom'); check('no gender yet: parent', h.endswith('your parent.'), h)
        k, h, b = await rel('half'); check('through a blood relative', k == 'bridge' and h == "Half Test is your child Kid's half-sibling.", h)
        k, h, b = await rel('ex'); check('own former partner', k == 'marriage' and h == 'Ex Test is your former partner.', h)
        k, h, b = await rel('sp'); check("child's spouse", k == 'marriage' and h == "Spouse Test is your child Kid's spouse.", h)
        k, h, b = await rel('inl'); check('chain of steps', k == 'chain' and h == 'InLaw Test is family by marriage.', h)
        steps = await pg.evaluate(f"stepsOf(findRelation({json.dumps(ID['me'])}, {json.dumps(ID['inl'])})).map(s => stepSentence(s, {json.dumps(ID['me'])}))")
        check('chain steps read in order', steps == ['Your child is Kid Test.', 'Kid is married to Spouse Test.', "Spouse's parent is InLaw Test."], steps)
        k, h, b = await rel('cous', ID['half']); check('between two other people', k == 'bridge' and h == "Cousin Test is Half's half-sibling Kid's first cousin once removed.", h)
        lab = await pg.evaluate(f"relation({json.dumps(ID['half'])})")
        check("a former partner's child is not a stepchild", lab not in ('Stepchild', 'Stepson', 'Stepdaughter'), lab)

        # The card button, the path panel and its diagram
        await pg.evaluate(f"openPerson({json.dumps(ID['cous'])})"); await pg.wait_for_timeout(300)
        sub = await pg.inner_text('#pRelated')
        check('card button previews the word', 'First cousin' in sub, sub)
        await pg.click('#pRelated'); await pg.wait_for_timeout(300)
        check('path headline', 'your first cousin' in await pg.inner_text('.related .rh'))
        cards = await pg.eval_on_selector_all('.rdiag .rcard', 'els => els.map(e => e.dataset.goto)')
        check('V diagram: both people, both parents, both grandparents', set(cards) == {ID[x] for x in ('me', 'cous', 'mom', 'aunt', 'gran', 'gpa')}, cards)
        box = await pg.evaluate("(() => { const d = document.querySelector('.rdiag').getBoundingClientRect(), p = document.querySelector('.panel .body').getBoundingClientRect(); return [d.left >= p.left - 1, d.right <= p.right + 1]; })()")
        check('diagram fits the phone panel', all(box), box)
        await pg.click(f'.rdiag .rcard[data-goto="{ID["aunt"]}"]'); await pg.wait_for_timeout(300)
        check('a card in the diagram opens that person', 'Aunt' in await pg.inner_text('.panel h2'))
        # Show it on the tree
        await pg.evaluate(f"openPerson({json.dumps(ID['cous'])})"); await pg.wait_for_timeout(200)
        await pg.click('#pRelated'); await pg.wait_for_timeout(200); await pg.click('#rShow'); await pg.wait_for_timeout(1200)
        on = await pg.eval_on_selector_all('.node.onpath', 'e => e.length'); off = await pg.eval_on_selector_all('.node.offpath', 'e => e.length')
        check('path marked on the tree, others faded', on >= 6 and off >= 1, (on, off))
        await pg.mouse.click(30, 700); await pg.wait_for_timeout(300)
        check('a tap on the tree clears it', await pg.eval_on_selector_all('.node.onpath', 'e => e.length') == 0 and not await pg.evaluate("document.body.classList.contains('pathmode')"))
        # Compare any two
        await pg.evaluate(f"openPerson({json.dumps(ID['half'])})"); await pg.wait_for_timeout(200)
        await pg.click('#pRelated'); await pg.wait_for_timeout(200); await pg.click('#rCompare'); await pg.wait_for_timeout(200)
        await pg.click('[data-slot="a"]'); await pg.wait_for_timeout(200); await pg.fill('#qName', 'Spouse'); await pg.wait_for_timeout(200)
        await pg.click(f'#qList button[data-id="{ID["sp"]}"]'); await pg.wait_for_timeout(200)
        await pg.click('#rGo'); await pg.wait_for_timeout(300)
        h = await pg.inner_text('.related .rh')
        check('compare two other people', 'Half Test' in h and 'Spouse' in h, h)
        await pg.evaluate("closePanel()")

        # Gender on the form: owner edits Mom to Female, then the words change
        await pg.evaluate(f"openEdit({json.dumps(ID['mom'])})"); await pg.wait_for_timeout(300)
        check('Gender dropdown on Edit', await pg.locator('#fSex').count() == 1)
        await pg.select_option('#fSex', 'female'); await pg.click('#pSave'); await pg.wait_for_timeout(1500)
        await pg.evaluate("hidePage('thanks'); closePanel(); reload()"); await pg.wait_for_timeout(1500)
        await pg.evaluate(f"STATE.viewer = {json.dumps(ID['me'])}")
        check('saved to the Sheet', any(r['id'] == ID['mom'] and r['sex'] == 'female' for r in rows('People')))
        k, h, b = await rel('mom'); check('parent becomes mother', h.endswith('your mother.'), h)
        k, h, b = await rel('cous'); check('explanation says your mother', 'Your mother Mom' in b, b)
        # Gender on the Add form
        await pg.evaluate(f"openAdd({json.dumps(ID['me'])}, {{ rel: 'child' }})"); await pg.wait_for_timeout(300)
        await pg.fill('#fFirst', 'Newkid'); await pg.select_option('#fSex', 'male')
        await pg.click('#pSave'); await pg.wait_for_timeout(1800)
        check('Gender saved on a new person', any(r['first_name'] == 'Newkid' and r['sex'] == 'male' for r in rows('People')))
        check('no page errors', not errs, errs)
        await br.close()
asyncio.run(main())
print('FAILED: ' + ', '.join(fails) if fails else 'clean')
sys.exit(1 if fails else 0)
