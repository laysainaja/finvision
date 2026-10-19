import express from 'express';
import { fileURLToPath } from 'node:url';
import { app } from './app.js';

// Servidor local. Na Vercel quem atende é api/index.js (API) + dist/ (frontend estático).
const prod = process.argv.includes('--prod');
const port = Number(process.env.PORT ?? 5180);
const raiz = fileURLToPath(new URL('../', import.meta.url));

if (prod) {
  app.use(express.static(raiz + 'dist'));
  app.use((req, res) => res.sendFile(raiz + 'dist/index.html'));
} else {
  // Em desenvolvimento o Vite roda dentro do mesmo servidor: uma porta só, com recarga automática.
  const { createServer } = await import('vite');
  const vite = await createServer({ root: raiz, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, () => console.log(`FinVision rodando em http://localhost:${port}`));
