// Hangout Worlds server: serves index.html and relays player state over WebSocket.
// No dependencies. Run with: node server.js   (PORT env var optional)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, MAX_CLIENTS = +process.env.MAX_CLIENTS || 60;
const ORIGIN = process.env.ALLOWED_ORIGIN || ''; // e.g. https://yourdomain.com (optional)
const MAPS = ['plaza', 'frost', 'desert'], MODES = ['hangout', 'orbs', 'tag', 'race'];

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  } else if (u === '/healthz') { res.writeHead(200); res.end('ok'); }
  else { res.writeHead(404); res.end('Not found'); }
});

const clients = new Map(); let nextId = 1, dirty = false;
const num = (v, a, b) => (typeof v === 'number' && isFinite(v) ? Math.max(a, Math.min(b, v)) : undefined);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
// Only whitelisted, range-checked fields are ever stored or relayed.
function clean(d) {
  const o = {}; if (!d || typeof d !== 'object') return o;
  const set = (k, v) => { if (v !== undefined) o[k] = v; };
  set('x', num(d.x, -200, 200)); set('z', num(d.z, -200, 200)); set('r', num(d.r, -10, 10));
  if (typeof d.mv === 'boolean') o.mv = d.mv;
  set('name', str(d.name, 14)); set('hue', num(d.hue, 0, 1));
  set('say', str(d.say, 120)); set('sayAt', num(d.sayAt, 0, 1e15));
  if (d.emo === 1 || d.emo === 2) o.emo = d.emo; set('emoAt', num(d.emoAt, 0, 1e15));
  if (MAPS.includes(d.map)) o.map = d.map; if (MODES.includes(d.mode)) o.mode = d.mode;
  set('score', num(d.score, 0, 1000)); set('best', num(d.best, 0, 1e5));
  if (typeof d.it === 'boolean') o.it = d.it; set('tagTo', str(d.tagTo, 20)); set('tagAt', num(d.tagAt, 0, 1e15));
  return o;
}

function frame(s) {
  const b = Buffer.from(s), n = b.length; let h;
  if (n < 126) h = Buffer.from([0x81, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, b]);
}
function drop(c) { if (!clients.delete(c.id)) return; c.sock.destroy(); dirty = true; }
function send(c, buf) { if (c.sock.writableLength > 1e6) return drop(c); c.sock.write(buf); }

function handle(c, text) {
  const now = Date.now(); c.tokens = Math.min(40, c.tokens + (now - c.last) / 50); c.last = now;
  if (c.tokens < 1) return; c.tokens--; // rate limit ~20 msgs/sec
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (m && m.t === 'p') { Object.assign(c.pres, clean(m.d)); dirty = true; }
}
function onData(c, chunk) {
  c.seen = Date.now(); c.buf = Buffer.concat([c.buf, chunk]);
  while (c.buf.length >= 2) {
    const op = c.buf[0] & 15, masked = c.buf[1] & 128; let len = c.buf[1] & 127, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) return drop(c);
    if (!masked || len > 2048) return drop(c);
    if (c.buf.length < off + 4 + len) return;
    const mask = c.buf.slice(off, off + 4), data = Buffer.from(c.buf.slice(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    c.buf = c.buf.slice(off + 4 + len);
    if (op === 8) return drop(c);
    if (op === 9) { if (len > 125) return drop(c); c.sock.write(Buffer.concat([Buffer.from([0x8a, len]), data])); }
    else if (op === 1) handle(c, data.toString());
    else if (op !== 10) return drop(c); // binary / continuation frames are not used
  }
}

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url.split('?')[0] !== '/ws' || !key || clients.size >= MAX_CLIENTS || (ORIGIN && req.headers.origin !== ORIGIN)) { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  const c = { id: 'p' + (nextId++), sock, buf: Buffer.alloc(0), pres: {}, tokens: 40, last: Date.now(), seen: Date.now() };
  clients.set(c.id, c); sock.setNoDelay(true);
  sock.on('data', d => onData(c, d)); sock.on('close', () => drop(c)); sock.on('error', () => drop(c));
  send(c, frame(JSON.stringify({ t: 'hello', id: c.id })));
});

// Broadcast a snapshot (only same-map players) ten times a second when something changed.
setInterval(() => {
  if (!dirty) return; dirty = false;
  const byMap = {};
  for (const c of clients.values()) if (c.pres.x !== undefined) (byMap[c.pres.map] || (byMap[c.pres.map] = [])).push({ peer: c.id, presence: c.pres });
  for (const c of clients.values()) send(c, frame(JSON.stringify({ t: 's', peers: byMap[c.pres.map] || [] })));
}, 100);
// Heartbeat: ping everyone, drop connections silent for 90s.
setInterval(() => {
  const now = Date.now();
  for (const c of clients.values()) { if (now - c.seen > 90000) drop(c); else c.sock.write(Buffer.from([0x89, 0])); }
}, 30000);

server.listen(PORT, () => console.log('Hangout Worlds running on http://localhost:' + PORT));
