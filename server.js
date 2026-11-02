const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

let PORT = 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const WAITLIST_FILE = path.join(DATA_DIR, 'waitlist.json');

// Your Google Sheet configuration
const SPREADSHEET_ID = '1pKpk6upY_OXBJpgQCNIwsm84JooGyFGmrEsWOQGwEhw';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;

// Connected to live deployed Google Apps Script Web App
let GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbyhU5va8iQGqn8lR1QH9LV7JcsNciyIJ7rfvQr52-kQBsby0ye0naKm73EdOY-dCrQWMQ/exec';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(WAITLIST_FILE)) {
  fs.writeFileSync(WAITLIST_FILE, '[]', 'utf8');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function readLocalWaitlist() {
  try {
    const raw = fs.readFileSync(WAITLIST_FILE, 'utf8');
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}

function writeLocalWaitlist(list) {
  try {
    fs.writeFileSync(WAITLIST_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving waitlist:', e);
  }
}

let cachedCount = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 10000; // 10 seconds cache

function fetchWithRedirect(url, cb, depth = 0) {
  if (depth > 5) return cb(new Error('Too many redirects'));
  let done = false;
  const safeCb = (err, code, data) => {
    if (done) return;
    done = true;
    cb(err, code, data);
  };

  try {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        done = true;
        return fetchWithRedirect(res.headers.location, cb, depth + 1);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => safeCb(null, res.statusCode, data));
      res.on('error', err => safeCb(err));
    });
    req.on('error', err => safeCb(err));
    req.setTimeout(6000, () => {
      req.destroy();
      safeCb(new Error('Timeout fetching Google Sheet'));
    });
  } catch (err) {
    safeCb(err);
  }
}

function getGoogleSheetCount(cb) {
  const now = Date.now();
  if (cachedCount !== null && (now - lastCacheTime) < CACHE_TTL_MS) {
    return cb(null, cachedCount);
  }

  const queryUrl = GOOGLE_SCRIPT_URL || CSV_URL;
  fetchWithRedirect(queryUrl, (err, code, data) => {
    let sheetCount = 0;
    if (!err && code === 200 && data) {
      try {
        const json = JSON.parse(data);
        if (typeof json.count === 'number') {
          sheetCount = json.count;
        }
      } catch (e) {
        const lines = data.trim().split('\n').filter(l => l.trim().length > 0);
        sheetCount = lines.length > 1 ? lines.length - 1 : 0;
      }
    }
    const local = readLocalWaitlist();
    const totalCount = Math.max(sheetCount, local.length);
    cachedCount = totalCount;
    lastCacheTime = now;
    cb(null, totalCount);
  });
}

function postToGoogleScript(entry, cb) {
  if (!GOOGLE_SCRIPT_URL) return cb(new Error('No script url'));
  let done = false;
  const safeCb = (err, resData) => {
    if (done) return;
    done = true;
    cb(err, resData);
  };

  try {
    const postData = JSON.stringify(entry);
    const u = new URL(GOOGLE_SCRIPT_URL);
    const req = https.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchWithRedirect(res.headers.location, (err, code, data) => {
          if (err) return safeCb(err);
          try {
            safeCb(null, JSON.parse(data));
          } catch (pe) {
            safeCb(pe);
          }
        });
      } else {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => {
          try {
            safeCb(null, JSON.parse(b));
          } catch (pe) {
            safeCb(pe);
          }
        });
        res.on('error', err => safeCb(err));
      }
    });
    req.on('error', err => safeCb(err));
    req.setTimeout(7000, () => {
      safeCb(new Error('Timeout forwarding to Google Script'));
      req.destroy();
    });
    req.write(postData);
    req.end();
  } catch (err) {
    safeCb(err);
  }
}

function makeCode(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `MHLX-${hash.toString(36).toUpperCase().padStart(5, '0').slice(-5)}`;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let sanitizedUrl = decodeURIComponent(req.url.split('?')[0]);

  // API Route: /api/waitlist
  if (sanitizedUrl === '/api/waitlist') {
    if (req.method === 'GET') {
      getGoogleSheetCount((err, count) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: count }));
      });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const email = String(payload.email || '').trim();
          const role = String(payload.role || 'Student').trim();
          const source = String(payload.source || 'hero').trim();

          if (!email) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Email is required' }));
            return;
          }

          let sent = false;
          const sendResponse = (position, count, code) => {
            if (sent) return;
            sent = true;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              position: position,
              count: count,
              code: code
            }));
          };

          const rawEntry = {
            timestamp: new Date().toISOString(),
            email,
            role,
            source
          };

          postToGoogleScript(rawEntry, (gasErr, gasRes) => {
            if (!gasErr && gasRes && gasRes.success) {
              const position = gasRes.position;
              const count = gasRes.count || position;
              const code = gasRes.code;

              const entryWithDetails = {
                ...rawEntry,
                position,
                code
              };
              const local = readLocalWaitlist();
              local.push(entryWithDetails);
              writeLocalWaitlist(local);

              cachedCount = count;
              lastCacheTime = Date.now();

              return sendResponse(position, count, code);
            }

            // Fallback to local computation if Google Apps Script is unavailable
            getGoogleSheetCount((err, currentCount) => {
              const position = currentCount + 1;
              const count = position;
              const code = makeCode(`${email}${position}`);

              const localEntry = {
                ...rawEntry,
                position,
                code
              };
              const local = readLocalWaitlist();
              local.push(localEntry);
              writeLocalWaitlist(local);

              cachedCount = Math.max(cachedCount || 0, local.length);
              lastCacheTime = Date.now();

              return sendResponse(position, count, code);
            });
          });
        } catch (parseErr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }
  }

  // Static File Server
  const acceptHeader = req.headers['accept'] || '';
  const wantsMarkdown = acceptHeader.includes('text/markdown');

  if (sanitizedUrl === '/' || sanitizedUrl === '' || sanitizedUrl === '/index.html') {
    if (wantsMarkdown && fs.existsSync(path.join(PUBLIC_DIR, 'index.md'))) {
      sanitizedUrl = '/index.md';
    } else {
      sanitizedUrl = '/index.html';
    }
  }

  const safePath = path.normalize(path.join(PUBLIC_DIR, sanitizedUrl));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  let candidatePath = safePath;
  if (!fs.existsSync(candidatePath) && fs.existsSync(candidatePath + '.html')) {
    candidatePath = candidatePath + '.html';
  }

  fs.stat(candidatePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    let filePath = candidatePath;
    if (stats.isDirectory()) {
      filePath = path.join(candidatePath, 'index.html');
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      if (ext === '.html' || ext === '.md') {
        headers['Vary'] = 'Accept';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`MedHelix server running at http://localhost:${port}/`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} in use, trying port ${PORT + 1}...`);
    PORT++;
    startServer(PORT);
  } else {
    console.error('Server error:', err);
  }
});

startServer(PORT);
