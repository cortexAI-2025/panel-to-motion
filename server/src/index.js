import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import { markInterruptedOnBoot } from './store.js';

// Les jobs d'une session precedente ne tournent plus : marquer resumables.
markInterruptedOnBoot();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '5mb' }));
app.use('/api', apiRouter);

const webDir = path.resolve(__dirname, '../../web');
app.use(express.static(webDir));
// SPA fallback : toutes les routes non-API servent l'application
app.get(/.*/, (req, res) => res.sendFile(path.join(webDir, 'index.html')));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log('Panel to Motion demarre sur http://localhost:' + PORT);
});
