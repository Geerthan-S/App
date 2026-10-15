/**
 * Local Static Web Server for Admin Portal
 * Serves admin/ on PORT (default 5000) with the same security headers as
 * Firebase Hosting (firebase.json), so CSP problems show up locally. The CSP
 * also allows the local emulators on 127.0.0.1.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 5000;
const PUBLIC_DIR = path.join(__dirname, 'admin');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Mirrors the hosting headers in firebase.json, plus the local emulator origins.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com https://apis.google.com",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com " +
    'https://asia-south1-doctor-c7c29.cloudfunctions.net http://127.0.0.1:* http://localhost:*',
  'frame-src https://doctor-c7c29.firebaseapp.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow',
  // Always revalidate so edits show up on reload.
  'Cache-Control': 'no-cache',
};

const send = (res, status, contentType, body) => {
  res.writeHead(status, { 'Content-Type': contentType, ...SECURITY_HEADERS });
  res.end(body);
};

const sendIndex = res => fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, data) => {
  if (err) send(res, 404, 'text/plain', 'Not Found');
  else send(res, 200, 'text/html; charset=utf-8', data);
});

const server = http.createServer((req, res) => {
  let reqPath;
  try {
    reqPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (_) {
    send(res, 400, 'text/plain', 'Bad Request');
    return;
  }
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.resolve(PUBLIC_DIR, `.${reqPath}`);
  // Never serve anything outside admin/ (e.g. /../functions/package.json).
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    send(res, 403, 'text/plain', 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendIndex(res); // SPA fallback
      return;
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) send(res, 500, 'text/plain', 'Internal Server Error');
      else send(res, 200, MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', data);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Healthcare Workforce Admin Portal running at http://localhost:${PORT}`);
});

// Browsers may resolve "localhost" to the IPv6 loopback; serve it too (still loopback only).
http.createServer(server.listeners('request')[0])
  .on('error', () => { /* IPv6 loopback unavailable: IPv4 is enough */ })
  .listen(PORT, '::1');
