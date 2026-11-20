// Runs Code.gs unchanged inside a fake Apps Script environment (Sheet, Drive, properties, etc.).
// Usage: node apps-script/test/run.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeEnv() {
  const sheets = {};
  const formulaWrites = [];

  function makeSheet(name, header) {
    const data = [header.slice()];
    let maxRows = 1000;
    const sheet = {
      _data: data,
      getDataRange() {
        let last = data.length;
        while (last > 1 && data[last - 1].every(v => v === '')) last--;
        return { getValues: () => data.slice(0, last).map(r => r.slice()) };
      },
      getMaxRows: () => maxRows,
      insertRowsAfter(_after, n) { maxRows += n; },
      getRange(row, col, nr = 1, nc = 1) {
        if (row + nr - 1 > maxRows) throw new Error('Range outside sheet: row ' + (row + nr - 1) + ' > ' + maxRows);
        const range = {
          setNumberFormat() { return range; },
          setValues(vals) {
            if (vals.length !== nr || vals.some(r => r.length !== nc)) throw new Error('setValues size mismatch');
            for (let i = 0; i < nr; i++) {
              while (data.length < row + i) data.push(new Array(header.length).fill(''));
              for (let j = 0; j < nc; j++) {
                let v = vals[i][j];
                if (typeof v === 'string' && v.startsWith('=')) formulaWrites.push({ sheet: name, value: v });
                // Sheets consumes one leading apostrophe as a "this is text" marker.
                if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
                data[row - 1 + i][col - 1 + j] = v;
              }
            }
            return range;
          },
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) out.push((data[row - 1 + i] || []).slice(col - 1, col - 1 + nc));
            return out;
          }
        };
        return range;
      }
    };
    return sheet;
  }

  const props = {};
  const files = {};
  const mails = [];
  let fileSeq = 0;

  const blob = (bytes, type, name) => ({
    getBytes: () => bytes, getContentType: () => type, getName: () => name
  });

  const env = {
    console: { log() {}, error: (...a) => env._errors.push(a.join(' ')) },
    _errors: [],
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: k => { delete props[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      base64Encode: b => Buffer.from(b).toString('base64'),
      newBlob: blob
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
      Permission: { VIEW: 'VIEW', NONE: 'NONE' },
      getFolderById: () => ({
        getName: () => 'Roots photos',
        createFile(b) {
          const id = 'drive' + (++fileSeq);
          files[id] = { id, blob: b, sharing: 'PRIVATE' };
          return { getId: () => id };
        }
      }),
      getFileById(id) {
        const f = files[id];
        if (!f) throw new Error('no file ' + id);
        return {
          setSharing(access) { f.sharing = access; },
          getThumbnail: () => blob([1, 2, 3], 'image/png', 'thumb'),
          getBlob: () => f.blob
        };
      }
    },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }), getRemainingDailyQuota: () => 100 },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType: () => ({ text: s }) })
    },
    Date, JSON, Math, Object, Array, String, Number, Error, RegExp, isNaN, parseInt
  };

  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  vm.createContext(env);
  vm.runInContext(code, env, { filename: 'Code.gs' });
  for (const name of Object.keys(env.SCHEMA)) sheets[name] = makeSheet(name, env.SCHEMA[name]);

  return {
    env, sheets, props, files, mails, formulaWrites,
    get(params) { return JSON.parse(env.doGet({ parameter: params }).text); },
    post(body) { return JSON.parse(env.doPost({ postData: { contents: JSON.stringify(body) } }).text); },
    run(fnName) { return env[fnName](); }
  };
}

module.exports = { makeEnv };
