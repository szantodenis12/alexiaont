import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

/**
 * Cache policy.
 *
 * Vite writes hashed filenames into /assets (index-a1b2c3d4.js), so the content
 * at a given URL can never change — those are safe to cache for a year, which
 * means repeat visits re-download nothing.
 *
 * index.html must never be cached: it is the file that points at the current
 * hashed bundles, so a stale copy would keep serving an old build after deploy.
 */
const ONE_YEAR = 60 * 60 * 24 * 365;
const ONE_DAY = 60 * 60 * 24;

function cacheControlFor(urlPath, ext) {
  if (ext === '.html') {
    return 'no-cache';
  }
  if (urlPath.startsWith('/assets/')) {
    return `public, max-age=${ONE_YEAR}, immutable`;
  }
  // Root-level static files (favicon, logo) keep their names across deploys,
  // so cache them for a day and let revalidation pick up changes.
  return `public, max-age=${ONE_DAY}`;
}

const server = http.createServer((req, res) => {
  // Decode URL to handle spaces (%20) and other special characters
  let decodedUrl = req.url;
  try {
    decodedUrl = decodeURIComponent(req.url);
  } catch (e) {
    // Fallback to raw URL if decoding fails
  }

  // Sanitize path to prevent directory traversal
  let safePath = path.normalize(decodedUrl).replace(/^(\.\.[\/\\])+/, '');

  // Default to index.html if root path
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  // Normalised, forward-slash form used only for the cache-policy decision
  const urlForCache = safePath.replace(/\\/g, '/');

  let filePath = path.join(PUBLIC_DIR, safePath);

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    // If it is a directory or doesn't exist, we fallback
    if (!err && stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        // If file not found (404), this is a SPA route! Serve index.html as fallback.
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (indexErr, indexContent) => {
          if (indexErr) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error: Missing index.html in dist.');
          } else {
            res.writeHead(200, {
              'Content-Type': 'text/html',
              'Cache-Control': 'no-cache',
            });
            res.end(indexContent);
          }
        });
      } else {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': cacheControlFor(urlForCache, ext),
        });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Static SPA server listening on port ${PORT}`);
});
