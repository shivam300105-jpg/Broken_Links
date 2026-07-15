// src/app.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import scanRouter from './routes/scan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/', scanRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Broken Link Scanner running on http://localhost:${PORT}`);
});

export default app;