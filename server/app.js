import express from 'express';
import { api } from './api.js';

// App compartilhado: usado pelo servidor local (server/index.js) e pela função serverless da Vercel (api/index.js).
export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' })); // a Vercel aceita no máximo 4,5 MB por requisição
app.use('/api', api);
