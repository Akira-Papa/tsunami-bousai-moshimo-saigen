import fs from 'node:fs';
import path from 'node:path';

// dev-only: POST /__shot?name=xxx with a PNG body → saved to ./shots/xxx.png (for automated visual checks)
function saveShot(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    fs.mkdirSync('shots', { recursive: true });
    fs.writeFileSync(path.join('shots', name + '.png'), Buffer.concat(chunks));
    res.end('ok');
  });
}

const shotSaver = {
  name: 'shot-saver',
  configureServer(server) { server.middlewares.use('/__shot', saveShot); },
  configurePreviewServer(server) { server.middlewares.use('/__shot', saveShot); },
};

export default {
  base: './', // works from any sub-folder
  plugins: [shotSaver],
  build: {
    target: 'esnext',
    
  },
  worker: { format: 'es' },
  esbuild: { target: 'esnext' },
  optimizeDeps: { exclude: ['maplibre-gl'], esbuildOptions: { target: 'esnext' } },
};
