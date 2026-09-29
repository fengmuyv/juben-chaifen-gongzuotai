import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { describeImage } from './electron/vision';

export default defineConfig({ plugins: [react(), {
  name: 'local-vision-api',
  configureServer(server) {
    server.middlewares.use('/api/vision', async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      try {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 3_200_000) throw new Error('图片请求过大'); }
        const description = await describeImage(JSON.parse(body));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ description }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : '视觉描述失败' }));
      }
    });
  },
}], base: './' });
