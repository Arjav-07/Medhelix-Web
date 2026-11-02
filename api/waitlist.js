const https = require('https');

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbyhU5va8iQGqn8lR1QH9LV7JcsNciyIJ7rfvQr52-kQBsby0ye0naKm73EdOY-dCrQWMQ/exec';
const CSV_URL = 'https://docs.google.com/spreadsheets/d/1pKpk6upY_OXBJpgQCNIwsm84JooGyFGmrEsWOQGwEhw/export?format=csv';

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
    cb(null, sheetCount);
  });
}

function postToGoogleScript(entry, cb) {
  if (!GOOGLE_SCRIPT_URL) return cb(new Error('No script URL configured'));
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
    req.setTimeout(8000, () => {
      safeCb(new Error('Timeout forwarding to Google Script'));
      req.destroy();
    });
    req.write(postData);
    req.end();
  } catch (err) {
    safeCb(err);
  }
}

function makeFallbackCode(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `MHLX-${hash.toString(36).toUpperCase().padStart(5, '0').slice(-5)}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    getGoogleSheetCount((err, count) => {
      res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
      return res.status(200).json({ success: true, count: count || 0 });
    });
    return;
  }

  if (req.method === 'POST') {
    let payload = req.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        payload = {};
      }
    }
    payload = payload || {};

    const email = String(payload.email || '').trim();
    const role = String(payload.role || 'Student').trim();
    const source = String(payload.source || 'hero').trim();

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const rawEntry = {
      timestamp: new Date().toISOString(),
      email,
      role,
      source
    };

    postToGoogleScript(rawEntry, (gasErr, gasRes) => {
      if (!gasErr && gasRes && gasRes.success) {
        return res.status(200).json({
          success: true,
          position: gasRes.position,
          count: gasRes.count || gasRes.position,
          code: gasRes.code
        });
      }

      // Fallback if Google Apps Script is momentarily unreachable
      getGoogleSheetCount((err, currentCount) => {
        const position = (currentCount || 0) + 1;
        const code = makeFallbackCode(`${email}${position}`);
        return res.status(200).json({
          success: true,
          position: position,
          count: position,
          code: code
        });
      });
    });
    return;
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
