import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { describeImage } from './electron/vision';
import { generateSegmentFields, testConnection } from './electron/script';

type Handler = (body: unknown) => Promise<unknown>;

const routes: Record<string, Handler> = {
  '/api/vision': (body) => describeImage(body),
  '/api/script/test': (body) => testConnection(body),
  '/api/script/generate': async (body) => ({ shots: await generateSegmentFields(body) }),
};

export default defineConfig({ plugins: [react(), {
  name: 'local-enhancement-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      const handler = routes[path];
      if (!handler) { next(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      try {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 3_200_000) throw new Error('请求体过大'); }
        const payload = await handler(JSON.parse(body));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : '增强通道调用失败' }));
      }
    });
  },
}], base: './' });
