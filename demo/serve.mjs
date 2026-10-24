// Static server for the demo with HTTP Range support (the video seeks a lot; without byte ranges Chrome cannot
// seek). No dependencies:  node demo/serve.mjs [port]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2] ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
};

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(
    /^(\.\.[/\\])+/,
    '',
  );
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
  let size;
  try {
    if (!file.startsWith(root)) throw new Error('outside root');
    size = statSync(file).size;
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  const headers = {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`demo on http://localhost:${port}/`));
