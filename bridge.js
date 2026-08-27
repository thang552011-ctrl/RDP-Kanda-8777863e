// ═══════════════════════════════════════════════════════
// KANDA RDP BRIDGE — 2-port gateway on Railway
//   - HTTP (PORT env, Railway domain)  : WebSocket /ws — runner (GitHub Actions) kết nối vào
//   - TCP  (RDP_PORT, Railway TCP Proxy): raw TCP — RDP client (mstsc) kết nối vào
// Bridge ghép: TCP(RDP client) <-> WS(runner) <-> 3389 trong runner
// ═══════════════════════════════════════════════════════
const net = require('net');
const http = require('http');
const crypto = require('crypto');

const HTTP_PORT = parseInt(process.env.PORT || '8080', 10);   // Railway HTTP domain
const RDP_PORT  = parseInt(process.env.RDP_PORT || '3389', 10); // Railway TCP Proxy -> app port

const WebSocketServer = require('ws').WebSocketServer;

// session 'default' -> Set<ws runner endpoints>
const runners = new Map();
function rset(){ if(!runners.has('default')) runners.set('default', new Set()); return runners.get('default'); }

// ─── HTTP + WS (runner side) ───
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('KANDA RDP BRIDGE');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws) => {
  const set = rset();
  set.add(ws);
  console.log(`[bridge] runner registered (total=${set.size})`);
  ws.on('close', () => { set.delete(ws); console.log(`[bridge] runner gone (total=${set.size})`); });
  ws.on('error', () => {});
});

// ─── TCP server (RDP client side) ───
const tcpServer = net.createServer((sock) => {
  const set = rset();
  let ws = null;
  if (set.size > 0) {
    ws = set.values().next().value;
  }
  if (!ws || ws.readyState !== 1 /* OPEN */) {
    console.log('[bridge] no runner, reject RDP conn');
    sock.destroy();
    return;
  }
  console.log('[bridge] bridging RDP client <-> runner');

  sock.on('data', (buf) => { try { if (ws.readyState === 1) ws.send(buf); } catch(e){} });
  ws.on('message', (data, isBinary) => {
    try { if (!sock.destroyed) sock.write(Buffer.isBuffer(data) ? data : Buffer.from(data)); } catch(e){}
  });
  ws.on('close', () => sock.destroy());
  sock.on('close', () => { try { if (ws.readyState === 1) ws.close(); } catch(e){} });
  sock.on('error', () => { try { if (ws.readyState === 1) ws.close(); } catch(e){} });
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => console.log(`[bridge] HTTP+WS on :${HTTP_PORT}`));
tcpServer.listen(RDP_PORT, '0.0.0.0', () => console.log(`[bridge] TCP RDP on :${RDP_PORT}`));
