/* =====================================================================
 * Intro (first visit), Guide, "Why I built this"
 * ===================================================================== */
const INTRO = [
  () => `
    <svg viewBox="4 8 216 112" style="width:180px;height:auto" aria-hidden="true">${document.querySelector('.topbar .logo').innerHTML}</svg>
    <h1>Welcome to our family tree.</h1>
    <div class="why">
      <p>When I was a kid, our family got together all the time. Card games at someone's house. Big reunions at the park. Christmas parties where one of us played Santa.</p>
      <p>Over the years, the patriarchs and matriarchs who held us together passed on, and many of us lost touch.</p>
      <p>Now I have a family of my own, an adult son and a daughter-in-law, and I want to bring back the family spirit I grew up with. This tree is where I'm starting: a detailed picture of who we are and how we're all connected.</p>
      <p>It only grows if you help. Add the relatives you know, especially the ones we've lost, then send the link to every relative you can. Together we can build something beautiful.</p>
      <p>Questions? Email me at <a href="mailto:jonathonpr@gmail.com">jonathonpr@gmail.com</a>.</p>
      <p>Thank you for helping this tree grow. I hope it brings us back around the same table.</p>
    </div>
    <p class="sig">Jonny Ruzicka</p>`,
  () => `
    <h1>How it works</h1>
    <ul class="howto">
      <li><span class="ic">${ICON.bud.replace('currentColor', '#A9822F')}</span><div><b>Tap anyone to see their story.</b><span>Names, dates and memories for those who've passed. Living relatives show by name only.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><div><b>Add who you know.</b><span>Tap <b>Add someone</b> at the bottom of the screen, or tap a person and choose <b>Add a relative</b>. Especially the relatives we've lost. A first name is enough. ${OWNER_NAME} confirms each addition.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M12 20V10"/><path d="M12 14c-3 0-5-2-6-5"/><path d="M12 12c3 0 5-2 6-5"/></svg></span><div><b>Some branches are folded into gold buds.</b><span>Tap a bud to open it, or tap <b>Show</b> at the top to open more at once. A small +3 on a card means more family there: tap it to center the tree on them.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h3M4 12h3M4 17h3"/><path d="M10 7h10M10 12h10M10 17h10"/></svg></span><div><b>Not sure what a line means?</b><span>Tap <b>Key</b> at the top for every symbol and line type. Pinch or use + and − at the bottom right to make the tree bigger.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-3-7-7-1z"/></svg></span><div><b>Send it on.</b><span>Tap <b>Send</b> at the top. Every relative who adds a branch fills in a gap nobody else could.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.6v.4"/><circle cx="12" cy="17" r=".6" fill="#1D2B24"/></svg></span><div><b>Stuck?</b><span>Tap <b>Help</b> at the top to see this again, or email ${OWNER_NAME} at <a href="mailto:jonathonpr@gmail.com">jonathonpr@gmail.com</a>.</span></div></li>
    </ul>`,
  () => `
    <h1>Which one is you?</h1>
    <p>Find yourself so the tree knows where you fit and opens on you.</p>
    <ol class="isteps"><li><b>Type your name</b> in the box. First or last name is enough.</li><li><b>Tap your name</b> in the list that appears.</li></ol>
    <div class="field"><label for="iName">Your name</label><input id="iName" placeholder="Start typing your name" autocomplete="off" autocapitalize="words"></div>
    <div class="pick" id="iList"></div>
    <div class="iadd"><span>Not in the list?</span><button class="primary" id="iAdd" type="button">Add myself</button></div>
    <p class="hint warn" id="iGate" hidden></p>`
];
let introSteps = [0, 1, 2], introStep = 0;
function renderIntro() {
  const step = introSteps[introStep], last = introStep === introSteps.length - 1;
  $('#introInner').innerHTML = INTRO[step]() + `
    <div class="actions">
      ${introStep > 0 ? '<button class="iconbtn" id="iBack">Back</button>' : ''}
      <button class="${last && step === 2 ? 'iconbtn' : 'primary'}" id="iNext">${last ? (step === 2 ? 'Skip for now' : 'Start exploring') : step === 0 ? 'Show me how it works' : 'Next'}</button>
      <span style="flex:1"></span><div class="dots">${introSteps.map((_, i) => `<i class="${i === introStep ? 'on' : ''}"></i>`).join('')}</div>
    </div>`;
  $('#intro').scrollTop = 0;
  if (introStep > 0) $('#iBack').onclick = () => { introStep--; renderIntro(); };
  $('#iNext').onclick = () => { if (last) finishIntro(); else { introStep++; renderIntro(); } };
  if (step === 2) {
    // "Which one is you?" (2026-11-22, Jonny): type, then tap yourself. Adding yourself is a button, not a list row,
    // and it makes you search first: nothing typed asks you to type; matches showing asks "is one of these you?" once.
    let hits = [], confirmNew = false;
    const gate = msg => { $('#iGate').textContent = msg; $('#iGate').hidden = !msg; };
    const list = () => {
      const q = $('#iName').value.toLowerCase().trim();
      confirmNew = false; $('#iAdd').textContent = 'Add myself'; gate('');
      hits = q ? [...G.people.values()].filter(p => !p.placeholder && isLiving(p) && nameMatches(p, q)).slice(0, 6) : [];
      $('#iList').innerHTML = !q ? '<p class="hint">Names show up here as you type.</p>'
        : hits.length ? hits.map(p => `<button data-id="${p.id}">${listName(p)}<small>That's me</small></button>`).join('')
        : '<p class="hint">No one by that name yet. Try your last name or a nickname.</p>';
      document.querySelectorAll('#iList button').forEach(b => b.onclick = () => {
        finishIntro(true);
        claimMe(b.dataset.id).then(() => { STATE.focus = STATE.viewer; render(); });
      });
    };
    $('#iAdd').onclick = () => {
      const typed = $('#iName').value.trim();
      if (typed.length < 2) { gate("Type your name above first, so you don't end up in the tree twice."); $('#iName').focus(); return; }
      if (hits.length && !confirmNew) {
        confirmNew = true; $('#iAdd').textContent = 'None of these. Add myself';
        gate('Is one of these you? Tap your name to pick it. If none of them are you, tap the button again.');
        return;
      }
      finishIntro(true);
      addMeFlow(typed);
    };
    $('#iName').oninput = list; list();
  }
}
function openIntro(step = 0) {
  introSteps = G.people.size && !STATE.viewer ? [0, 1, 2] : [0, 1];
  introStep = Math.min(step, introSteps.length - 1); renderIntro(); showPage('intro'); updateMeBar();
}
function finishIntro(quiet) {
  hidePage('intro');
  store.set('roots_intro_seen', '1');
  if (!quiet && G.people.size) { clearTree(); setTimeout(() => render({ camera: 'instant' }), 250); }
  if (!G.people.size) showEmpty();
  updateMeBar();
}
/* Not on the tree yet (2026-11-22): the intro offers "Which one is you?" once. A relative who skipped it, or started
   adding themselves and never finished saving, gets this standing offer until the device has a saved person.
   "Not now" hides it until the next visit. Never in owner mode. */
var meBarOff = false;
/* Phones show a short word under each top-bar icon (2026-11-22): the Guide told people to tap Key and Show, and phones
   hid those words. */
[['btnViewTree', 'Tree'], ['btnViewWheel', 'Wheel'], ['btnSearch', 'Find'], ['btnAll', 'Show'], ['btnKey', 'Key'], ['btnHelp', 'Help'], ['btnSend', 'Send']]
  .forEach(([id, t]) => { const b = $('#' + id); if (b) b.insertAdjacentHTML('beforeend', `<span class="plbl" aria-hidden="true">${t}</span>`); });
/* Add someone (2026-11-22): adding was only reachable by tapping a card first, which the Guide never said. */
document.body.insertAdjacentHTML('beforeend', `<button class="primary addfab" id="btnAddSomeone" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add someone</button>`);
$('#btnAddSomeone').onclick = () => pickPerson('Who are you adding them to?', "Find someone already on the tree they're related to. Next you'll say how, and type their name.", id => openAdd(id));
document.body.insertAdjacentHTML('beforeend', `<div class="banner waiting" id="waitBar" hidden>You're saved. ${OWNER_NAME} will connect you to the family when he confirms it.</div>`);
function updateMeBar() {
  $('#btnAddSomeone').hidden = !G.people.size || !$('#paused').hidden;
  // Added themselves with "Something else" or "I don't see anyone I know": no links yet, so say why they stand alone.
  const v = STATE.viewer && G.people.has(STATE.viewer) ? STATE.viewer : null;
  $('#waitBar').hidden = !v || !!ADMIN_KEY || parentsOf(v).length + childrenOf(v).length + partnersOf(v).length > 0;
  $('#meBar').hidden = meBarOff || !!ADMIN_KEY || !!STATE.viewer || !G.people.size || QS.has('nointro')
    || !$('#paused').hidden || store.get('roots_intro_seen') !== '1' || $('#intro').classList.contains('on');
}
$('#meYes').onclick = () => { $('#meBar').hidden = true; openIntro(2); };
$('#meNo').onclick = () => { meBarOff = true; updateMeBar(); };
// typed: the name searched on "Which one is you?", carried into the form so they don't type it twice.
function addMeFlow(typed = '') {
  const w = typed.trim().split(/\s+/).filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1));
  // A full name fills first and last. One word goes to Last name when it's a family name already in the tree
  // ("Isaacs"), otherwise to First name (2026-11-22: "Linda" was typed twice and then asked for again).
  const lasts = new Set([...G.people.values()].flatMap(p => [p.last, p.birthSurname, ...(p.married || [])]).filter(Boolean).map(x => x.toLowerCase()));
  const fields = w.length > 1 ? { first: w[0], last: w[w.length - 1], living: 'living' }
    : w.length === 1 ? (lasts.has(w[0].toLowerCase()) ? { last: w[0], living: 'living' } : { first: w[0], living: 'living' }) : null;
  const go = (id, extra = {}) => openAdd(id, { self: true, rel: 'child', ...(fields ? { fields } : {}), ...extra });
  if (!G.people.size) { go(null); return; }
  // Option A (Jonny, 2026-11-22): a cousin or in-law with no parent, sibling, partner or child here can still pick
  // anyone, or nobody, and say how they're related. Jonny places them when he approves.
  pickPerson("Who's a close relative of yours here?",
    "Pick the closest one you can find. A parent, brother or sister, partner or child is best, but anyone you're related to works.",
    id => go(id), undefined,
    { label: "I don't see anyone I know", onClick: () => go(null, { loose: true }) });
}
$('#btnHelp').onclick = () => openIntro(1);
$('#btnWhy').onclick = () => openIntro(0);

/* =====================================================================
 * Loading, empty tree, refresh
 * ===================================================================== */
function clearTree() { for (const r of live.values()) r.el.remove(); live.clear(); for (const r of liveEdges.values()) { r.el.remove(); } liveEdges.clear(); }
function showEmpty() {
  const el = $('#empty');
  el.hidden = false;
  el.innerHTML = ADMIN_KEY
    ? `<h2>The tree is ready to plant.</h2><p>Start with yourself. Then add your parents, partner and children, and the tree grows from there.</p><button class="primary" id="eStart">Add yourself</button>`
    : `<h2>The tree hasn't been planted yet.</h2><p>${OWNER_NAME} is just getting started. You can add yourself now, or check back soon.</p><button class="primary" id="eStart">Add yourself</button>`;
  $('#eStart').onclick = () => { el.hidden = true; openAdd(null, { self: true }); };
}
function pickFocus() {
  const has = id => id && G.people.has(id);
  const from = QS.get('from');
  if (has(STATE.focus)) return STATE.focus;
  if (has(from)) return from;
  if (has(STATE.viewer)) return STATE.viewer;
  if (TREE && has(TREE.meta && TREE.meta.owner_person_id)) return TREE.meta.owner_person_id;
  const first = [...G.people.values()].find(p => !p.placeholder);
  return first ? first.id : null;
}
function applyTree(tree) {
  TREE = tree;
  G = buildGraph(treeToGraphData(tree));
  const own = tree.own || {};
  STATE.viewer = (own.person_id && G.people.has(own.person_id)) ? own.person_id : (STATE.viewer && G.people.has(STATE.viewer) ? STATE.viewer : null);
  STATE.owner = tree.meta && tree.meta.owner_person_id;
  STATE.focus = pickFocus();
  $('#paused').hidden = !(tree.meta && tree.meta.paused) || !!ADMIN_KEY;
  updateMeBar();
}
let loadedOnce = false;
async function reload(opts = {}) {
  let tree;
  try { tree = await api({ action: 'tree' }); }
  catch (err) { if (!loadedOnce) showLoadError(err.message); else toast(err.message); return; }
  const firstTime = !loadedOnce;
  loadedOnce = true;
  $('#loading').hidden = true;
  store.set('roots_cache', JSON.stringify({ at: Date.now(), tree: { ...tree, own: undefined } }));
  applyTree(tree);
  if (!G.people.size) { clearTree(); if (!$('#intro').classList.contains('on')) showEmpty(); return; }
  $('#empty').hidden = true;
  const nothingShown = !live.size;   // first paint, or first person after an empty tree
  // Just saved someone who has no place on screen from here: center on the person they were added to,
  // whose close family always draws, so the new person never seems to vanish.
  let moved = false;
  // On the wheel a new parent lands in the spot that was tapped, so the center stays put.
  if (showAfterSave && STATE.view === 'wheel') showAfterSave = null;
  if (showAfterSave) {
    const { anchor, ids } = showAfterSave; showAfterSave = null;
    const added = ids.filter(x => G.people.has(x));
    if (added.length && G.people.has(anchor) && STATE.focus !== anchor && G.people.has(STATE.focus)) {
      const L = layout();
      if (added.some(x => !L.nodes.has(x))) { STATE.focus = anchor; moved = true; }
    }
  }
  render({ camera: firstTime || nothingShown || opts.camera ? 'instant' : moved ? undefined : false, grow: true });
}
function showLoadError(msg) {
  const el = $('#loading');
  el.hidden = false;
  el.innerHTML = `<p>${esc(msg)}</p><button class="primary" id="lRetry">Try again</button>`;
  $('#lRetry').onclick = () => { el.innerHTML = '<p>Growing the tree…</p>'; reload(); };
}
$('#btnHome').onclick = () => { closePanel(); STATE.focus = STATE.viewer || STATE.owner || STATE.focus; render(); };

(function boot() {
  // Phones start closer in (2026-11-22): at .48 names were about 7 px tall. Pinch or the zoom buttons go further out.
  cam.ts = cam.s = innerWidth < 640 ? .74 : .8;
  if (ADMIN_KEY) $('#ownerBar').hidden = false;
  // Show the last tree this device saw right away, then refresh from the server.
  let cached = null; try { cached = JSON.parse(store.get('roots_cache') || 'null'); } catch (e) {}
  if (cached && cached.tree && (cached.tree.people || []).length) {
    applyTree(cached.tree);
    $('#loading').hidden = true;
    render({ camera: 'instant' });
  } else G = buildGraph({ people: [], rels: [] });
  const seen = store.get('roots_intro_seen') === '1' || QS.has('nointro');
  reload().then(() => {
    if (!seen) openIntro(0);
    offerResume();
  });
})();

function offerResume() {
  let d = null; try { d = JSON.parse(store.get('roots_draft') || 'null'); } catch (e) {}
  if (!d || !d.fields) return;
  if (d.anchor && !G.people.has(d.anchor)) return;
  const f = d.fields;
  if (![f.first, f.last, f.notes, f.born, f.bornPlace, f.source].some(Boolean)) return;
  const who = f.first || f.last || 'someone';
  $('#resumeText').textContent = d.kind === 'edit' ? `You didn't finish your changes to ${P(d.anchor).first || 'someone'}.` : `You didn't finish adding ${who}.`;
  $('#resume').hidden = false;
  $('#resumeNo').onclick = () => { clearDraft(); $('#resume').hidden = true; };
  $('#resumeYes').onclick = () => { $('#resume').hidden = true; d.kind === 'edit' ? openEdit(d.anchor, d) : openAdd(d.anchor, { rel: d.rel, fields: d.fields, self: d.self }); };
}
