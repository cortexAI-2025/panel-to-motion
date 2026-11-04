import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import sharp from 'sharp';
import {
  UPLOADS_DIR,
  TMP_DIR,
  projectSourceDir,
  projectOutputDir,
  ensureProjectDirs,
  newId,
  saveProject,
  loadProject,
  listProjects,
  getJobs,
  getJob,
  saveJob,
} from '../store.js';
import { analyzePage } from '../pipeline/analyze.js';
import { FRENCH_VOICES, synthesize, voiceFilePath, ttsConfig } from '../pipeline/tts.js';
import { runGeneration } from '../pipeline/render.js';

export const api = Router();

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 40);

const storage = (dest) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.bin').toLowerCase();
      cb(null, newId('img') + ext);
    },
  });
const uploadProject = () =>
  multer({
    storage: storage(TMP_DIR),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = /\.(jpe?g|png|webp|pdf)$/i.test(file.originalname);
      cb(ok ? null : new Error('Format non supporte (JPG, PNG, WebP, PDF)'), ok);
    },
  }).array('files', 30);
const uploadMusic = multer({
  storage: storage(UPLOADS_DIR),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
}).single('file');

function requireProject(req, res, next) {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Projet introuvable' });
  req.project = p;
  next();
}

// ---- Projets ----

api.post('/projects', (req, res) => {
  const id = newId('proj');
  const project = {
    id,
    title: String(req.body.title || 'Planche sans titre').slice(0, 120),
    reading: req.body.reading === 'manga' ? 'manga' : 'western',
    format: ['9:16', '16:9', '1:1'].includes(req.body.format) ? req.body.format : '9:16',
    targetDuration: Number(req.body.targetDuration) || 60,
    images: [],
    scenes: [],
    characters: [],
    music: null,
    createdAt: new Date().toISOString(),
  };
  ensureProjectDirs(id);
  saveProject(project);
  res.json(project);
});

api.get('/projects', (req, res) => {
  res.json(listProjects());
});

api.get('/projects/:id', requireProject, (req, res) => {
  res.json(req.project);
});

api.put('/projects/:id', requireProject, (req, res) => {
  const p = req.project;
  const b = req.body || {};
  if (b.title) p.title = String(b.title).slice(0, 120);
  if (['western', 'manga'].includes(b.reading)) p.reading = b.reading;
  if (['9:16', '16:9', '1:1'].includes(b.format)) p.format = b.format;
  if (Number(b.targetDuration) > 0) p.targetDuration = Number(b.targetDuration);
  saveProject(p);
  res.json(p);
});

// ---- Imports ----

api.post('/projects/:id/images', requireProject, (req, res) => {
  uploadProject()(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const p = req.project;
    ensureProjectDirs(p.id);
    const added = [];
    for (const file of req.files || []) {
      // PDF : conversion en images via pdftoppm (poppler)
      if (/\.pdf$/i.test(file.originalname)) {
        const prefix = path.join(projectSourceDir(p.id), newId('pdf'));
        await new Promise((resolve, reject) => {
          execFile('pdftoppm', ['-png', '-r', '150', file.path, prefix], (e) =>
            e ? reject(new Error('Conversion PDF impossible (poppler requis)')) : resolve(null)
          );
        });
        const pages = fs
          .readdirSync(projectSourceDir(p.id))
          .filter((f) => f.startsWith(path.basename(prefix)));
        for (const page of pages) {
          added.push(await addImage(p, path.join(projectSourceDir(p.id), page), page));
        }
        fs.rmSync(file.path, { force: true });
      } else {
        const dest = path.join(projectSourceDir(p.id), file.filename);
        fs.copyFileSync(file.path, dest);
        fs.rmSync(file.path, { force: true });
        added.push(await addImage(p, dest, file.filename));
      }
    }
    saveProject(p);
    res.json({ images: added });
  });
});

async function addImage(project, absPath, name) {
  const meta = await sharp(absPath).metadata();
  const entry = {
    file: path.basename(name),
    width: meta.width,
    height: meta.height,
  };
  if (!project.images.some((i) => i.file === entry.file)) project.images.push(entry);
  return entry;
}

api.get('/projects/:id/image/:file', requireProject, (req, res) => {
  const file = path.join(projectSourceDir(req.project.id), path.basename(req.params.file));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Image introuvable' });
  res.sendFile(path.resolve(file));
});

// ---- Analyse (job asynchrone) ----

api.post('/projects/:id/analyze', requireProject, (req, res) => {
  const p = req.project;
  if (!p.images.length) return res.status(400).json({ error: 'Aucune image importee' });
  const job = createJob(p.id, 'analyze');
  saveJob(job);
  runJob(job, async () => {
    const scenes = [];
    for (const img of p.images) {
      const file = path.join(projectSourceDir(p.id), img.file);
      const pageScenes = await analyzePage(file, p.reading);
      for (const s of pageScenes) {
        scenes.push({
          id: newId('sc'),
          image: img.file,
          crop: s.crop,
          dialogue: s.dialogue || '',
          ocrConfidence: s.ocrConfidence || null,
          kind: s.kind,
          characterId: null,
          voiceId: 'fr-FR-DeniseNeural',
          motion: null,
          durationOverride: null,
          generated: null,
        });
      }
    }
    p.scenes = scenes;
    saveProject(p);
    return { scenes: scenes.length };
  });
  res.json({ job });
});

// ---- Storyboard ----

api.put('/projects/:id/storyboard', requireProject, (req, res) => {
  const p = req.project;
  const b = req.body || {};
  if (!Array.isArray(b.scenes)) return res.status(400).json({ error: 'scenes requis' });
  const knownIds = new Set((p.scenes || []).map((s) => s.id));
  const characters = Array.isArray(b.characters)
    ? b.characters.map((c) => ({
        id: c.id || newId('ch'),
        name: String(c.name || 'Personnage').slice(0, 60),
        voiceId: String(c.voiceId || 'fr-FR-DeniseNeural'),
      }))
    : p.characters || [];
  const characterIds = new Set(characters.map((c) => c.id));
  for (const s of b.scenes) {
    if (s.characterId && !characterIds.has(s.characterId)) {
      return res.status(400).json({ error: 'Personnage inconnu : ' + s.characterId });
    }
  }
  const scenes = b.scenes.map((s, i) => {
    const base = knownIds.has(s.id) ? p.scenes.find((x) => x.id === s.id) : null;
    return {
      id: s.id || newId('sc'),
      image: s.image || (base && base.image) || (p.images[0] && p.images[0].file) || null,
      crop: s.crop || (base && base.crop) || null,
      dialogue: String(s.dialogue !== undefined ? s.dialogue : (base && base.dialogue) || ''),
      characterId: s.characterId !== undefined ? s.characterId || null : (base && base.characterId) || null,
      ocrConfidence: s.ocrConfidence !== undefined ? s.ocrConfidence : (base && base.ocrConfidence) || null,
      voiceId: s.voiceId || (base && base.voiceId) || 'fr-FR-DeniseNeural',
      motion: s.motion || (base && base.motion) || null,
      durationOverride: Number(s.durationOverride) > 0 ? Number(s.durationOverride) : null,
      kind: String(s.dialogue !== undefined ? s.dialogue : (base && base.dialogue) || '').trim() ? 'dialogue' : 'ambiance',
      generated: (base && base.generated) || null,
      _order: i,
    };
  });
  p.scenes = scenes;
  p.characters = characters;
  saveProject(p);
  res.json(p);
});

// ---- Voix ----

api.get('/voices', (req, res) => res.json(FRENCH_VOICES));
api.get('/tts', (req, res) => res.json(ttsConfig()));

api.post('/projects/:id/voice-preview', requireProject, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  const voiceId = (req.body && req.body.voiceId) || 'fr-FR-DeniseNeural';
  if (!text) return res.status(400).json({ error: 'texte requis' });
  const prevId = newId('prev');
  synthesize(text.slice(0, 300), voiceId, null, {
    pathFor: (provider) => voiceFilePath(TMP_DIR, voiceId, prevId, provider),
  })
    .then((r) => res.set('X-Voice-Source', r.source).sendFile(path.resolve(r.path)))
    .catch((e) => res.status(503).json({ error: e.message }));
});

// ---- Musique ----

api.post('/projects/:id/music', requireProject, (req, res) => {
  uploadMusic(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
    req.project.music = req.file.filename;
    saveProject(req.project);
    res.json({ music: req.file.filename });
  });
});

api.delete('/projects/:id/music', requireProject, (req, res) => {
  req.project.music = null;
  saveProject(req.project);
  res.json({ music: null });
});

// ---- Generation ----

function launchGeneration(p, res) {
  const job = createJob(p.id, 'generate');
  saveJob(job);
  runJob(job, () =>
    runGeneration(p, (progress) => {
      job.progress = progress;
      saveJob(job);
    })
  );
  res.json({ job });
}

api.post('/projects/:id/generate', requireProject, (req, res) => {
  const p = req.project;
  if (!p.scenes || !p.scenes.length) return res.status(400).json({ error: 'Storyboard vide' });
  launchGeneration(p, res);
});

api.post('/projects/:id/scenes/:sceneId/regenerate', requireProject, (req, res) => {
  const p = req.project;
  const scene = (p.scenes || []).find((s) => s.id === req.params.sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene introuvable' });
  scene.generated = null; // force le rerendu de cette scene uniquement
  saveProject(p);
  launchGeneration(p, res);
});

api.post('/projects/:id/assemble', requireProject, (req, res) => {
  const p = req.project;
  const ready = (p.scenes || []).filter((s) => s.generated && s.generated.video);
  if (!ready.length) return res.status(400).json({ error: 'Aucune scene generee' });
  launchGeneration(p, res);
});

// ---- Telechargements ----

function sendIfExists(res, file, label) {
  if (file && fs.existsSync(file)) return res.download(path.resolve(file));
  res.status(404).json({ error: label + ' indisponible' });
}

api.get('/projects/:id/video/final', requireProject, (req, res) => {
  sendIfExists(res, path.join(projectOutputDir(req.project.id), 'final.mp4'), 'Video finale');
});
api.get('/projects/:id/subtitles', requireProject, (req, res) => {
  sendIfExists(res, path.join(projectOutputDir(req.project.id), 'sous-titres.srt'), 'Sous-titres');
});
api.get('/projects/:id/video/:sceneId', requireProject, (req, res) => {
  const scene = (req.project.scenes || []).find((s) => s.id === req.params.sceneId);
  sendIfExists(res, scene && scene.generated && scene.generated.video, 'Video de scene');
});
api.get('/projects/:id/audio/:sceneId', requireProject, (req, res) => {
  const scene = (req.project.scenes || []).find((s) => s.id === req.params.sceneId);
  sendIfExists(res, scene && scene.generated && scene.generated.audio, 'Audio de scene');
});
api.get('/projects/:id/scene-image/:sceneId', requireProject, (req, res) => {
  const scene = (req.project.scenes || []).find((s) => s.id === req.params.sceneId);
  sendIfExists(res, scene && scene.generated && scene.generated.image, 'Image de scene');
});

// ---- Jobs ----

function createJob(projectId, type) {
  return {
    id: newId('job'),
    projectId,
    type,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: null,
    result: null,
    error: null,
  };
}

function runJob(job, work) {
  Promise.resolve()
    .then(work)
    .then((result) => {
      job.status = 'done';
      job.result = result || null;
      job.finishedAt = new Date().toISOString();
      saveJob(job);
    })
    .catch((e) => {
      job.status = 'error';
      job.error = String((e && e.message) || e);
      job.finishedAt = new Date().toISOString();
      saveJob(job);
    });
}

api.get('/jobs', (req, res) => res.json(getJobs()));
api.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
});

api.post('/jobs/:id/resume', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  const p = loadProject(job.projectId);
  if (!p) return res.status(404).json({ error: 'Projet introuvable' });
  if (job.status !== 'error' && job.status !== 'interrupted') {
    return res.status(400).json({ error: 'Ce job ne peut pas etre repris (statut ' + job.status + ')' });
  }
  const resumed = createJob(p.id, job.type);
  resumed.resumedFrom = job.id;
  saveJob(resumed);
  runJob(resumed, () =>
    runGeneration(p, (progress) => {
      resumed.progress = progress;
      saveJob(resumed);
    })
  );
  res.json({ job: resumed });
});
