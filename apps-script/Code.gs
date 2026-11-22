/**
 * Roots API
 *
 * Google Apps Script web app bound to the "Roots data" Sheet.
 * Source of truth: github.com/lumen-drogulus/roots, apps-script/Code.gs.
 * Edit it there, then paste it over this file and publish a new version
 * of the EXISTING deployment (Deploy > Manage deployments > edit > New version).
 * Never create a second deployment: a new URL breaks the app.
 *
 * Privacy is enforced here and only here. The public tree is built from a
 * stripped copy of the data; private fields never leave this script for
 * anyone except the admin key holder.
 */

var CONFIG = {
  PHOTOS_FOLDER_ID: '1CkCkSCl6rgVi7M0miFgr2aw1RGqiWDus',
  ADMIN_PAGE_URL: 'https://lumen-drogulus.github.io/roots/admin.html',
  LIVING_CUTOFF_YEARS: 110,        // born more than this many years ago => treated as deceased
  MAX_ITEMS_PER_SUBMIT: 60,
  MAX_ITEMS_PER_DAY: 300,          // per contributor, rolling 24h
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  MAX_TEXT: 300,
  MAX_NOTES: 5000,
  REJECTED_LOOKBACK_DAYS: 30
};

var SCHEMA = {
  People: ['id', 'status', 'first_name', 'middle_name', 'birth_surname', 'married_names', 'nicknames', 'sex', 'living',
    'birth_date', 'birth_place', 'death_date', 'death_place', 'notes', 'is_placeholder', 'merged_into', 'merge_log',
    'source', 'submitted_by', 'submitted_at', 'batch_id', 'reviewed_at'],
  Relationships: ['id', 'status', 'type', 'person_a', 'person_b', 'subtype', 'start_date', 'end_date',
    'source', 'submitted_by', 'submitted_at', 'batch_id', 'reviewed_at'],
  Suggestions: ['id', 'status', 'target_id', 'field', 'proposed_value', 'previous_value',
    'source', 'submitted_by', 'submitted_at', 'batch_id', 'reviewed_at'],
  Photos: ['id', 'status', 'drive_file_id', 'caption', 'date_taken', 'place',
    'source', 'submitted_by', 'submitted_at', 'batch_id', 'reviewed_at'],
  PhotoTags: ['id', 'status', 'photo_id', 'person_id', 'source', 'submitted_by', 'submitted_at', 'batch_id', 'reviewed_at'],
  Contributors: ['id', 'status', 'token', 'person_id', 'display_name', 'first_seen', 'last_seen', 'reviewed_at']
};

var ID_PREFIX = { People: 'P', Relationships: 'R', Suggestions: 'S', Photos: 'F', PhotoTags: 'T', Contributors: 'C' };
var KIND_TABLE = { person: 'People', relationship: 'Relationships', suggestion: 'Suggestions', photo: 'Photos', tag: 'PhotoTags', claim: 'Contributors' };

var SEX_VALUES = ['', 'female', 'male', 'other'];
var LIVING_VALUES = ['living', 'deceased', 'unknown'];
var PC_SUBTYPES = ['biological', 'adopted', 'step', 'foster', 'unknown'];
var PARTNER_SUBTYPES = ['married', 'partner', 'divorced', 'former', 'widowed', 'unknown'];  // former: together once, never married, not now

// Fields a contributor may set on a person, and how each is validated.
var PERSON_FIELDS = {
  first_name: 'text', middle_name: 'text', birth_surname: 'text', married_names: 'list', nicknames: 'text',
  sex: 'sex', living: 'living', birth_date: 'date', birth_place: 'text', death_date: 'date', death_place: 'text',
  notes: 'notes', is_placeholder: 'bool'
};
var RELATIONSHIP_FIELDS = { subtype: 'subtype', start_date: 'date', end_date: 'date' };
var PHOTO_FIELDS = { caption: 'notes', date_taken: 'date', place: 'text' };

/* =========================================================================
 * Entry points
 * ========================================================================= */

function doGet(e) {
  var p = (e && e.parameter) || {};
  return respond_(function () {
    var action = p.action || 'tree';
    if (action === 'tree') return publicTree_(loadDb_(), p.token || '');
    if (action === 'ping') return { ok: true };
    throw userError_('Unknown action.');
  });
}

function doPost(e) {
  return respond_(function () {
    var body;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (err) { throw userError_('Could not read the request.'); }
    var action = body.action || '';

    if (action === 'tree') return publicTree_(loadDb_(), body.token || '');

    var isAdmin = !!body.key && checkAdminKey_(body.key);
    if (action.indexOf('admin_') === 0 && !isAdmin) throw userError_('Admin key not accepted.');

    return withLock_(function () {
      var db = loadDb_();
      var result;
      switch (action) {
        case 'submit': result = submit_(db, body, isAdmin); break;
        case 'upload_photo': result = uploadPhoto_(db, body, isAdmin); break;
        case 'admin_tree': result = adminTree_(db); break;
        case 'admin_queue': result = adminQueue_(db); break;
        case 'admin_approve': result = adminDecide_(db, body.items || [], 'approved'); break;
        case 'admin_reject': result = adminDecide_(db, body.items || [], 'rejected'); break;
        case 'admin_retract': result = adminRetract_(db, body.items || []); break;
        case 'admin_edit': result = adminEdit_(db, body); break;
        case 'admin_merge': result = adminMerge_(db, body.keep, body.drop, body.fill_blanks !== false); break;
        case 'admin_unmerge': result = adminUnmerge_(db, body.id); break;
        case 'admin_photo': result = adminPhoto_(db, body.id); break;
        case 'admin_pause': result = adminPause_(!!body.paused); break;
        case 'admin_set_owner': result = adminSetOwner_(db, body.person_id); break;
        default: throw userError_('Unknown action.');
      }
      db.flush();
      return result;
    });
  });
}

function respond_(fn) {
  var out;
  try {
    out = fn();
    if (out && out.ok === undefined) out.ok = true;
  } catch (err) {
    if (err && err.userFacing) out = { ok: false, error: err.message };
    else {
      console.error(err && err.stack ? err.stack : err);
      out = { ok: false, error: 'Something went wrong on the server. Try again in a minute.' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(msg) { var e = new Error(msg); e.userFacing = true; return e; }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw userError_('The tree is busy. Try again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* =========================================================================
 * One-time setup and maintenance (run from the Apps Script editor)
 * ========================================================================= */

/** Run once after pasting the code. Creates the admin key, the email trigger, and checks the tabs. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', randomToken_(32));

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Missing tab: ' + name);
    var header = sh.getRange(1, 1, 1, SCHEMA[name].length).getValues()[0].map(String);
    SCHEMA[name].forEach(function (col, i) {
      if (header[i] !== col) throw new Error('Tab ' + name + ', column ' + (i + 1) + ' should be "' + col + '", found "' + header[i] + '"');
    });
  });

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'notifyDigest'; });
  if (!hasTrigger) ScriptApp.newTrigger('notifyDigest').timeBased().everyMinutes(10).create();

  DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID).getName();   // forces the Drive permission prompt
  MailApp.getRemainingDailyQuota();                              // forces the email permission prompt

  console.log('Setup complete. Your admin key is: ' + props.getProperty('ADMIN_KEY'));
}

/** Prints the admin key again. */
function showAdminKey() {
  console.log('Admin key: ' + PropertiesService.getScriptProperties().getProperty('ADMIN_KEY'));
}

/** Replaces the admin key. Use if it ever leaks; the old one stops working immediately. */
function rotateAdminKey() {
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', randomToken_(32));
  showAdminKey();
}

/** Runs every 10 minutes. Sends one email when new submissions have arrived since the last one. */
function notifyDigest() {
  try { dailyBackup_(); } catch (err) { console.error('backup failed: ' + err); }
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('NOTIFY_PENDING') !== '1') return;
  props.deleteProperty('NOTIFY_PENDING');
  var db = loadDb_();
  var counts = {};
  var total = 0;
  Object.keys(KIND_TABLE).forEach(function (kind) {
    var n = db[KIND_TABLE[kind]].rows.filter(function (r) { return r.status === 'pending'; }).length;
    if (n) { counts[kind] = n; total += n; }
  });
  if (!total) return;
  var lines = Object.keys(counts).map(function (k) { return '  ' + counts[k] + ' ' + k + (counts[k] === 1 ? '' : 's'); });
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
    'Roots: ' + total + ' waiting for approval',
    'Waiting for you:\n\n' + lines.join('\n') + '\n\nReview: ' + CONFIG.ADMIN_PAGE_URL + '\n');
}

/**
 * Once a day (piggybacking on the 10-minute digest trigger, so nothing new to install): copy every tab into a new
 * spreadsheet "Roots data backup YYYY-MM-DD" in a "Roots backups" folder beside the Sheet. Values and formatting
 * only; a copy of the whole file would also copy this script. Keeps the newest 30.
 */
function dailyBackup_() {
  var props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty('LAST_BACKUP') || 0) < 23 * 3600 * 1000) return;
  props.setProperty('LAST_BACKUP', String(Date.now()));
  var src = SpreadsheetApp.getActiveSpreadsheet();
  var file = DriveApp.getFileById(src.getId());
  var parents = file.getParents();
  var home = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var found = home.getFoldersByName('Roots backups');
  var folder = found.hasNext() ? found.next() : home.createFolder('Roots backups');
  var copy = SpreadsheetApp.create('Roots data backup ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  src.getSheets().forEach(function (sh) { sh.copyTo(copy).setName(sh.getName()); });
  copy.deleteSheet(copy.getSheets()[0]);   // the blank sheet a new spreadsheet starts with
  DriveApp.getFileById(copy.getId()).moveTo(folder);
  var all = [];
  var it = folder.getFiles();
  while (it.hasNext()) all.push(it.next());
  all.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  all.slice(30).forEach(function (f) { f.setTrashed(true); });
}

/* =========================================================================
 * Data layer: one read per tab per request, writes batched in flush()
 * ========================================================================= */

function loadDb_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var db = { _tables: [] };
  Object.keys(SCHEMA).forEach(function (name) {
    var t = new Table_(ss.getSheetByName(name), name);
    db[name] = t;
    db._tables.push(t);
  });
  db.flush = function () { db._tables.forEach(function (t) { t.flush(); }); };
  return db;
}

function Table_(sheet, name) {
  this.sheet = sheet;
  this.name = name;
  this.cols = SCHEMA[name];
  var values = sheet.getDataRange().getValues();
  var header = (values[0] || []).map(String);
  var idx = {};
  this.cols.forEach(function (c) {
    var i = header.indexOf(c);
    if (i < 0) throw new Error('Tab ' + name + ' is missing column ' + c);
    idx[c] = i;
  });
  this.idx = idx;
  this.width = Math.max(header.length, this.cols.length);
  this.rows = [];
  this.byId = {};
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    if (raw.every(function (v) { return v === '' || v === null; })) continue;
    var obj = { _row: r + 1 };
    for (var c = 0; c < this.cols.length; c++) obj[this.cols[c]] = readCell_(raw[idx[this.cols[c]]]);
    this.rows.push(obj);
    if (obj.id) this.byId[obj.id] = obj;
  }
  this.lastRow = values.length;
  this._dirty = [];
  this._new = [];
}

Table_.prototype.get = function (id) { return this.byId[id] || null; };

Table_.prototype.insert = function (obj) {
  var row = {};
  this.cols.forEach(function (c) { row[c] = obj[c] === undefined || obj[c] === null ? '' : String(obj[c]); });
  if (!row.id) row.id = newId_(this);
  row._row = this.lastRow + 1 + this._new.length;
  this.rows.push(row);
  this.byId[row.id] = row;
  this._new.push(row);
  return row;
};

Table_.prototype.set = function (row, field, value) {
  if (this.cols.indexOf(field) < 0) throw new Error('No column ' + field + ' in ' + this.name);
  row[field] = value === undefined || value === null ? '' : String(value);
  if (this._new.indexOf(row) < 0 && this._dirty.indexOf(row) < 0) this._dirty.push(row);
};

Table_.prototype.toArray_ = function (row) {
  var arr = [];
  for (var i = 0; i < this.width; i++) arr.push('');
  var self = this;
  this.cols.forEach(function (c) { arr[self.idx[c]] = writeCell_(row[c]); });
  return arr;
};

Table_.prototype.flush = function () {
  var self = this;
  this._dirty.forEach(function (row) {
    self.sheet.getRange(row._row, 1, 1, self.width).setValues([self.toArray_(row)]);
  });
  if (this._new.length) {
    var start = this.lastRow + 1;
    var needed = start + this._new.length - 1 - this.sheet.getMaxRows();
    if (needed > 0) this.sheet.insertRowsAfter(this.sheet.getMaxRows(), needed + 200);
    this.sheet.getRange(start, 1, this._new.length, this.width).setNumberFormat('@')
      .setValues(this._new.map(function (r) { return self.toArray_(r); }));
    this.lastRow += this._new.length;
  }
  this._dirty = [];
  this._new = [];
};

function readCell_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : v.toISOString();
  var s = String(v);
  // Undo writeCell_'s escape if this cell kept it literally (plain-text cells can).
  return /^'[=+\-@']/.test(s) ? s.slice(1) : s;
}

/**
 * Anything a relative types could start with "=" and become a live formula in the owner's
 * Sheet (IMPORTXML and friends can send data out). A leading apostrophe forces plain text.
 * readCell_ removes it again if the Sheet stored it literally.
 */
function writeCell_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@']/.test(s) ? "'" + s : s;
}

function newId_(table) {
  var id;
  do { id = ID_PREFIX[table.name] + '-' + randomToken_(8).toLowerCase(); } while (table.byId[id]);
  return id;
}

function randomToken_(len) {
  var s = '';
  while (s.length < len) s += Utilities.getUuid().replace(/-/g, '');
  // uuid hex is fine for ids; mix case for the admin key's extra entropy
  return s.slice(0, len).split('').map(function (ch, i) { return i % 2 && /[a-f]/.test(ch) ? ch.toUpperCase() : ch; }).join('');
}

function nowIso_() { return new Date().toISOString(); }

/* =========================================================================
 * Privacy rules
 * ========================================================================= */

/** Living unless marked deceased, has a death date, or was born more than 110 years ago. Explicit "living" always wins. */
function isLiving_(p) {
  if (p.living === 'deceased') return false;
  if (p.living === 'living') return true;
  if (p.death_date) return false;
  var d = parseFuzzy_(p.birth_date);
  if (d && d.year && d.qualifier !== 'after') {
    if (d.year <= new Date().getFullYear() - CONFIG.LIVING_CUTOFF_YEARS) return false;
  }
  return true;
}

function marriedList_(p) {
  if (!p.married_names) return [];
  try { var a = JSON.parse(p.married_names); return Array.isArray(a) ? a.filter(String) : []; }
  catch (e) { return [p.married_names]; }
}

function currentSurname_(p) {
  var m = marriedList_(p);
  return m.length ? m[m.length - 1] : p.birth_surname;
}

function contributorName_(db, contributorId) {
  var c = db.Contributors.get(contributorId);
  if (!c || c.status !== 'approved' || !c.person_id) return null;
  var p = resolvePerson_(db, c.person_id);
  if (!p || p.status !== 'approved') return null;
  return [p.first_name, currentSurname_(p)].filter(String).join(' ') || null;
}

function publicPerson_(db, p) {
  var living = isLiving_(p);
  var base = {
    id: p.id,
    living: living,
    first_name: p.first_name,
    middle_name: p.middle_name,   // public for everyone (Jonny, 2026-11-20): tells apart relatives with the same name
    nicknames: p.nicknames,       // "Goes by", same reason
    last_name: currentSurname_(p),
    is_placeholder: isTrue_(p.is_placeholder),
    added_by: contributorName_(db, p.submitted_by)
  };
  if (living) return base;
  base.birth_surname = p.birth_surname;
  base.married_names = marriedList_(p);
  base.sex = p.sex;
  base.birth_date = p.birth_date;
  base.birth_place = p.birth_place;
  base.death_date = p.death_date;
  base.death_place = p.death_place;
  base.notes = p.notes;
  base.source = p.source;
  return base;
}

function publicRelationship_(db, r, livingById) {
  var anyLiving = livingById[r.person_a] || livingById[r.person_b];
  var out = { id: r.id, type: r.type, a: r.person_a, b: r.person_b, subtype: r.subtype, added_by: contributorName_(db, r.submitted_by) };
  if (anyLiving) {
    // Adoption and foster status of a living person is theirs to share. Step links stay: the layout needs them
    // and they follow from a public partnership anyway. Partnership dates are hidden.
    if (r.type === 'parent_child' && r.subtype !== 'step') out.subtype = 'parent';
    return out;
  }
  out.start_date = r.start_date;
  out.end_date = r.end_date;
  out.source = r.source;
  return out;
}

/* =========================================================================
 * Public tree
 * ========================================================================= */

function publicTree_(db, token) {
  var props = PropertiesService.getScriptProperties();
  var people = [];
  var livingById = {};
  var visible = {};
  db.People.rows.forEach(function (p) {
    if (p.status !== 'approved') return;
    visible[p.id] = true;
    livingById[p.id] = isLiving_(p);
    people.push(publicPerson_(db, p));
  });

  var relationships = db.Relationships.rows
    .filter(function (r) { return r.status === 'approved' && visible[r.person_a] && visible[r.person_b]; })
    .map(function (r) { return publicRelationship_(db, r, livingById); });

  var tagsByPhoto = {};
  db.PhotoTags.rows.forEach(function (t) {
    if (t.status !== 'approved' || !visible[t.person_id]) return;
    (tagsByPhoto[t.photo_id] = tagsByPhoto[t.photo_id] || []).push(t.person_id);
  });
  var photos = db.Photos.rows
    .filter(function (f) { return f.status === 'approved' && f.drive_file_id; })
    .map(function (f) {
      return { id: f.id, file_id: f.drive_file_id, caption: f.caption, date_taken: f.date_taken, place: f.place,
        source: f.source, added_by: contributorName_(db, f.submitted_by), tags: tagsByPhoto[f.id] || [] };
    });

  // Accepted corrections, shown only on deceased people. Both values and who said each stay on record.
  var history = [];
  db.Suggestions.rows.forEach(function (s) {
    if (s.status !== 'approved') return;
    var p = db.People.get(s.target_id);
    if (!p || !visible[p.id] || livingById[p.id]) return;
    history.push({ id: s.id, target_id: s.target_id, field: s.field, value: parseJsonValue_(s.proposed_value),
      previous_value: parseJsonValue_(s.previous_value), source: s.source, added_by: contributorName_(db, s.submitted_by),
      date: s.reviewed_at });
  });

  var out = {
    people: people,
    relationships: relationships,
    photos: photos,
    history: history,
    meta: {
      generated_at: nowIso_(),
      owner_person_id: props.getProperty('OWNER_PERSON_ID') || '',
      paused: props.getProperty('PAUSED') === '1'
    }
  };
  var me = findContributorByToken_(db, token);
  if (me) out.own = ownView_(db, me);
  return out;
}

/** What a contributor sees of their own submissions: everything they wrote, still pending, marked unconfirmed by the page. */
function ownView_(db, me) {
  var mine = function (r) { return r.submitted_by === me.id; };
  var pending = function (r) { return r.status === 'pending' && mine(r); };
  var cutoff = Date.now() - CONFIG.REJECTED_LOOKBACK_DAYS * 864e5;
  var rejected = [];
  ['People', 'Relationships', 'Suggestions', 'Photos', 'PhotoTags'].forEach(function (name) {
    db[name].rows.forEach(function (r) {
      if (r.status === 'rejected' && mine(r) && Date.parse(r.reviewed_at || 0) > cutoff) {
        rejected.push({ table: name, id: r.id, label: name === 'People' ? [r.first_name, r.birth_surname].filter(String).join(' ') : '' });
      }
    });
  });
  return {
    contributor_id: me.id,
    person_id: me.person_id,
    claim_status: me.person_id ? me.status : '',
    people: db.People.rows.filter(pending).map(function (p) {
      return { id: p.id, first_name: p.first_name, middle_name: p.middle_name, birth_surname: p.birth_surname,
        married_names: marriedList_(p), nicknames: p.nicknames, sex: p.sex, living: p.living, birth_date: p.birth_date,
        birth_place: p.birth_place, death_date: p.death_date, death_place: p.death_place, notes: p.notes,
        is_placeholder: isTrue_(p.is_placeholder), source: p.source, submitted_at: p.submitted_at };
    }),
    relationships: db.Relationships.rows.filter(pending).map(function (r) {
      return { id: r.id, type: r.type, a: r.person_a, b: r.person_b, subtype: r.subtype, start_date: r.start_date,
        end_date: r.end_date, source: r.source };
    }),
    suggestions: db.Suggestions.rows.filter(pending).map(function (s) {
      return { id: s.id, target_id: s.target_id, field: s.field, value: parseJsonValue_(s.proposed_value), source: s.source };
    }),
    photos: db.Photos.rows.filter(pending).map(function (f) {
      return { id: f.id, caption: f.caption, date_taken: f.date_taken, place: f.place, thumbnail: thumbnailDataUrl_(f.drive_file_id) };
    }),
    tags: db.PhotoTags.rows.filter(pending).map(function (t) { return { id: t.id, photo_id: t.photo_id, person_id: t.person_id }; }),
    rejected: rejected
  };
}

function thumbnailDataUrl_(fileId) {
  if (!fileId) return '';
  try {
    var blob = DriveApp.getFileById(fileId).getThumbnail();
    return blob ? 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) : '';
  } catch (e) { return ''; }
}

/* =========================================================================
 * Contributors
 * ========================================================================= */

function validToken_(token) { return typeof token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(token); }

function findContributorByToken_(db, token) {
  if (!validToken_(token)) return null;
  for (var i = 0; i < db.Contributors.rows.length; i++) {
    if (db.Contributors.rows[i].token === token) return db.Contributors.rows[i];
  }
  return null;
}

function getOrCreateContributor_(db, token, displayName) {
  if (!validToken_(token)) throw userError_('This device has no valid contributor id. Reload the page and try again.');
  var c = findContributorByToken_(db, token);
  var now = nowIso_();
  if (!c) {
    c = db.Contributors.insert({ status: '', token: token, display_name: cleanText_(displayName, CONFIG.MAX_TEXT), first_seen: now, last_seen: now });
  } else {
    db.Contributors.set(c, 'last_seen', now);
    if (displayName && !c.display_name) db.Contributors.set(c, 'display_name', cleanText_(displayName, CONFIG.MAX_TEXT));
  }
  return c;
}

function itemsInLastDay_(db, contributorId) {
  var cutoff = Date.now() - 864e5;
  var n = 0;
  ['People', 'Relationships', 'Suggestions', 'Photos', 'PhotoTags'].forEach(function (name) {
    db[name].rows.forEach(function (r) { if (r.submitted_by === contributorId && Date.parse(r.submitted_at) > cutoff) n++; });
  });
  return n;
}

/* =========================================================================
 * Submissions
 * ========================================================================= */

/**
 * body: { token, display_name?, items: [...] }
 * Items (refs starting with "new:" point at people created earlier in the same batch):
 *   { kind:'person', ref:'new:1', data:{ first_name, ... } }
 *   { kind:'relationship', type:'parent_child'|'partner', a, b, subtype?, start_date?, end_date?, source? }   (parent_child: a is the parent)
 *   { kind:'suggestion', target_id, field, value, source? }
 *   { kind:'tag', photo_id, person_id }
 *   { kind:'claim', person }           "this person is me"
 */
function submit_(db, body, isAdmin) {
  var props = PropertiesService.getScriptProperties();
  if (!isAdmin && props.getProperty('PAUSED') === '1') throw userError_('Adding is paused for the moment. Try again later.');
  var items = body.items;
  if (!Array.isArray(items) || !items.length) throw userError_('Nothing to add.');
  if (items.length > CONFIG.MAX_ITEMS_PER_SUBMIT) throw userError_('Too much at once. Add it in smaller pieces.');

  var me = getOrCreateContributor_(db, body.token, body.display_name);
  if (!isAdmin && itemsInLastDay_(db, me.id) + items.length > CONFIG.MAX_ITEMS_PER_DAY) {
    throw userError_('That is a lot for one day. Try again tomorrow.');
  }

  var ctx = { db: db, me: me, isAdmin: isAdmin, now: nowIso_(), batch: 'B-' + randomToken_(8).toLowerCase(), refs: {} };
  var status = isAdmin ? 'approved' : 'pending';

  // Validate everything before writing anything, so a bad item can't leave half a submission behind.
  var plan = items.map(function (item, i) { return validateItem_(ctx, item, i); });

  var created = {};
  var skipped = [];
  plan.forEach(function (step) {
    if (step.skip) { skipped.push(step.skip); return; }
    var row = step.write(status);
    if (step.ref) created[step.ref] = row.id;
  });

  if (!isAdmin) props.setProperty('NOTIFY_PENDING', '1');
  return { batch_id: ctx.batch, ids: created, skipped: skipped, status: status };
}

function stamp_(ctx, extra) {
  var o = { submitted_by: ctx.me.id, submitted_at: ctx.now, batch_id: ctx.batch };
  if (ctx.isAdmin) o.reviewed_at = ctx.now;
  for (var k in extra) o[k] = extra[k];
  return o;
}

function validateItem_(ctx, item, i) {
  var where = 'Item ' + (i + 1) + ': ';
  if (!item || typeof item !== 'object') throw userError_(where + 'not understood.');
  var db = ctx.db;

  if (item.kind === 'person') {
    var data = cleanFields_(item.data || {}, PERSON_FIELDS, where);
    var hasName = ['first_name', 'birth_surname', 'nicknames'].some(function (f) { return data[f]; }) ||
      (data.married_names && data.married_names !== '[]') || data.is_placeholder === 'true';
    if (!hasName) throw userError_(where + 'a name is needed. "Unknown" is fine.');
    if (!data.living) data.living = 'unknown';
    var source = cleanText_(item.source || (item.data && item.data.source), CONFIG.MAX_TEXT);
    var ref = item.ref;
    if (ref !== undefined && (typeof ref !== 'string' || ref.indexOf('new:') !== 0 || ctx.refs[ref])) {
      throw userError_(where + 'bad reference.');
    }
    if (ref) ctx.refs[ref] = 'pending';
    return {
      ref: ref,
      write: function (status) {
        var row = db.People.insert(stamp_(ctx, Object.assign({ status: status, source: source }, data)));
        if (ref) ctx.refs[ref] = row.id;
        return row;
      }
    };
  }

  if (item.kind === 'relationship') {
    var type = item.type;
    if (type !== 'parent_child' && type !== 'partner') throw userError_(where + 'unknown relationship type.');
    var a = checkPersonRef_(ctx, item.a, where);
    var b = checkPersonRef_(ctx, item.b, where);
    if (a === b) throw userError_(where + 'a person cannot be related to themselves.');
    var rf = cleanFields_({ subtype: item.subtype, start_date: item.start_date, end_date: item.end_date }, RELATIONSHIP_FIELDS, where);
    var allowed = type === 'parent_child' ? PC_SUBTYPES : PARTNER_SUBTYPES;
    if (rf.subtype && allowed.indexOf(rf.subtype) < 0) throw userError_(where + 'unknown kind of ' + (type === 'partner' ? 'partnership.' : 'parent link.'));
    if (!rf.subtype) rf.subtype = type === 'parent_child' ? 'biological' : 'unknown';
    if (!isRef_(a) && !isRef_(b)) {
      if (findRelationship_(db, type, a, b, ctx.me.id)) return { skip: { index: i, reason: 'already in the tree' } };
      if (type === 'parent_child' && isAncestor_(db, b, a, ctx.me.id)) throw userError_(where + 'that would make someone their own ancestor.');
    }
    var rsource = cleanText_(item.source, CONFIG.MAX_TEXT);
    return {
      write: function (status) {
        return db.Relationships.insert(stamp_(ctx, Object.assign({ status: status, type: type, person_a: resolveRef_(ctx, a),
          person_b: resolveRef_(ctx, b), source: rsource }, rf)));
      }
    };
  }

  if (item.kind === 'suggestion') {
    var target = db.People.get(item.target_id) || db.Relationships.get(item.target_id);
    if (target && target.status === 'merged') target = resolvePerson_(db, target.id);
    if (!target || target.status !== 'approved') throw userError_(where + 'can only suggest changes to someone already in the tree.');
    var fields = db.People.get(target.id) ? PERSON_FIELDS : RELATIONSHIP_FIELDS;
    // "This link is wrong": a correction that, once confirmed, takes the link off the tree. Both people stay.
    if (item.field === 'remove') {
      if (fields !== RELATIONSHIP_FIELDS) throw userError_(where + 'only a link can be removed this way.');
      var rmsource = cleanText_(item.source, CONFIG.MAX_TEXT);
      return {
        write: function (status) {
          var row = db.Suggestions.insert(stamp_(ctx, { status: 'pending', target_id: target.id, field: 'remove',
            proposed_value: JSON.stringify('removed'), source: rmsource }));
          if (status === 'approved') applySuggestion_(db, row, ctx.now);
          return row;
        }
      };
    }
    if (!fields[item.field]) throw userError_(where + 'that detail cannot be changed.');
    var one = {};
    one[item.field] = item.value;
    var cleaned = cleanFields_(one, fields, where);
    var value = cleaned[item.field] === undefined ? '' : cleaned[item.field];
    if (item.field === 'subtype') {
      var okSub = target.type === 'partner' ? PARTNER_SUBTYPES : PC_SUBTYPES;
      if (okSub.indexOf(value) < 0) throw userError_(where + 'unknown kind of link.');
    }
    var ssource = cleanText_(item.source, CONFIG.MAX_TEXT);
    return {
      write: function (status) {
        var row = db.Suggestions.insert(stamp_(ctx, { status: 'pending', target_id: target.id, field: item.field,
          proposed_value: JSON.stringify(value), source: ssource }));
        if (status === 'approved') applySuggestion_(db, row, ctx.now);
        return row;
      }
    };
  }

  if (item.kind === 'tag') {
    var photo = db.Photos.get(item.photo_id);
    if (!photo || !(photo.status === 'approved' || (photo.status === 'pending' && photo.submitted_by === ctx.me.id) || ctx.isAdmin)) {
      throw userError_(where + 'photo not found.');
    }
    var pid = checkPersonRef_(ctx, item.person_id, where);
    if (!isRef_(pid) && db.PhotoTags.rows.some(function (t) {
      return t.photo_id === photo.id && t.person_id === pid && (t.status === 'approved' || t.status === 'pending');
    })) return { skip: { index: i, reason: 'already tagged' } };
    return {
      write: function (status) {
        return db.PhotoTags.insert(stamp_(ctx, { status: status, photo_id: photo.id, person_id: resolveRef_(ctx, pid) }));
      }
    };
  }

  if (item.kind === 'claim') {
    var who = checkPersonRef_(ctx, item.person, where);
    return {
      write: function (status) {
        var me = ctx.me;
        db.Contributors.set(me, 'person_id', resolveRef_(ctx, who));
        db.Contributors.set(me, 'status', status);
        if (status === 'approved') {
          db.Contributors.set(me, 'reviewed_at', ctx.now);
          if (ctx.isAdmin) PropertiesService.getScriptProperties().setProperty('OWNER_PERSON_ID', me.person_id);
        }
        return me;
      }
    };
  }

  throw userError_(where + 'unknown kind of entry.');
}

function isRef_(x) { return typeof x === 'string' && x.indexOf('new:') === 0; }
function resolveRef_(ctx, x) { return isRef_(x) ? ctx.refs[x] : x; }

/** A person id is usable if approved, or pending and submitted by this contributor (or anything, for the admin). */
function checkPersonRef_(ctx, x, where) {
  if (isRef_(x)) {
    if (!ctx.refs[x]) throw userError_(where + 'refers to a new person that is not in this submission.');
    return x;
  }
  var p = resolvePerson_(ctx.db, x);
  if (!p) throw userError_(where + 'person not found.');
  if (p.status === 'approved') return p.id;
  if (p.status === 'pending' && (p.submitted_by === ctx.me.id || ctx.isAdmin)) return p.id;
  throw userError_(where + 'person not found.');
}

/** Follows merges to the surviving person. */
function resolvePerson_(db, id) {
  var p = db.People.get(id);
  var hops = 0;
  while (p && p.status === 'merged' && p.merged_into && hops++ < 20) p = db.People.get(p.merged_into);
  return p;
}

function findRelationship_(db, type, a, b, contributorId) {
  return db.Relationships.rows.some(function (r) {
    if (r.type !== type) return false;
    if (!(r.status === 'approved' || (r.status === 'pending' && r.submitted_by === contributorId))) return false;
    if (r.person_a === a && r.person_b === b) return true;
    return type === 'partner' && r.person_a === b && r.person_b === a;
  });
}

/** True if `anc` is already an ancestor of `person` (so making `person` a parent of `anc` would loop). */
function isAncestor_(db, anc, person, contributorId) {
  var parents = {};
  db.Relationships.rows.forEach(function (r) {
    if (r.type !== 'parent_child') return;
    if (!(r.status === 'approved' || (r.status === 'pending' && r.submitted_by === contributorId))) return;
    (parents[r.person_b] = parents[r.person_b] || []).push(r.person_a);
  });
  var seen = {};
  var stack = [person];
  while (stack.length) {
    var cur = stack.pop();
    if (cur === anc) return true;
    if (seen[cur]) continue;
    seen[cur] = true;
    (parents[cur] || []).forEach(function (p) { stack.push(p); });
  }
  return false;
}

/* =========================================================================
 * Field validation
 * ========================================================================= */

function cleanText_(v, max) {
  if (v === undefined || v === null) return '';
  var s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function isTrue_(v) { return v === true || String(v).toLowerCase() === 'true'; }

/** Fuzzy date, stored as "qualifier:YYYY[-MM[-DD]]", e.g. "about:1932", "exact:1932-05-14". Empty means unknown. */
var FUZZY_RE = /^(exact|about|before|after):(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function parseFuzzy_(s) {
  var m = FUZZY_RE.exec(s || '');
  if (!m) return null;
  return { qualifier: m[1], year: +m[2], month: m[3] ? +m[3] : null, day: m[4] ? +m[4] : null };
}

function cleanDate_(v, where, field) {
  if (v === undefined || v === null || v === '') return '';
  var s = v;
  if (typeof v === 'object') {
    if (!v.year) return '';
    s = (v.qualifier || 'exact') + ':' + String(v.year) + (v.month ? '-' + ('0' + v.month).slice(-2) + (v.day ? '-' + ('0' + v.day).slice(-2) : '') : '');
  }
  var d = parseFuzzy_(String(s));
  if (!d || d.year < 1 || d.year > new Date().getFullYear() + 1 || (d.month && (d.month < 1 || d.month > 12)) || (d.day && (d.day < 1 || d.day > 31))) {
    throw userError_(where + field.replace(/_/g, ' ') + ' is not a date I can read.');
  }
  return String(s);
}

function cleanFields_(input, spec, where) {
  var out = {};
  Object.keys(spec).forEach(function (f) {
    if (!(f in input)) return;
    var v = input[f];
    switch (spec[f]) {
      case 'text': out[f] = cleanText_(v, CONFIG.MAX_TEXT); break;
      case 'notes': out[f] = cleanText_(v, CONFIG.MAX_NOTES); break;
      case 'list':
        var arr = Array.isArray(v) ? v : (v ? [v] : []);
        out[f] = JSON.stringify(arr.map(function (x) { return cleanText_(x, CONFIG.MAX_TEXT); }).filter(String).slice(0, 10));
        break;
      case 'bool': out[f] = isTrue_(v) ? 'true' : ''; break;
      case 'date': out[f] = cleanDate_(v, where, f); break;
      case 'sex':
        out[f] = cleanText_(v, 20).toLowerCase();
        if (SEX_VALUES.indexOf(out[f]) < 0) throw userError_(where + 'sex not understood.');
        break;
      case 'living':
        out[f] = cleanText_(v, 20).toLowerCase() || 'unknown';
        if (LIVING_VALUES.indexOf(out[f]) < 0) throw userError_(where + 'living status not understood.');
        break;
      case 'subtype': out[f] = cleanText_(v, 20).toLowerCase(); break;
    }
  });
  return out;
}

function parseJsonValue_(s) {
  if (s === '' || s === undefined) return '';
  try { return JSON.parse(s); } catch (e) { return s; }
}

/* =========================================================================
 * Photos
 * ========================================================================= */

/** body: { token, image (base64, no data: prefix), mime, caption, date_taken, place, source, tags:[person ids] } */
function uploadPhoto_(db, body, isAdmin) {
  var props = PropertiesService.getScriptProperties();
  if (!isAdmin && props.getProperty('PAUSED') === '1') throw userError_('Adding is paused for the moment. Try again later.');
  var me = getOrCreateContributor_(db, body.token, body.display_name);
  if (!isAdmin && itemsInLastDay_(db, me.id) >= CONFIG.MAX_ITEMS_PER_DAY) throw userError_('That is a lot for one day. Try again tomorrow.');

  var mime = String(body.mime || '');
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) < 0) throw userError_('Photos need to be JPEG, PNG or WebP.');
  if (typeof body.image !== 'string' || !body.image) throw userError_('No photo received.');
  var bytes;
  try { bytes = Utilities.base64Decode(body.image); } catch (e) { throw userError_('The photo did not arrive intact. Try again.'); }
  if (bytes.length > CONFIG.MAX_PHOTO_BYTES) throw userError_('That photo is too large.');

  var ctx = { db: db, me: me, isAdmin: isAdmin, now: nowIso_(), batch: 'B-' + randomToken_(8).toLowerCase(), refs: {} };
  var fields = cleanFields_({ caption: body.caption, date_taken: body.date_taken, place: body.place }, PHOTO_FIELDS, '');
  var tagIds = (Array.isArray(body.tags) ? body.tags : []).slice(0, 50).map(function (t) { return checkPersonRef_(ctx, t, 'Tag: '); });
  var status = isAdmin ? 'approved' : 'pending';

  var row = db.Photos.insert(stamp_(ctx, Object.assign({ status: status, source: cleanText_(body.source, CONFIG.MAX_TEXT) }, fields)));
  var ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  var file = DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID).createFile(Utilities.newBlob(bytes, mime, row.id + ext));
  db.Photos.set(row, 'drive_file_id', file.getId());
  if (isAdmin) publishPhotoFile_(file.getId());

  var seen = {};
  tagIds.forEach(function (pid) {
    if (seen[pid]) return;
    seen[pid] = true;
    db.PhotoTags.insert(stamp_(ctx, { status: status, photo_id: row.id, person_id: pid }));
  });

  if (!isAdmin) props.setProperty('NOTIFY_PENDING', '1');
  return { id: row.id, batch_id: ctx.batch, status: status };
}

/** Approved photos are readable by anyone holding the file id, which only the public API hands out. */
function publishPhotoFile_(fileId) {
  DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
}

function unpublishPhotoFile_(fileId) {
  try { DriveApp.getFileById(fileId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* already private */ }
}

/* =========================================================================
 * Admin
 * ========================================================================= */

function checkAdminKey_(key) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
  if (!real || typeof key !== 'string' || key.length !== real.length) return false;
  var diff = 0;
  for (var i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

function stripRow_(r) {
  var o = {};
  for (var k in r) if (k !== '_row' && k !== 'token') o[k] = r[k];
  return o;
}

function adminTree_(db) {
  var out = {};
  Object.keys(SCHEMA).forEach(function (name) { out[name] = db[name].rows.map(stripRow_); });
  db.People.rows.forEach(function (p, i) { out.People[i].living_computed = isLiving_(p); });
  out.meta = { owner_person_id: PropertiesService.getScriptProperties().getProperty('OWNER_PERSON_ID') || '',
    paused: PropertiesService.getScriptProperties().getProperty('PAUSED') === '1' };
  return out;
}

// A link in words, for the approval queue: "Kayla Vorhees is the parent of Jonathon Ruzicka".
function relLabel_(db, r) {
  if (!r) return 'a link that no longer exists';
  return r.type === 'partner' ? personLabel_(db, r.person_a) + ' and ' + personLabel_(db, r.person_b) + ' as partners'
    : personLabel_(db, r.person_a) + ' as the parent of ' + personLabel_(db, r.person_b);
}

function personLabel_(db, id) {
  var p = db.People.get(id);
  if (!p) return '(missing ' + id + ')';
  var name = [p.first_name, p.middle_name, p.birth_surname].filter(String).join(' ');
  var m = marriedList_(p);
  if (m.length) name += ' (' + m.join(', ') + ')';
  if (!name) name = isTrue_(p.is_placeholder) ? 'Unknown' : '(no name)';
  return name + (p.status === 'pending' ? ' [pending]' : '');
}

/** Every pending item, grouped by submission, with what the admin needs to judge it. */
function adminQueue_(db) {
  var batches = {};
  var add = function (kind, row, extra) {
    var b = batches[row.batch_id || row.id] = batches[row.batch_id || row.id] || { batch_id: row.batch_id, items: [] };
    var c = db.Contributors.get(row.submitted_by);
    b.submitted_at = b.submitted_at || row.submitted_at;
    b.contributor = c ? { id: c.id, display_name: c.display_name, person_id: c.person_id, claim_status: c.status,
      person_label: c.person_id ? personLabel_(db, c.person_id) : '' } : null;
    b.items.push(Object.assign({ kind: kind, row: stripRow_(row) }, extra || {}));
  };

  db.Contributors.rows.forEach(function (c) {
    if (c.status === 'pending') add('claim', { id: c.id, batch_id: 'claim-' + c.id, submitted_by: c.id, submitted_at: c.last_seen,
      person_id: c.person_id, display_name: c.display_name }, { person_label: personLabel_(db, c.person_id) });
  });
  db.People.rows.forEach(function (p) {
    if (p.status === 'pending') add('person', p, { possible_duplicates: possibleDuplicates_(db, p) });
  });
  db.Relationships.rows.forEach(function (r) {
    if (r.status === 'pending') add('relationship', r, { a_label: personLabel_(db, r.person_a), b_label: personLabel_(db, r.person_b) });
  });
  db.Suggestions.rows.forEach(function (s) {
    if (s.status !== 'pending') return;
    var t = db.People.get(s.target_id) || db.Relationships.get(s.target_id);
    add('suggestion', s, { target_label: db.People.get(s.target_id) ? personLabel_(db, s.target_id) : relLabel_(db, t),
      current_value: t ? parseJsonValue_(JSON.stringify(t[s.field])) : '', proposed: parseJsonValue_(s.proposed_value) });
  });
  db.Photos.rows.forEach(function (f) {
    if (f.status !== 'pending') return;
    var tags = db.PhotoTags.rows.filter(function (t) { return t.photo_id === f.id && t.status !== 'rejected' && t.status !== 'merged'; });
    var living = tags.map(function (t) { return db.People.get(t.person_id); })
      .filter(function (p) { return p && isLiving_(p); })
      .map(function (p) { return { id: p.id, name: personLabel_(db, p.id) }; });
    add('photo', f, { tagged: tags.map(function (t) { return { tag_id: t.id, person_id: t.person_id, name: personLabel_(db, t.person_id) }; }),
      living_tagged: living, thumbnail: thumbnailDataUrl_(f.drive_file_id) });
  });
  db.PhotoTags.rows.forEach(function (t) {
    if (t.status !== 'pending') return;
    var photo = db.Photos.get(t.photo_id);
    if (photo && photo.status === 'pending') return; // shown with its photo
    var p = db.People.get(t.person_id);
    add('tag', t, { person_label: personLabel_(db, t.person_id), living: !!(p && isLiving_(p)) });
  });

  var list = Object.keys(batches).map(function (k) { return batches[k]; });
  list.sort(function (x, y) { return String(x.submitted_at).localeCompare(String(y.submitted_at)); });
  return { batches: list, paused: PropertiesService.getScriptProperties().getProperty('PAUSED') === '1' };
}

/** Approved people with the same first name and a matching surname (birth or married). */
function possibleDuplicates_(db, p) {
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); };
  var first = norm(p.first_name);
  if (!first) return [];
  var surnames = [p.birth_surname].concat(marriedList_(p)).map(norm).filter(String);
  return db.People.rows.filter(function (q) {
    if (q.id === p.id || q.status !== 'approved' || norm(q.first_name) !== first) return false;
    var qs = [q.birth_surname].concat(marriedList_(q)).map(norm).filter(String);
    return !surnames.length || !qs.length || qs.some(function (s) { return surnames.indexOf(s) >= 0; });
  }).slice(0, 5).map(function (q) { return { id: q.id, label: personLabel_(db, q.id), birth_date: q.birth_date }; });
}

var DECIDE_ORDER = { person: 0, claim: 1, relationship: 2, photo: 3, tag: 4, suggestion: 5 };

/**
 * Takes back an approval: the entry goes to "rejected" and drops out of the public tree.
 * A retracted photo's file goes private again. Links and tags to a retracted person vanish
 * from the public view on their own, because the person is no longer visible.
 */
function adminRetract_(db, items) {
  var now = nowIso_();
  var done = [];
  var errors = [];
  items.forEach(function (it) {
    var table = db[KIND_TABLE[it.kind]];
    var row = table && table.get(it.id);
    if (!row || row.status !== 'approved') { errors.push({ kind: it.kind, id: it.id, error: 'not an approved entry' }); return; }
    table.set(row, 'status', 'rejected');
    table.set(row, 'reviewed_at', now);
    if (it.kind === 'photo' && row.drive_file_id) unpublishPhotoFile_(row.drive_file_id);
    done.push({ kind: it.kind, id: it.id });
  });
  return { done: done, errors: errors };
}

/** items: [{ kind, id, data? }]. Processed people-first so a person and their links can be approved together. */
function adminDecide_(db, items, decision) {
  var now = nowIso_();
  var done = [];
  var errors = [];
  var rank = function (k) { return DECIDE_ORDER.hasOwnProperty(k) ? DECIDE_ORDER[k] : 9; };
  items.slice().sort(function (x, y) { return rank(x.kind) - rank(y.kind); }).forEach(function (it) {
    try {
      var table = db[KIND_TABLE[it.kind]];
      if (!table) throw userError_('unknown kind');
      var row = table.get(it.id);
      if (!row) throw userError_('not found');
      if (row.status !== 'pending') throw userError_('already ' + (row.status || 'decided'));
      if (decision === 'approved' && it.data) applyAdminEdit_(db, it.kind, row, it.data);

      if (decision === 'approved') {
        if (it.kind === 'relationship') {
          ['person_a', 'person_b'].forEach(function (f) {
            var p = resolvePerson_(db, row[f]);
            if (!p || p.status !== 'approved') throw userError_('approve ' + personLabel_(db, row[f]) + ' first');
            if (p.id !== row[f]) table.set(row, f, p.id);
          });
        }
        if (it.kind === 'tag') {
          var tp = resolvePerson_(db, row.person_id);
          var ph = db.Photos.get(row.photo_id);
          if (!tp || tp.status !== 'approved') throw userError_('approve ' + personLabel_(db, row.person_id) + ' first');
          if (!ph || ph.status !== 'approved') throw userError_('approve the photo first');
        }
        if (it.kind === 'claim') {
          var cp = resolvePerson_(db, row.person_id);
          if (!cp || cp.status !== 'approved') throw userError_('approve ' + personLabel_(db, row.person_id) + ' first');
        }
        if (it.kind === 'suggestion') {
          table.set(row, 'status', 'approved');
          table.set(row, 'reviewed_at', now);
          applySuggestion_(db, row, now);
          done.push({ kind: it.kind, id: it.id });
          return;
        }
      }

      table.set(row, 'status', decision);
      table.set(row, 'reviewed_at', now);

      if (it.kind === 'photo') {
        if (decision === 'approved') {
          if (row.drive_file_id) publishPhotoFile_(row.drive_file_id);
          // Tags that came with the photo go live with it, if the person they point at is approved.
          db.PhotoTags.rows.forEach(function (t) {
            if (t.photo_id !== row.id || t.status !== 'pending') return;
            var p = resolvePerson_(db, t.person_id);
            if (p && p.status === 'approved') {
              db.PhotoTags.set(t, 'person_id', p.id);
              db.PhotoTags.set(t, 'status', 'approved');
              db.PhotoTags.set(t, 'reviewed_at', now);
            }
          });
        } else {
          db.PhotoTags.rows.forEach(function (t) {
            if (t.photo_id === row.id && t.status === 'pending') { db.PhotoTags.set(t, 'status', 'rejected'); db.PhotoTags.set(t, 'reviewed_at', now); }
          });
        }
      }
      done.push({ kind: it.kind, id: it.id });
    } catch (err) {
      if (!err.userFacing) throw err;
      errors.push({ kind: it.kind, id: it.id, error: err.message });
    }
  });
  return { done: done, errors: errors };
}

/** Copies an approved suggestion onto its target, keeping the old value on the suggestion row. */
function applySuggestion_(db, s, now) {
  var target = db.People.get(s.target_id) ? resolvePerson_(db, s.target_id) : db.Relationships.get(s.target_id);
  var table = db.People.get(s.target_id) ? db.People : db.Relationships;
  if (!target) throw userError_('the person or link it changes no longer exists');
  if (s.field === 'remove') {
    // the link leaves the public tree like a taken-back approval; the suggestion keeps what it was
    db.Suggestions.set(s, 'previous_value', JSON.stringify(target.status));
    db.Suggestions.set(s, 'status', 'approved');
    db.Suggestions.set(s, 'reviewed_at', now);
    if (target.status === 'approved') { table.set(target, 'status', 'rejected'); table.set(target, 'reviewed_at', now); }
    return;
  }
  db.Suggestions.set(s, 'previous_value', JSON.stringify(target[s.field] === undefined ? '' : target[s.field]));
  db.Suggestions.set(s, 'status', 'approved');
  db.Suggestions.set(s, 'reviewed_at', now);
  table.set(target, s.field, parseJsonValue_(s.proposed_value));
}

function applyAdminEdit_(db, kind, row, data) {
  var spec = kind === 'person' ? PERSON_FIELDS : kind === 'relationship' ? RELATIONSHIP_FIELDS : kind === 'photo' ? PHOTO_FIELDS : null;
  if (!spec) throw userError_('this kind of entry cannot be edited');
  var table = db[KIND_TABLE[kind]];
  var cleaned = cleanFields_(data, spec, '');
  Object.keys(cleaned).forEach(function (f) { table.set(row, f, cleaned[f]); });
  if ('source' in data) table.set(row, 'source', cleanText_(data.source, CONFIG.MAX_TEXT));
}

/** body: { kind, id, data }. Edits any entry, pending or approved. */
function adminEdit_(db, body) {
  var table = db[KIND_TABLE[body.kind]];
  var row = table && table.get(body.id);
  if (!row) throw userError_('Not found.');
  applyAdminEdit_(db, body.kind, row, body.data || {});
  return { row: stripRow_(row) };
}

/**
 * Keeps `keep`, folds `drop` into it. Every link, tag, suggestion and contributor claim that pointed at `drop`
 * now points at `keep`. Links that become duplicates are marked merged. Every change is logged on the dropped
 * person so the merge can be undone.
 */
function adminMerge_(db, keepId, dropId, fillBlanks) {
  var keep = db.People.get(keepId);
  var drop = db.People.get(dropId);
  if (!keep || !drop || keepId === dropId) throw userError_('Pick two different people.');
  if (keep.status === 'merged' || drop.status === 'merged') throw userError_('One of them was already merged.');
  var log = [];
  var change = function (tableName, row, field, value) {
    log.push({ t: tableName, id: row.id, f: field, old: row[field] });
    db[tableName].set(row, field, value);
  };

  if (fillBlanks) {
    Object.keys(PERSON_FIELDS).forEach(function (f) {
      var empty = !keep[f] || keep[f] === '[]' || (f === 'living' && keep[f] === 'unknown');
      if (empty && drop[f] && drop[f] !== '[]') change('People', keep, f, drop[f]);
    });
    if (keep.status === 'pending' && drop.status === 'approved') change('People', keep, 'status', 'approved');
  }

  var live = function (r) { return r.status === 'approved' || r.status === 'pending'; };
  db.Relationships.rows.forEach(function (r) {
    if (!live(r) || (r.person_a !== dropId && r.person_b !== dropId)) return;
    var a = r.person_a === dropId ? keepId : r.person_a;
    var b = r.person_b === dropId ? keepId : r.person_b;
    var dup = a === b || db.Relationships.rows.some(function (o) {
      return o !== r && live(o) && o.type === r.type &&
        ((o.person_a === a && o.person_b === b) || (r.type === 'partner' && o.person_a === b && o.person_b === a));
    });
    if (dup) change('Relationships', r, 'status', 'merged');
    else {
      if (r.person_a === dropId) change('Relationships', r, 'person_a', keepId);
      if (r.person_b === dropId) change('Relationships', r, 'person_b', keepId);
    }
  });
  db.PhotoTags.rows.forEach(function (t) {
    if (!live(t) || t.person_id !== dropId) return;
    var dup = db.PhotoTags.rows.some(function (o) { return o !== t && live(o) && o.photo_id === t.photo_id && o.person_id === keepId; });
    change('PhotoTags', t, dup ? 'status' : 'person_id', dup ? 'merged' : keepId);
  });
  db.Suggestions.rows.forEach(function (s) { if (s.target_id === dropId) change('Suggestions', s, 'target_id', keepId); });
  db.Contributors.rows.forEach(function (c) { if (c.person_id === dropId) change('Contributors', c, 'person_id', keepId); });

  log.push({ t: 'People', id: dropId, f: 'status', old: drop.status });
  db.People.set(drop, 'status', 'merged');
  db.People.set(drop, 'merged_into', keepId);
  db.People.set(drop, 'merge_log', JSON.stringify(log));
  db.People.set(drop, 'reviewed_at', nowIso_());
  if (PropertiesService.getScriptProperties().getProperty('OWNER_PERSON_ID') === dropId) {
    PropertiesService.getScriptProperties().setProperty('OWNER_PERSON_ID', keepId);
  }
  return { kept: keepId, merged: dropId, changes: log.length };
}

/** Reverses a merge from its log. Anything edited since the merge is put back to how it was before the merge. */
function adminUnmerge_(db, dropId) {
  var drop = db.People.get(dropId);
  if (!drop || drop.status !== 'merged' || !drop.merge_log) throw userError_('That person was not merged.');
  var log = JSON.parse(drop.merge_log);
  for (var i = log.length - 1; i >= 0; i--) {
    var e = log[i];
    var row = db[e.t].get(e.id);
    if (row) db[e.t].set(row, e.f, e.old);
  }
  var keepId = drop.merged_into;
  db.People.set(drop, 'merged_into', '');
  db.People.set(drop, 'merge_log', '');
  return { restored: dropId, from: keepId, changes: log.length };
}

function adminPhoto_(db, id) {
  var f = db.Photos.get(id);
  if (!f || !f.drive_file_id) throw userError_('Photo not found.');
  var blob = DriveApp.getFileById(f.drive_file_id).getBlob();
  return { id: id, data_url: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

function adminPause_(paused) {
  var props = PropertiesService.getScriptProperties();
  if (paused) props.setProperty('PAUSED', '1'); else props.deleteProperty('PAUSED');
  return { paused: paused };
}

function adminSetOwner_(db, personId) {
  var p = db.People.get(personId);
  if (!p || p.status !== 'approved') throw userError_('Person not found.');
  PropertiesService.getScriptProperties().setProperty('OWNER_PERSON_ID', personId);
  return { owner_person_id: personId };
}
