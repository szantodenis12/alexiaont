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

const server = http.createServer((req, res) => {
  // Sanitize path to prevent directory traversal
  let safePath = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '');
  
  // Default to index.html if root path
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

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
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(indexContent);
          }
        });
      } else {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Static SPA server listening on port ${PORT}`);
});
