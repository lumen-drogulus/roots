// Local stand-in for the deployed web app: runs Code.gs unchanged (via the harness) behind HTTP,
// so the real pages can be exercised end to end without touching the live Sheet.
// Usage: node apps-script/test/server.js [port]   then open index.html?api=http://localhost:PORT
const http = require('http');
const { makeEnv } = require('./harness');

const port = +process.argv[2] || 8787;
const t = makeEnv();
t.run('setup');

http.createServer((req, res) => {
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  };
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__key') return send(200, t.props.ADMIN_KEY, 'text/plain');   // test-only helper
  if (url.pathname === '/__sheet') return send(200, JSON.stringify(Object.fromEntries(Object.entries(t.sheets).map(([k, v]) => [k, v._data]))));
  if (req.method === 'GET') return send(200, t.env.doGet({ parameter: Object.fromEntries(url.searchParams) }).text);
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { setTimeout(() => send(200, t.env.doPost({ postData: { contents: body } }).text), 250); });
    return;
  }
  send(405, '{}');
}).listen(port, () => console.log('Roots test API on http://localhost:' + port));
