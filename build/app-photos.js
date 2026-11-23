/* =====================================================================
 * Photos and documents (2026-11-22)
 * Adding: phone camera, photo library or files; on a computer, files or drag and drop. Photos and scans are shrunk
 * on the device before sending (1600 px photos, 2400 px documents, so a census page stays readable); re-saving also
 * drops the GPS location phone photos carry. PDFs, and HEIC or TIFF a browser can't read, go up as they are (10 MB).
 * Every photo shows on the card of everyone tagged in it. Nothing a relative adds shows to anyone else until Jonny
 * confirms it; their own unconfirmed uploads and tags show on their screen right away, marked Unconfirmed.
 * Files live in the "Roots photos" folder in Jonny's Google Drive, private until he approves them.
 * ===================================================================== */
const PHOTO_BY_ID = new Map();
const FILE_MAX = 10 * 1024 * 1024;
const UP_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', pdf: 'application/pdf' };
const ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
const ICON_PIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>';

/* Approved photos, plus this device's own unconfirmed uploads and tags, by person. */
function indexPhotos(tree) {
  PHOTOS.clear(); PHOTO_BY_ID.clear();
  const add = (pid, f) => { if (!PHOTOS.has(pid)) PHOTOS.set(pid, []); if (!PHOTOS.get(pid).includes(f)) PHOTOS.get(pid).push(f); };
  const own = tree.own || {}, ownTags = own.tags || [];
  (own.photos || []).forEach(f => {
    const x = { ...f, pending: true, tags: ownTags.filter(t => t.photo_id === f.id).map(t => t.person_id) };
    PHOTO_BY_ID.set(x.id, x); x.tags.forEach(pid => add(pid, x));
  });
  (tree.photos || []).forEach(f => { const x = { ...f, tags: [...(f.tags || [])] }; PHOTO_BY_ID.set(x.id, x); x.tags.forEach(pid => add(pid, x)); });
  ownTags.forEach(t => {
    const x = PHOTO_BY_ID.get(t.photo_id);
    if (!x || x.pending) return;
    (x.myTags = x.myTags || []).push(t); add(t.person_id, x);
  });
  // Their unconfirmed changes to a confirmed photo's details show on their screen right away (2026-11-23).
  (own.suggestions || []).forEach(sg => {
    const x = PHOTO_BY_ID.get(sg.target_id);
    if (!x || x.pending || !PHOTO_EDIT_FIELDS.includes(sg.field)) return;
    if (!x.base) x.base = { caption: x.caption || '', date_taken: x.date_taken || '', place: x.place || '', kind: x.kind || 'photo' };
    x[sg.field] = sg.value; (x.edits = x.edits || []).push(sg);
  });
}
const PHOTO_EDIT_FIELDS = ['caption', 'date_taken', 'place', 'kind'];
const isPdf = f => f.mime === 'application/pdf';
/* A preview that won't load (Drive still making it, or offline) becomes the plain icon. */
function phFail(img, doc, big) { const s = document.createElement('span'); s.className = 'phicon' + (big ? ' big' : ''); s.innerHTML = doc ? ICON_DOC : ICON_PIC; img.replaceWith(s); }
const kindWord = f => f.kind === 'document' ? 'document' : 'photo';

/* Previews of this device's own unconfirmed uploads: kept from the upload, else asked for once (own_thumb). */
function localThumbs() { try { return JSON.parse(store.get('roots_thumbs') || '{}'); } catch (e) { return {}; } }
function saveThumb(id, url) {
  if (!url) return;
  const t = localThumbs(); t[id] = url;
  const keys = Object.keys(t); keys.slice(0, Math.max(0, keys.length - 40)).forEach(k => delete t[k]);
  store.set('roots_thumbs', JSON.stringify(t));
}
const thumbAsked = new Set();
function thumbSrc(f, w) { return f.pending ? (localThumbs()[f.id] || '') : photoURL(f.file_id, w); }
function fillPendingThumbs(root) {
  root.querySelectorAll('[data-needthumb]').forEach(async el => {
    const id = el.dataset.needthumb;
    if (thumbAsked.has(id)) return;
    thumbAsked.add(id);
    let res; try { res = await api({ action: 'own_thumb', id }); } catch (e) { return; }
    if (!res.thumbnail) return;
    saveThumb(id, res.thumbnail);
    document.querySelectorAll(`[data-needthumb="${id}"]`).forEach(x => { x.outerHTML = `<img src="${res.thumbnail}" alt="">`; });
  });
}
function thumbHTML(f, w) {
  const src = thumbSrc(f, w);
  if (src) return `<img src="${esc(src)}" alt="${esc(f.caption || (f.kind === 'document' ? 'Document' : 'Photo'))}" loading="lazy" onerror="phFail(this, ${f.kind === 'document'})">`;
  return `<span class="phicon" data-needthumb="${esc(f.id)}">${f.kind === 'document' ? ICON_DOC : ICON_PIC}</span>`;
}

/* ---- the card's section ---- */
function photoSectionHTML(id) {
  const list = PHOTOS.get(id) || [];
  const tiles = list.slice(0, 6).map((f, i) => `<button class="photo real${f.pending ? ' pend' : ''}" data-ph="${i}" aria-label="${esc(f.caption || (f.kind === 'document' ? 'Document' : 'Photo'))}">${thumbHTML(f, 400)}${f.kind === 'document' ? '<span class="dbadge">Document</span>' : ''}${f.pending ? '<span class="ptag">Unconfirmed</span>' : ''}</button>`).join('');
  const more = list.length > 6 ? `<button class="photo more" data-ph="0">See all ${list.length}</button>` : '';
  return `<div><div class="label">Photos &amp; documents</div><div class="photos">${tiles}${more}<button class="photo add" id="pAddPhoto">Add photos or documents</button></div></div>`;
}
function wirePhotoSection(id) {
  document.querySelectorAll('#panel [data-ph]').forEach(b => b.onclick = () => openViewer(id, +b.dataset.ph));
  const ap = $('#pAddPhoto'); if (ap) ap.onclick = () => openUpload(id);
  fillPendingThumbs(panel);
}

/* ---- viewer: full screen, swipe or arrows between a person's photos ---- */
const viewer = document.createElement('div');
viewer.className = 'viewer'; viewer.id = 'viewer'; viewer.hidden = true;
viewer.setAttribute('role', 'dialog'); viewer.setAttribute('aria-modal', 'true'); viewer.setAttribute('aria-label', 'Photo');
document.body.appendChild(viewer);
let VW = null;
function openViewer(personId, i) { openViewerList(() => PHOTOS.get(personId) || [], i, personId); }
/* listFn rebuilds the list after a reload (a new tag, a take back), so the viewer stays on the same photo. */
function openViewerList(listFn, i, from = null) {
  VW = { from, listFn, list: listFn(), i };
  if (!VW.list.length) return;
  viewer.hidden = false; document.body.classList.add('viewing'); renderViewer();
}
/* Everyone in a photo: its confirmed tags, plus this device's own unconfirmed ones. */
function photoTagList(f) {
  const people = f.tags.filter(pid => G.people.has(pid)).map(pid => ({ pid, mine: !!f.pending }));
  (f.myTags || []).forEach(t => { if (G.people.has(t.person_id) && !people.some(x => x.pid === t.person_id)) people.push({ pid: t.person_id, mine: true }); });
  return people;
}
function closeViewer() { viewer.hidden = true; document.body.classList.remove('viewing'); VW = null; }
function viewerStep(d) { if (!VW || VW.list.length < 2) return; VW.i = (VW.i + d + VW.list.length) % VW.list.length; renderViewer(); }
function renderViewer() {
  const f = VW.list[VW.i], n = VW.list.length, doc = f.kind === 'document';
  const big = f.pending ? thumbSrc(f) : photoURL(f.file_id, 2000);
  const people = photoTagList(f);
  const meta = [f.date_taken ? fuzzyLong(f.date_taken) : '', f.place || ''].filter(Boolean).join(' · ');
  const open = f.pending ? '' : isPdf(f)
    ? `<a class="vlink" href="https://drive.google.com/file/d/${encodeURIComponent(f.file_id)}/view" target="_blank" rel="noopener">Open the full document</a>`
    : `<a class="vlink" href="${photoURL(f.file_id, 4000)}" target="_blank" rel="noopener">Open full size</a>`;
  viewer.innerHTML = `
    <div class="vtop"><span class="vcount">${n > 1 ? `${VW.i + 1} of ${n}` : ''}</span><button class="vx" id="vClose" aria-label="Close">${ICON.close}</button></div>
    <div class="vstage" id="vStage">
      ${n > 1 ? '<button class="varrow prev" id="vPrev" aria-label="Previous">‹</button>' : ''}
      ${big ? `<img src="${esc(big)}" alt="${esc(f.caption || kindWord(f))}" onerror="phFail(this, ${doc}, true)">` : `<span class="phicon big" data-needthumb="${esc(f.id)}">${doc ? ICON_DOC : ICON_PIC}</span>`}
      ${n > 1 ? '<button class="varrow next" id="vNext" aria-label="Next">›</button>' : ''}
    </div>
    <div class="vinfo">
      ${f.pending ? `<p class="vpend"><span class="ptag">Unconfirmed</span> Only you see this until ${OWNER_NAME} confirms it.${big ? ' Full size shows then too.' : ''}</p>` : ''}
      ${f.edits ? `<p class="vpend" id="vEdits"><span class="ptag">Your edit</span> Only you see your change until ${OWNER_NAME} confirms it. <button class="nbtn" id="vEditsBack">Take back</button></p>` : ''}
      <h3>${esc(f.caption || (doc ? 'Document' : 'Photo'))}</h3>
      ${meta ? `<p class="vmeta">${esc(meta)}</p>` : ''}
      ${open}
      <div class="vpeople"><span class="lab">${doc ? 'About' : 'In this photo'}</span>
        ${people.map(x => `<button class="chip${x.mine && !f.pending ? ' pend' : ''}" data-goto-person="${esc(x.pid)}">${esc(cardName(P(x.pid)))}${relPhrase(x.pid) ? ` <span class="crel">${esc(relPhrase(x.pid))}</span>` : ''}${x.mine && !f.pending ? ' <em>unconfirmed</em>' : ''}</button>`).join('') || '<span class="muted">Nobody tagged yet.</span>'}
      </div>
      <div class="vtag" id="vTagBox" hidden><input id="vTagQ" placeholder="Start typing a name" autocomplete="off" aria-label="Who to tag"><div class="pick" id="vTagList"></div></div>
      ${f.source || f.added_by ? `<p class="prov">${[f.added_by ? 'Added by ' + esc(f.added_by) : '', f.source ? 'Source: ' + esc(f.source) : ''].filter(Boolean).join(' · ')}</p>` : ''}
      <div class="vedit" id="vEditBox" hidden></div>
      <div class="vbtns"><button class="iconbtn" id="vEdit">${f.caption ? 'Edit details' : 'Add a caption and date'}</button><button class="iconbtn" id="vTag">Tag someone</button>${f.pending ? '<button class="iconbtn" id="vTakeBack">Take back</button>' : ''}</div>
    </div>`;
  $('#vClose').onclick = closeViewer;
  if ($('#vPrev')) { $('#vPrev').onclick = () => viewerStep(-1); $('#vNext').onclick = () => viewerStep(1); }
  viewer.querySelectorAll('[data-goto-person]').forEach(b => b.onclick = () => { const pid = b.dataset.gotoPerson; closeViewer(); openPerson(pid); });
  $('#vTag').onclick = () => openViewerTag(f);
  $('#vEdit').onclick = () => openPhotoEdit(f);
  if ($('#vEditsBack')) $('#vEditsBack').onclick = async () => {
    $('#vEditsBack').disabled = true;
    try { await api({ action: 'withdraw', ids: f.edits.map(x => x.id) }); } catch (err) { toast(err.message); renderViewer(); return; }
    toast('Your change is taken back.'); await afterPhotoChange(f.id);
  };
  if ($('#vTakeBack')) $('#vTakeBack').onclick = () => {
    const box = $('#vTakeBack').parentElement;
    box.innerHTML = `<span>Take back this ${kindWord(f)}? ${OWNER_NAME} won't see it.</span><button class="nbtn yes" id="vTbYes">Yes, take back</button><button class="nbtn" id="vTbNo">Keep</button>`;
    $('#vTbNo').onclick = renderViewer;
    $('#vTbYes').onclick = async () => {
      $('#vTbYes').disabled = true;
      try { await api({ action: 'withdraw', ids: [f.id] }); } catch (err) { toast(err.message); renderViewer(); return; }
      const from = VW.from; closeViewer(); toast('Taken back.'); await reload(); if (from && G.people.has(from)) openPerson(from);
    };
  };
  fillPendingThumbs(viewer);
}
/* Edit a photo's details (Jonny, 2026-11-23): caption, when, where, photo or document. Jonny's edits apply at once;
   a relative's own unconfirmed upload is fixed in place; anyone else's edit to a confirmed photo goes to Jonny as a
   correction, replacing their own earlier unconfirmed change to it, and shows on their screen as "Your edit". */
function openPhotoEdit(f) {
  const box = $('#vEditBox'); box.hidden = false; $('#vEdit').hidden = true;
  const kind = f.kind === 'document' ? 'document' : 'photo';
  box.innerHTML = `
    <div class="field"><label for="peCap">${kind === 'document' ? 'What is it?' : "What's happening? Who's in it?"}</label><textarea id="peCap" rows="2" placeholder="${kind === 'document' ? 'Birth certificate, a letter from Grandpa' : 'Thanksgiving at Barbara\'s'}">${esc(f.caption || '')}</textarea></div>
    <div class="row2"><div class="field"><label for="peWhen">When</label><input id="peWhen" value="${esc(fuzzyToText(f.date_taken))}" placeholder="1965, about 1965"></div>
      <div class="field"><label for="pePlace">Where</label><input id="pePlace" value="${esc(f.place || '')}" placeholder="Grandma's house, Cleveland"></div></div>
    <div class="seg small" role="group" aria-label="Photo or document" id="peKind"><button type="button" data-v="photo" aria-pressed="${kind === 'photo'}">Photo</button><button type="button" data-v="document" aria-pressed="${kind === 'document'}">Document</button></div>
    <p class="hint">${ADMIN_KEY ? 'Saves right away.' : f.pending ? `Fixes what you sent. ${OWNER_NAME} hasn't looked at it yet.` : `${OWNER_NAME} confirms changes before everyone sees them. You'll see yours right away.`}</p>
    <p class="formerr" id="peErr" role="alert" hidden></p>
    <div class="vbtns"><button class="primary" id="peSave">Save</button><button class="iconbtn" id="peCancel">Cancel</button></div>`;
  box.querySelectorAll('#peKind button').forEach(b => b.onclick = () => box.querySelectorAll('#peKind button').forEach(x => x.setAttribute('aria-pressed', x === b)));
  box.oninput = () => { $('#peErr').hidden = true; };
  $('#peCancel').onclick = renderViewer;
  $('#peSave').onclick = () => savePhotoEdit(f);
  $('#peCap').focus();
}
async function savePhotoEdit(f) {
  const err = m => { $('#peErr').textContent = m; $('#peErr').hidden = !m; };
  let now;
  try {
    now = { caption: $('#peCap').value.trim(), date_taken: toFuzzy($('#peWhen').value, 'When'), place: $('#pePlace').value.trim(),
      kind: (box => (box.querySelector('[aria-pressed="true"]') || {}).dataset.v || 'photo')($('#peKind')) };
  } catch (e) { err(e.message); return; }
  const btn = $('#peSave'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (f.pending) await api({ action: 'own_edit', id: f.id, data: now });
    else {
      const was = f.base || { caption: f.caption || '', date_taken: f.date_taken || '', place: f.place || '', kind: f.kind || 'photo' };
      const items = PHOTO_EDIT_FIELDS.filter(k => (now[k] || '') !== (was[k] || '')).map(k => ({ kind: 'suggestion', target_id: f.id, field: k, value: now[k] }));
      const earlier = (f.edits || []).map(x => x.id);
      if (!items.length && !earlier.length) { renderViewer(); toast('Nothing changed.'); return; }
      if (items.length) await api({ action: 'submit', items, withdraw: earlier.length ? earlier : undefined });
      else await api({ action: 'withdraw', ids: earlier });
    }
  } catch (e) { btn.disabled = false; btn.textContent = 'Save'; err(e.message); return; }
  toast(ADMIN_KEY ? 'Saved.' : f.pending ? 'Fixed.' : `Sent to ${OWNER_NAME}. You'll see your change now, marked Your edit.`);
  await afterPhotoChange(f.id);
}
/* After a change, reload and put the viewer back on the same photo. */
async function afterPhotoChange(id) {
  const { from, listFn } = VW;
  await reload();
  const list = listFn(), i = list.findIndex(x => x.id === id);
  if (i >= 0 && !viewer.hidden) { VW = { from, listFn, list, i }; renderViewer(); } else closeViewer();
}
function openViewerTag(f) {
  const box = $('#vTagBox'); box.hidden = false; $('#vTag').hidden = true;
  const have = new Set([...f.tags, ...(f.myTags || []).map(t => t.person_id)]);
  const list = () => {
    const q = $('#vTagQ').value.toLowerCase().trim();
    const hits = q ? [...G.people.values()].filter(p => !p.placeholder && !have.has(p.id) && nameMatches(p, q)).slice(0, 6) : [];
    $('#vTagList').innerHTML = !q ? '<p class="hint">Names show up here as you type.</p>' : hits.map(p => `<button data-id="${p.id}">${listName(p)}</button>`).join('') || '<p class="hint">Nobody by that name yet.</p>';
    $('#vTagList').querySelectorAll('button').forEach(b => b.onclick = () => sendTag(f, b.dataset.id));
  };
  $('#vTagQ').oninput = list; list(); $('#vTagQ').focus();
}
async function sendTag(f, pid) {
  $('#vTagList').querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await api({ action: 'submit', items: [{ kind: 'tag', photo_id: f.id, person_id: pid }] }); }
  catch (err) { toast(err.message); openViewerTag(f); return; }
  toast(ADMIN_KEY ? `Tagged ${refName(P(pid))}.` : `Tagged ${refName(P(pid))}. It shows on their card once ${OWNER_NAME} confirms it; you see it now.`);
  const { from, listFn } = VW, id = f.id;
  await reload();
  const list = listFn();
  const i = list.findIndex(x => x.id === id);
  if (i >= 0 && !viewer.hidden) { VW = { from, listFn, list, i }; renderViewer(); }
}
document.addEventListener('keydown', e => {
  if (viewer.hidden) return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft' && e.target.tagName !== 'INPUT') viewerStep(-1);
  else if (e.key === 'ArrowRight' && e.target.tagName !== 'INPUT') viewerStep(1);
});
{
  let sx = null;
  viewer.addEventListener('touchstart', e => { sx = e.target.closest('#vStage') ? e.touches[0].clientX : null; }, { passive: true });
  viewer.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) viewerStep(dx < 0 ? 1 : -1); });
}

/* ---- adding ---- */
let UP = null;
const coarse = () => matchMedia('(pointer: coarse)').matches;
function fileType(file) {
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1];
  const byExt = ext ? UP_TYPES[ext.toLowerCase()] : '';
  const t = (file.type || '').toLowerCase();
  return Object.values(UP_TYPES).includes(t) ? t : byExt || t;
}
function openUpload(personId) {
  const p = P(personId);
  UP = { anchor: personId, files: [], tags: [personId], seq: 0 };
  const phone = coarse();
  openPanel(`
    <div class="head"><div><h2>Add photos or documents</h2><div class="sub">For ${esc(p.first || 'their')}'s card. Old photos, scans of certificates, letters and newspaper clippings all belong here.</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body form">
      <div class="upbtns">
        ${phone ? `<button type="button" class="primary" data-pick="upLib">Choose from your photos</button>
        <button type="button" class="iconbtn" data-pick="upCam">Take a photo</button>
        <button type="button" class="iconbtn" data-pick="upFile">Choose a file</button>`
        : `<button type="button" class="primary" data-pick="upFile">Choose files from your computer</button>`}
      </div>
      ${phone ? '' : '<div class="dropzone" id="upDrop">Or drag photos and PDFs here</div>'}
      <p class="hint">Photos (JPEG, PNG, HEIC and the like) and PDFs, up to 10 MB each. You can pick several at once.</p>
      <input type="file" id="upLib" accept="image/*" multiple hidden>
      <input type="file" id="upCam" accept="image/*" capture="environment" hidden>
      <input type="file" id="upFile" accept="image/*,application/pdf,.pdf,.heic,.heif,.tif,.tiff" multiple hidden>
      <div id="upList"></div>
      <div id="upShared" hidden>
        <div class="field"><span class="lab">Who's in them, or who they're about</span>
          <div class="chips" id="upTags"></div>
          <input id="upTagQ" placeholder="Add someone: start typing a name" autocomplete="off" aria-label="Add someone">
          <div class="pick" id="upTagList"></div></div>
        <div class="field"><label for="upPlace">Where</label><input id="upPlace" placeholder="Grandma's house, Cleveland"></div>
        <div class="field"><label for="upSource">Where it came from</label><input id="upSource" placeholder="Grandma's album, the Herald, 1962"></div>
        <p class="hint">${ADMIN_KEY ? 'These go on the tree right away. Documents that show a living person go to confirmed family only.'
          : `${OWNER_NAME} looks at each one before the family sees it. You'll see yours right away, marked Unconfirmed. A document that shows a living person goes to confirmed family only, never to everyone with the link.`}</p>
      </div>
      <p class="formerr" id="upErr" role="alert" hidden></p>
    </div>
    <div class="foot"><button class="iconbtn" id="upCancel">Cancel</button><button class="primary" id="upGo" disabled>Upload</button></div>`);
  $('#pClose').onclick = () => guardClose(() => openPerson(personId));
  $('#upCancel').onclick = () => guardClose(() => openPerson(personId));
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => $('#' + b.dataset.pick).click());
  ['upLib', 'upCam', 'upFile'].forEach(id => { $('#' + id).onchange = e => { addUpFiles([...e.target.files]); e.target.value = ''; }; });
  const dz = $('#upDrop');
  if (dz) {
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); addUpFiles([...e.dataTransfer.files]); };
  }
  $('#upGo').onclick = doUpload;
  currentSave = doUpload;
  renderUpTags();
  $('#upTagQ').oninput = renderUpTagList;
}
function addUpFiles(files) {
  const bad = [];
  files.forEach(file => {
    const type = fileType(file);
    if (!Object.values(UP_TYPES).includes(type)) { bad.push(`${file.name}: that kind of file can't be added. Photos and PDFs work.`); return; }
    if (type === 'application/pdf' && file.size > FILE_MAX) { bad.push(`${file.name} is over 10 MB. Try a smaller scan.`); return; }
    UP.files.push({ key: 'f' + (++UP.seq), file, type, kind: type === 'application/pdf' ? 'document' : 'photo', url: URL.createObjectURL(file) });
  });
  showUpErr(bad.join(' '));
  renderUpList();
}
function showUpErr(msg) { $('#upErr').textContent = msg; $('#upErr').hidden = !msg; }
function renderUpList() {
  const keep = {};
  document.querySelectorAll('#upList .uprow').forEach(r => { keep[r.dataset.k] = { cap: r.querySelector('.upcap').value, when: r.querySelector('.upwhen').value }; });
  $('#upList').innerHTML = UP.files.map(f => {
    const k = keep[f.key] || {};
    const prev = f.type === 'application/pdf' ? `<span class="phicon">${ICON_DOC}</span>`
      : `<img src="${f.url}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'phicon small',textContent:'Preview after upload'}))">`;
    return `<div class="uprow" data-k="${f.key}">
      <div class="upthumb">${prev}</div>
      <div class="upfields">
        <div class="upname"><span>${esc(f.file.name || 'Photo')}</span><button type="button" class="rm" aria-label="Remove ${esc(f.file.name || 'this file')}">×</button></div>
        <div class="seg small" role="group" aria-label="What is it?"><button type="button" data-v="photo" aria-pressed="${f.kind === 'photo'}">Photo</button><button type="button" data-v="document" aria-pressed="${f.kind === 'document'}">Document</button></div>
        <input class="upcap" placeholder="${f.kind === 'document' ? 'What is it? Birth certificate, a letter from Grandpa' : "What's happening? Who's in it?"}" value="${esc(k.cap || '')}" aria-label="Caption">
        <input class="upwhen" placeholder="When: 1965, about 1965" value="${esc(k.when || '')}" aria-label="When">
      </div></div>`;
  }).join('');
  document.querySelectorAll('#upList .uprow').forEach(r => {
    const f = UP.files.find(x => x.key === r.dataset.k);
    r.querySelector('.rm').onclick = () => { UP.files = UP.files.filter(x => x !== f); renderUpList(); };
    r.querySelectorAll('.seg button').forEach(b => b.onclick = () => { f.kind = b.dataset.v; renderUpList(); });
  });
  const n = UP.files.length;
  $('#upShared').hidden = !n;
  $('#upGo').disabled = !n;
  $('#upGo').textContent = n > 1 ? `Upload ${n}` : 'Upload';
  formDirty = n > 0;
}
function renderUpTags() {
  $('#upTags').innerHTML = UP.tags.map(pid => `<span class="chip">${esc(cardName(P(pid)))}<button type="button" aria-label="Untag ${esc(cardName(P(pid)))}" data-untag="${esc(pid)}">×</button></span>`).join('') || '<span class="muted">Nobody yet.</span>';
  $('#upTags').querySelectorAll('[data-untag]').forEach(b => b.onclick = () => { UP.tags = UP.tags.filter(x => x !== b.dataset.untag); renderUpTags(); });
}
function renderUpTagList() {
  const q = $('#upTagQ').value.toLowerCase().trim();
  const hits = q ? [...G.people.values()].filter(p => !p.placeholder && !UP.tags.includes(p.id) && nameMatches(p, q)).slice(0, 6) : [];
  $('#upTagList').innerHTML = q ? hits.map(p => `<button type="button" data-id="${p.id}">${listName(p)}</button>`).join('') || '<p class="hint">Nobody by that name yet.</p>' : '';
  $('#upTagList').querySelectorAll('button').forEach(b => b.onclick = () => { UP.tags.push(b.dataset.id); $('#upTagQ').value = ''; renderUpTagList(); renderUpTags(); });
}
function loadImg(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }); }
function blobToB64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); }); }
function drawTo(im, max, q) {
  const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(im, 0, 0, c.width, c.height);
  return c;
}
/* Shrinks an image the browser can read; anything else goes up as it is, within 10 MB. */
async function prepareUpload(f) {
  if (f.type !== 'application/pdf') {
    let im = null;
    try { im = await loadImg(f.url); } catch (e) { im = null; }
    if (im && im.naturalWidth) {
      const big = drawTo(im, f.kind === 'document' ? 2400 : 1600);
      const blob = await new Promise(r => big.toBlob(r, 'image/jpeg', 0.85));
      if (blob) return { b64: await blobToB64(blob), mime: 'image/jpeg', thumb: drawTo(im, 320).toDataURL('image/jpeg', 0.7) };
    }
  }
  if (f.file.size > FILE_MAX) throw new Error(`${f.file.name} is over 10 MB.`);
  return { b64: await blobToB64(f.file), mime: f.type, thumb: '' };
}
async function doUpload() {
  if (saving || !UP || !UP.files.length) return;
  showUpErr('');
  const rows = UP.files.map(f => {
    const r = document.querySelector(`#upList .uprow[data-k="${f.key}"]`);
    return { f, caption: r.querySelector('.upcap').value.trim(), when: r.querySelector('.upwhen').value.trim() };
  });
  try { rows.forEach(x => { x.date = toFuzzy(x.when, `When (${x.f.file.name || 'photo'})`); }); }
  catch (err) { showUpErr(err.message); return; }
  const place = $('#upPlace').value.trim(), source = $('#upSource').value.trim(), tags = [...UP.tags];
  const btn = $('#upGo'), anchor = UP.anchor, total = rows.length;
  saving = true; btn.disabled = true; $('#upCancel').disabled = true;
  let done = 0;
  for (const x of rows) {
    btn.textContent = total > 1 ? `Uploading ${done + 1} of ${total}…` : 'Uploading…';
    try {
      const prep = await prepareUpload(x.f);
      const res = await api({ action: 'upload_photo', image: prep.b64, mime: prep.mime, kind: x.f.kind, caption: x.caption,
        date_taken: x.date, place, source, tags });
      saveThumb(res.id, prep.thumb);
      UP.files = UP.files.filter(f => f !== x.f);
      done++;
    } catch (err) {
      saving = false; $('#upCancel').disabled = false;
      renderUpList();
      showUpErr(`${x.f.file.name || 'A file'} didn't upload: ${err.message}${done ? ` The ${done} before it went through.` : ''} Tap Upload to try again.`);
      if (done) reload();
      return;
    }
  }
  saving = false; formDirty = false; UP = null;
  closePanel();
  toast(ADMIN_KEY ? (done > 1 ? `Added ${done}.` : 'Added.')
    : `Sent${done > 1 ? ' ' + done : ''}. You'll see ${done > 1 ? 'them' : 'it'} now, marked Unconfirmed, until ${OWNER_NAME} confirms.`);
  await reload();
  if (STATE.view !== 'photos' && G.people.has(anchor)) openPerson(anchor);
}

/* =====================================================================
 * All photos (Jonny, 2026-11-23): the Photos choice in the Tree / Wheel / Photos switch.
 * Every photo and document the viewer may see (their own unconfirmed ones too), each with its caption, date and
 * place, and everyone in it named with how they're related to the viewer and whose child they are, so an old group
 * photo reads as a family, not a list of strangers. Grouped by decade taken, or newest added first; narrowed to
 * one person, or to photos or documents. Page only: built from the same tree the API already sends.
 * ===================================================================== */
const photosEl = document.createElement('div');
photosEl.id = 'photos'; photosEl.hidden = true;
document.body.appendChild(photosEl);
const PG = { who: null, kind: 'all', sort: 'taken' };
function relPhrase(pid) {
  const r = relation(pid);
  if (!r) return '';
  if (r === 'You') return 'you';
  if (/^[A-Z][^ ]*'s /.test(r)) return r;   // "Kayla's child": already says whose
  return 'your ' + r.charAt(0).toLowerCase() + r.slice(1);
}
function pgList() {
  let list = [...PHOTO_BY_ID.values()].filter(f => photoTagList(f).length || f.pending || !f.tags.length);
  if (PG.kind !== 'all') list = list.filter(f => (f.kind === 'document' ? 'document' : 'photo') === PG.kind);
  if (PG.who) list = list.filter(f => photoTagList(f).some(x => x.pid === PG.who));
  const yr = f => { const d = parseFuzzy(f.date_taken); return d ? d.y + (d.m || 0) / 13 : Infinity; };
  return PG.sort === 'added'
    ? list.sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))
    : list.sort((a, b) => yr(a) - yr(b) || String(a.caption || '').localeCompare(String(b.caption || '')));
}
function pgPersonHTML(x) {
  const q = P(x.pid), rel = relPhrase(x.pid), yrs = !isLiving(q) && (q.born || q.died) ? years(q) : '';
  const sub = [whoLine(q), yrs].filter(Boolean).join(' · ');
  return `<li><button class="pgname" data-goto-person="${esc(x.pid)}">${esc(cardName(q))}</button>${rel ? `<span class="pgrel">${esc(rel)}</span>` : ''}${x.mine && !x.ownPhoto ? '<em class="pgun">unconfirmed</em>' : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</li>`;
}
function pgCardHTML(f, i) {
  const doc = f.kind === 'document';
  const people = photoTagList(f).map(x => ({ ...x, ownPhoto: !!f.pending }));
  const meta = [f.date_taken ? fuzzyLong(f.date_taken) : '', f.place || ''].filter(Boolean).join(' · ');
  const prov = [f.source ? 'From ' + esc(f.source) : '', f.added_by ? 'Added by ' + esc(f.added_by) : f.pending ? 'Added by you' : ''].filter(Boolean).join(' · ');
  return `<article class="pgcard${f.pending ? ' pend' : ''}">
    <button class="pgimg" data-pgi="${i}" aria-label="Open ${esc(f.caption || (doc ? 'document' : 'photo'))} full screen">${thumbHTML(f, 800)}${doc ? '<span class="dbadge">Document</span>' : ''}${f.pending ? '<span class="ptag">Unconfirmed</span>' : ''}</button>
    <div class="pginfo">
      <h3>${esc(f.caption || (doc ? 'Document' : 'Photo'))}</h3>
      ${meta ? `<p class="vmeta">${esc(meta)}</p>` : ''}
      ${f.pending ? `<p class="vmeta">Only you see this until ${OWNER_NAME} confirms it.</p>` : ''}
      ${f.edits ? `<p class="vmeta"><span class="pgun">Your edit</span> Waiting for ${OWNER_NAME} to confirm your change.</p>` : ''}
      <div class="pgwho"><span class="lab">${doc ? 'About' : people.length === 1 ? 'Who you\'re seeing' : `Who you're seeing (${people.length})`}</span>
        ${people.length ? `<ul>${people.map(pgPersonHTML).join('')}</ul>` : '<p class="muted">Nobody tagged yet. Open it and tap Tag someone if you know who this is.</p>'}</div>
      ${prov ? `<p class="prov">${prov}</p>` : ''}
      <div><button class="nbtn pgedit" data-pge="${i}">${f.caption ? 'Edit details' : 'Add a caption and date'}</button></div>
    </div></article>`;
}
function photosTop() {
  return Math.max(...[...document.querySelectorAll('.topbar, .banner, .mebar')].filter(el => !el.hidden && el.getClientRects().length && getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect().bottom), 60);
}
function renderPhotosPage(toTop) {
  if (STATE.view !== 'photos') return;
  photosEl.style.paddingTop = (photosTop() + 12) + 'px';
  const all = [...PHOTO_BY_ID.values()];
  const nPhotos = all.filter(f => f.kind !== 'document').length, nDocs = all.length - nPhotos;
  if (PG.who && !G.people.has(PG.who)) PG.who = null;
  const list = pgList();
  const count = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let body = '';
  if (!all.length) body = `<div class="pgempty"><p>No photos or documents yet.</p><p>Old photos, scans of certificates, letters and clippings all belong here. Tap <b>Add photos or documents</b>, pick someone who's in them, and they'll show here and on everyone's card who's tagged.</p></div>`;
  else if (!list.length) body = `<div class="pgempty"><p>Nothing ${PG.who ? 'of ' + esc(refName(P(PG.who))) : ''} ${PG.kind === 'document' ? 'among the documents' : PG.kind === 'photo' ? 'among the photos' : ''} yet.</p></div>`;
  else if (PG.sort === 'added') body = list.map((f, i) => pgCardHTML(f, i)).join('');
  else {
    let last = null;
    list.forEach((f, i) => {
      const d = parseFuzzy(f.date_taken), g = d ? Math.floor(d.y / 10) * 10 + 's' : 'Date not known';
      if (g !== last) { body += `<h2 class="pgdec">${g}</h2>`; last = g; }
      body += pgCardHTML(f, i);
    });
  }
  photosEl.innerHTML = `<div class="pgwrap">
    <div class="pghead"><div><h1>Photos &amp; documents</h1>
      <p class="sub">${all.length ? `${[nPhotos && count(nPhotos, 'photo'), nDocs && count(nDocs, 'document')].filter(Boolean).join(' and ')} from the family. Tap one to see it full size, or a name to open their card.` : ''}</p></div>
      <button class="primary" id="pgAdd">Add photos or documents</button></div>
    ${all.length ? `<div class="pgfilters">
      <div class="seg small" role="group" aria-label="Show">${[['all', 'All'], ['photo', 'Photos'], ['document', 'Documents']].map(([v, l]) => `<button data-kind="${v}" aria-pressed="${PG.kind === v}">${l}</button>`).join('')}</div>
      ${PG.who ? `<span class="chip">Only ${esc(refName(P(PG.who)))}<button aria-label="Show everyone" id="pgWhoX">×</button></span>` : '<button class="chip" id="pgWho">Only one person…</button>'}
      <label class="pgsort">Order <select id="pgSort"><option value="taken"${PG.sort === 'taken' ? ' selected' : ''}>When taken, oldest first</option><option value="added"${PG.sort === 'added' ? ' selected' : ''}>Newest added first</option></select></label>
    </div>` : ''}
    ${body}</div>`;
  if (toTop) photosEl.scrollTop = 0;
  $('#pgAdd').onclick = () => pickPerson('Add photos or documents', "Pick someone who's in them, or who they're about. You can tag more people on the next screen.", id => openUpload(id));
  photosEl.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { PG.kind = b.dataset.kind; renderPhotosPage(); });
  const w = $('#pgWho'); if (w) w.onclick = () => pickPerson('Photos of one person', 'Pick someone to see only the photos and documents they\'re in.', id => { PG.who = id; closePanel(); renderPhotosPage(true); }, p => (PHOTOS.get(p.id) || []).length > 0);
  const wx = $('#pgWhoX'); if (wx) wx.onclick = () => { PG.who = null; renderPhotosPage(true); };
  const so = $('#pgSort'); if (so) so.onchange = () => { PG.sort = so.value; renderPhotosPage(true); };
  photosEl.querySelectorAll('[data-pgi]').forEach(b => b.onclick = () => openViewerList(pgList, +b.dataset.pgi));
  photosEl.querySelectorAll('[data-pge]').forEach(b => b.onclick = () => { openViewerList(pgList, +b.dataset.pge); if (VW) openPhotoEdit(VW.list[VW.i]); });
  photosEl.querySelectorAll('[data-goto-person]').forEach(b => b.onclick = () => openPerson(b.dataset.gotoPerson));
  fillPendingThumbs(photosEl);
}
addEventListener('resize', () => { if (STATE.view === 'photos') photosEl.style.paddingTop = (photosTop() + 12) + 'px'; });
