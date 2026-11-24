/* =====================================================================
 * Visits and staying in touch (Jonny, 2026-11-24)
 * ===================================================================== */

/* Visits. The first tree load of a visit tells the server, for the tracker on the approvals page: whose link it came
 * from (the ?from= that Send puts in every link), phone or computer, and the browser. A reopening within 30 minutes on
 * this device is the same visit. Never in owner mode. A device opened once with ?notrack (Claude's live checks) stays
 * out of the log for good. The Help guide and the lock box say this is happening. */
if (QS.has('notrack')) store.set('roots_notrack', '1');
const VISIT_GAP = 30 * 60000;
const TRACK_LINE = `${OWNER_NAME} can see when the tree is opened, whose link it came from, and whether it's a phone or computer. Nothing else about your device.`;
function deviceKind() {
  const ua = navigator.userAgent, ipadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPad|Tablet/i.test(ua) || ipadOS || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
  return /Mobi|iPhone|Android/i.test(ua) ? 'phone' : 'computer';
}
function browserName() {
  const ua = navigator.userAgent, ipadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || ipadOS ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  // Facebook's and Instagram's own browsers mean the link was tapped inside Messenger, Facebook or Instagram.
  const br = /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : /Instagram/.test(ua) ? 'Instagram' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Edg\//.test(ua) ? 'Edge' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' ');
}
let visitNote;   // worked out once per page open, so a retried first load still carries it
function visitInfo() {
  if (visitNote !== undefined) return visitNote;
  visitNote = null;
  if (ADMIN_KEY || store.get('roots_notrack') === '1') return null;
  const now = Date.now(), last = +(store.get('roots_visit_at') || 0);
  store.set('roots_visit_at', String(now));
  if (now - last < VISIT_GAP) return null;
  // A device that was here before the tracker existed has a saved tree or has seen the intro: not a first visit.
  const first = !store.get('roots_visited') && !store.get('roots_cache') && store.get('roots_intro_seen') !== '1';
  store.set('roots_visited', '1');
  visitNote = { from: QS.get('from') || '', kind: deviceKind(), browser: browserName(), first };
  return visitNote;
}

/* Stay in touch. Asked right after a relative says who they are (That's me, or saving themselves), never on
 * "Which one is you?" itself. Skip means this device doesn't ask again; their own card keeps a quiet way back.
 * The address goes to the Contributors tab, which only Jonny's approvals page reads. */
const STAY_TEXT = `Share your email and ${OWNER_NAME} can let you know when the tree has big news, or ask you about something you added. Only Jonny sees it. It's never shown on the tree.`;
const myEmail = () => (TREE && TREE.own && TREE.own.email) || '';
const shouldAskEmail = () => !ADMIN_KEY && !myEmail() && store.get('roots_email_skip') !== '1';
const looksLikeEmail = e => /^[^\s@<>,;:"'()[\]\\]+@[^\s@<>,;:"'()[\]\\]+\.[A-Za-z]{2,}$/.test(e);
function stayFormHTML(value = '') {
  return `<div class="stayrow"><input id="stayEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="your@email.com" value="${esc(value)}" aria-label="Your email"></div>
    <p class="hint warn" id="stayErr" hidden></p>`;
}
async function sendEmail(btn, onDone) {
  const email = $('#stayEmail').value.trim();
  const err = m => { $('#stayErr').textContent = m; $('#stayErr').hidden = !m; };
  if (!email) { err('Type your email first, or tap Skip.'); $('#stayEmail').focus(); return; }
  if (!looksLikeEmail(email)) { err("That doesn't look like an email address. Check it and try again."); $('#stayEmail').focus(); return; }
  err(''); btn.disabled = true; btn.textContent = 'Saving…';
  let r;
  try { r = await api({ action: 'set_email', email }); }
  catch (e) { btn.disabled = false; btn.textContent = 'Share'; err(e.message); return; }
  if (TREE) TREE.own = { ...(TREE.own || {}), email: r.email };
  onDone(r.email);
}
// Its own short screen in the side panel (a bottom sheet on phones). after: what to open once it's done or skipped.
function openStayPanel(after, note) {
  const had = myEmail();
  openPanel(`
    <div class="head"><div><h2>${had ? 'Change your email' : 'Stay in touch?'}</h2>${note ? `<div class="sub">${esc(note)}</div>` : ''}</div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body stay"><p>${STAY_TEXT}</p>${stayFormHTML(had)}</div>
    <div class="foot"><button class="iconbtn" id="staySkip">${had ? 'Cancel' : 'Skip'}</button><button class="primary" id="stayShare">Share</button></div>`);
  const leave = () => { if (!had) store.set('roots_email_skip', '1'); closePanel(); if (after) after(); };
  $('#pClose').onclick = leave;
  $('#staySkip').onclick = leave;
  $('#stayShare').onclick = () => sendEmail($('#stayShare'), email => {
    closePanel(); toast(`Thanks. ${OWNER_NAME} can reach you at ${email}.`); if (after) after();
  });
  $('#stayEmail').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#stayShare').click(); } };
  if (innerWidth > 700) $('#stayEmail').focus();
}
// On the thank-you page after a relative saves themselves: the same ask, above "Here's what you sent".
function stayInThanks(self) {
  let el = $('#thanksStay');
  if (!el) { $('#thanksReview').insertAdjacentHTML('beforebegin', '<div class="stay thanksstay" id="thanksStay" hidden></div>'); el = $('#thanksStay'); }
  el.hidden = !(self && shouldAskEmail());
  if (el.hidden) { el.innerHTML = ''; return; }
  el.innerHTML = `<h2>Stay in touch?</h2><p>${STAY_TEXT}</p>${stayFormHTML()}
    <div class="stayacts"><button class="iconbtn" id="staySkip">Skip</button><button class="primary" id="stayShare">Share</button></div>`;
  $('#staySkip').onclick = () => { store.set('roots_email_skip', '1'); el.hidden = true; el.innerHTML = ''; };
  $('#stayShare').onclick = () => sendEmail($('#stayShare'), email => {
    el.innerHTML = `<p class="staydone">Thanks. ${OWNER_NAME} can reach you at <b>${esc(email)}</b>. You can change it any time from your own card.</p>`;
  });
}
// On the relative's own card: what Jonny has, with Change and Remove, or a quiet offer if they skipped.
function contactCardHTML(id) {
  if (ADMIN_KEY || id !== STATE.viewer) return '';
  const e = myEmail();
  return e
    ? `<div class="staycard" id="stayCard"><span>${OWNER_NAME} can reach you at <b>${esc(e)}</b>. Only he sees it.</span><span class="nbtns"><button class="nbtn" id="cChange">Change</button><button class="nbtn" id="cRemove">Remove</button></span></div>`
    : `<div class="staycard" id="stayCard"><span>Want to hear when the tree has big news? Share your email with ${OWNER_NAME}. Only he sees it.</span><button class="nbtn" id="cShare">Share your email</button></div>`;
}
function wireContactCard(id) {
  const back = () => openPerson(id);
  if ($('#cShare')) $('#cShare').onclick = () => openStayPanel(back);
  if ($('#cChange')) $('#cChange').onclick = () => openStayPanel(back);
  if ($('#cRemove')) $('#cRemove').onclick = () => {
    const box = $('#stayCard');
    box.innerHTML = `<span>Remove your email? ${OWNER_NAME} won't be able to reach you through the tree.</span><span class="nbtns"><button class="nbtn yes" id="cRemoveYes">Yes, remove it</button><button class="nbtn" id="cKeep">Keep</button></span>`;
    $('#cKeep').onclick = back;
    $('#cRemoveYes').onclick = async () => {
      box.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try { await api({ action: 'set_email', email: '' }); }
      catch (e) { toast(e.message); back(); return; }
      if (TREE) TREE.own = { ...(TREE.own || {}), email: '' };
      store.set('roots_email_skip', '1');
      toast('Removed.'); back();
    };
  };
}
