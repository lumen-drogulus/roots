// The local API (real Code.gs) loaded with a family from a JSON file, for the layout audit.
// Usage: SEED=file.json OWNER=<person id> PORT=8795 node server.js
const http = require('http');
const fs = require('fs');
const { makeEnv } = require('../harness');
const t = makeEnv();
t.run('setup');
const seed = JSON.parse(fs.readFileSync(process.env.SEED));
for (const k of Object.keys(seed)) { const d = t.sheets[k]._data; d.length = 0; seed[k].forEach(r => d.push(r)); }
// Seeds saved before a column was added (adoption_shown, kind, mime: 2026-11-22) get it appended, as the real Sheet does.
for (const k of Object.keys(seed)) { const d = t.sheets[k]._data; t.env.SCHEMA[k].forEach(c => { if (!d[0].includes(c)) d.forEach((r, i) => r.push(i ? '' : c)); }); }
t.props.OWNER_PERSON_ID = process.env.OWNER;
http.createServer((req, res) => {
  const send = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(b); };
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET') return send(200, t.env.doGet({ parameter: Object.fromEntries(url.searchParams) }).text);
  let body = ''; req.on('data', c => body += c); req.on('end', () => send(200, t.env.doPost({ postData: { contents: body } }).text));
}).listen(+process.env.PORT || 8795);
