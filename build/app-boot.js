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
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M12 20V10"/><path d="M12 14c-3 0-5-2-6-5"/><path d="M12 12c3 0 5-2 6-5"/></svg></span><div><b>Branches far from the center fold into buds.</b><span>Tap a bud to open it. A small +3 on a card means more family there: tap it to center the tree on them.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><div><b>Add who you know.</b><span>Especially the relatives we've lost. A first name is enough to start. ${OWNER_NAME} confirms each addition.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h3M4 12h3M4 17h3"/><path d="M10 7h10M10 12h10M10 17h10"/></svg></span><div><b>Not sure what a line means?</b><span>Tap Key at the top for every symbol and line type.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-3-7-7-1z"/></svg></span><div><b>Send it on.</b><span>Every relative who adds a branch fills in a gap nobody else could.</span></div></li>
    </ul>`,
  () => `
    <h1>Which one is you?</h1>
    <p>Pick yourself so the tree knows where you fit and opens on you. You can skip this and do it later from your own card.</p>
    <div class="field"><label for="iName">Your name</label><input id="iName" placeholder="Start typing" autocomplete="off"></div>
    <div class="pick" id="iList"></div>`
];
let introSteps = [0, 1, 2], introStep = 0;
function renderIntro() {
  const step = introSteps[introStep], last = introStep === introSteps.length - 1;
  $('#introInner').innerHTML = INTRO[step]() + `
    <div class="actions">
      ${introStep > 0 ? '<button class="iconbtn" id="iBack">Back</button>' : ''}
      <button class="primary" id="iNext">${last ? (step === 2 ? 'Skip for now' : 'Start exploring') : step === 0 ? 'Show me how it works' : 'Next'}</button>
      <span style="flex:1"></span><div class="dots">${introSteps.map((_, i) => `<i class="${i === introStep ? 'on' : ''}"></i>`).join('')}</div>
    </div>`;
  $('#intro').scrollTop = 0;
  if (introStep > 0) $('#iBack').onclick = () => { introStep--; renderIntro(); };
  $('#iNext').onclick = () => { if (last) finishIntro(); else { introStep++; renderIntro(); } };
  if (step === 2) {
    const list = () => {
      const q = $('#iName').value.toLowerCase().trim();
      const hits = [...G.people.values()].filter(p => !p.placeholder && isLiving(p) && nameMatches(p, q)).slice(0, 6);
      $('#iList').innerHTML = hits.map(p => `<button data-id="${p.id}">${listName(p)}<small>That's me</small></button>`).join('') + '<button data-id="new"><span>I’m not in the tree yet</span><small>Add me</small></button>';
      document.querySelectorAll('#iList button').forEach(b => b.onclick = () => {
        finishIntro(true);
        if (b.dataset.id === 'new') addMeFlow(); else claimMe(b.dataset.id).then(() => { STATE.focus = STATE.viewer; render(); });
      });
    };
    $('#iName').oninput = list; list();
  }
}
function openIntro(step = 0) {
  introSteps = G.people.size && !STATE.viewer ? [0, 1, 2] : [0, 1];
  introStep = Math.min(step, introSteps.length - 1); renderIntro(); showPage('intro');
}
function finishIntro(quiet) {
  hidePage('intro');
  store.set('roots_intro_seen', '1');
  if (!quiet && G.people.size) { clearTree(); setTimeout(() => render({ camera: 'instant' }), 250); }
  if (!G.people.size) showEmpty();
}
function addMeFlow() {
  if (!G.people.size) { openAdd(null, { self: true }); return; }
  pickPerson("Who's your closest relative here?", "Pick a parent, sibling, partner or child who's already in the tree. You'll add yourself next to them.",
    id => openAdd(id, { self: true, rel: 'child' }));
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
  cam.ts = cam.s = innerWidth < 640 ? .48 : .8;
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
