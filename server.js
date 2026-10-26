// 로컬 미리보기용 정적 파일 서버 (의존성 없음).
// 데이터 · 로그인 · 실시간은 모두 Supabase 가 처리하므로, 배포할 때는 public/ 폴더만
// Vercel · Netlify · GitHub Pages 같은 정적 호스팅에 올리면 됩니다.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (urlPath.endsWith('/') || !fs.existsSync(file)) file = path.join(ROOT, 'index.html');
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}).listen(PORT, () => console.log(`🏋️  짐짝(GYMJJAK) http://localhost:${PORT}  (데이터: Supabase)`));
