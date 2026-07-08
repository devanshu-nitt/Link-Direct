const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORAGE_DIR = path.join(__dirname, 'shared');

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// ---------- helpers ----------

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family !== 'IPv4' || net.internal) continue;

      // Score interfaces so the real WiFi adapter sorts first.
      // Wifi/WLAN adapters score highest; known virtual/VPN/container
      // adapters score lowest so they don't get picked by accident.
      const lname = name.toLowerCase();
      let score = 50;

      if (/wi-?fi|wlan|wireless/.test(lname)) score = 100;
      else if (/ethernet|eth\d/.test(lname)) score = 70;
      else if (/vmware|virtualbox|vbox|hyper-v|vethernet|docker|wsl|loopback/.test(lname)) score = 5;
      else if (/tailscale|zerotier|tun|tap|ppp|vpn/.test(lname)) score = 1;

      // Private-range /24 addresses typical of phone hotspots
      // (192.168.x.x, 172.16-31.x.x, 10.x.x.x) get a small boost.
      if (/^192\.168\./.test(net.address) || /^10\./.test(net.address) ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(net.address)) {
        score += 10;
      }

      candidates.push({ address: net.address, iface: name, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function mimeFor(ext) {
  const map = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.ico': 'image/x-icon'
  };
  return map[ext] || 'application/octet-stream';
}

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').replace(/^\.+/, '');
}

function uniquePath(dir, filename) {
  let target = path.join(dir, filename);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let i = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return target;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ---------- WebSocket broadcast for live progress / file list updates ----------

let wss;
function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

function listFiles() {
  return fs.readdirSync(STORAGE_DIR)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const stat = fs.statSync(path.join(STORAGE_DIR, f));
      return {
        name: f,
        size: stat.size,
        sizeLabel: formatBytes(stat.size),
        mtime: stat.mtimeMs
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

// ---------- HTTP server ----------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // CORS for safety when accessed via IP
  res.setHeader('Access-Control-Allow-Origin', '*');

  // API: list files
  if (pathname === '/api/files' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listFiles()));
    return;
  }

  // API: server info (IPs, port)
  if (pathname === '/api/info' && req.method === 'GET') {
    const interfaces = getLocalIPs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      interfaces,
      ips: interfaces.map(i => i.address), // kept for backwards compatibility
      port: PORT
    }));
    return;
  }

  // API: delete a file
  if (pathname.startsWith('/api/files/') && req.method === 'DELETE') {
    const name = sanitizeFilename(decodeURIComponent(pathname.replace('/api/files/', '')));
    const target = path.join(STORAGE_DIR, name);
    if (target.startsWith(STORAGE_DIR) && fs.existsSync(target)) {
      fs.unlinkSync(target);
      broadcast({ type: 'files', files: listFiles() });
      res.writeHead(200); res.end('ok');
    } else {
      res.writeHead(404); res.end('not found');
    }
    return;
  }

  // API: download a file
  if (pathname.startsWith('/download/') && req.method === 'GET') {
    const name = sanitizeFilename(decodeURIComponent(pathname.replace('/download/', '')));
    const target = path.join(STORAGE_DIR, name);
    if (!target.startsWith(STORAGE_DIR) || !fs.existsSync(target)) {
      res.writeHead(404); res.end('File not found');
      return;
    }
    const stat = fs.statSync(target);
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
      });
      fs.createReadStream(target, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
      });
      fs.createReadStream(target).pipe(res);
    }
    return;
  }

  // API: upload (streamed directly to disk, no memory buffering)
  if (pathname === '/api/upload' && req.method === 'POST') {
    const rawName = url.searchParams.get('name') || `upload-${Date.now()}.bin`;
    const uploadId = url.searchParams.get('id') || crypto.randomUUID();
    const name = sanitizeFilename(rawName);
    const target = uniquePath(STORAGE_DIR, name);
    const tmpTarget = target + '.part';

    const totalSize = parseInt(req.headers['content-length'] || '0', 10);
    let received = 0;
    let lastBroadcast = 0;

    const writeStream = fs.createWriteStream(tmpTarget);

    req.on('data', chunk => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastBroadcast > 150) {
        lastBroadcast = now;
        broadcast({
          type: 'progress',
          id: uploadId,
          name: path.basename(target),
          received,
          total: totalSize,
          pct: totalSize ? Math.round((received / totalSize) * 100) : 0
        });
      }
    });

    req.pipe(writeStream);

    req.on('error', () => {
      writeStream.destroy();
      if (fs.existsSync(tmpTarget)) fs.unlinkSync(tmpTarget);
      res.writeHead(400); res.end('upload error');
    });

    writeStream.on('finish', () => {
      fs.renameSync(tmpTarget, target);
      broadcast({ type: 'progress', id: uploadId, name: path.basename(target), received, total: totalSize, pct: 100, done: true });
      broadcast({ type: 'files', files: listFiles() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: path.basename(target) }));
    });

    writeStream.on('error', (err) => {
      res.writeHead(500); res.end('write error: ' + err.message);
    });

    return;
  }

  // Static file serving for the UI
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(path.extname(filePath)) });
    res.end(data);
  });
});

wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'files', files: listFiles() }));
});

server.listen(PORT, '0.0.0.0', () => {
  const interfaces = getLocalIPs();
  console.log('\n  WiFi Transfer running!\n');
  console.log(`  Local:   http://localhost:${PORT}`);
  if (interfaces.length === 0) {
    console.log('  No network adapter detected — make sure WiFi is connected.');
  } else {
    interfaces.forEach((i, idx) => {
      const star = idx === 0 ? '  <- use this one' : '';
      console.log(`  Network: http://${i.address}:${PORT}   (${i.iface})${star}`);
    });
  }
  console.log('\n  Open the starred Network URL on your other device (same WiFi/hotspot).');
  console.log('  If that one fails, try the next address in the list.\n');
});
