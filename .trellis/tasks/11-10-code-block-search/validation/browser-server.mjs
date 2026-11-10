import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const entry = '/' + relative(root, fileURLToPath(new URL('./browser-fixture.jsx', import.meta.url)));
const fixture = { name: 'fixture', configureServer(server) {
  server.middlewares.use(async (req,res,next) => {
    if (req.url === '/api/auth.config') {
      res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify({ok:true,data:{providers:[]}}));return;
    }
    if (!req.url?.startsWith('/fixture')) return next();
    const html = await server.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Language picker acceptance</title><script>window.env={ENVIRONMENT:"test",URL:"http://127.0.0.1:4271",COLLABORATION_URL:"",DEFAULT_LANGUAGE:"zh_CN"}</script></head><body><div id="editor"></div><div id="root"></div><script type="module" src="' + entry + '"></script></body></html>');
    res.setHeader('Content-Type','text/html');res.end(html);
  });
} };
const server = await createServer({ configFile: false, root, publicDir: false, plugins: [react(), fixture],
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  resolve: { alias: { '~': resolve(root,'app'), '@shared': resolve(root,'shared') } },
  server: { host:'127.0.0.1',port:4271,strictPort:true },
});
await server.listen();
console.log('Browser fixture available at http://127.0.0.1:4271/fixture');
