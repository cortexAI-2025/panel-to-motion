import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  projectSourceDir,
  projectWorkDir,
  projectOutputDir,
  UPLOADS_DIR,
  saveProject,
} from '../store.js';
import { mediaDuration, assertPlayableVideo } from '../ffmpeg.js';
import { prepareSceneImage, renderScene, muxAudio, MOTIONS } from './animate.js';
import { synthesize, voiceFilePath, ttsConfig } from './tts.js';
import { buildSRT, assembleFinal } from './assemble.js';
import { aiAvailable, generateSceneVideo } from './videoai.js';

const PAUSE_AFTER_VOICE = 0.45;
const AMBIANCE_DURATION = 2.5;

// Hash des entrees d'une scene : tout changement (image, recadrage,
// dialogue, voix, duree, mouvement, format) invalide le rendu existant.
export const DEFAULT_VOICE = 'fr-FR-DeniseNeural';

// La voix d'une scene : celle du personnage attribue, sinon celle de la scene.
export function resolveVoice(project, scene) {
  const ch = scene.characterId && (project.characters || []).find((c) => c.id === scene.characterId);
  return (ch && ch.voiceId) || scene.voiceId || DEFAULT_VOICE;
}

export function sceneHash(scene, format, project = {}) {
  const cfg = ttsConfig();
  const inputs = {
    image: scene.image || null,
    crop: scene.crop || null,
    dialogue: scene.dialogue || '',
    voiceId: resolveVoice(project, scene),
    tts: cfg.provider + '>' + (cfg.fallback || ''),
    durationOverride: scene.durationOverride || null,
    motion: scene.motion || null,
    format: format || '9:16',
  };
  return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 16);
}

export function sceneWorkPath(projectId, sceneId) {
  return path.join(projectWorkDir(projectId), 'scene-' + sceneId);
}

async function playable(file) {
  try {
    await assertPlayableVideo(file);
    return true;
  } catch {
    return false;
  }
}

function pickMotion(scene, index) {
  if (scene.motion && MOTIONS.includes(scene.motion)) return scene.motion;
  const cycle = ['zoom-in', 'pan-right', 'zoom-out', 'ken-burns', 'pan-left'];
  return cycle[index % cycle.length];
}

// Rendu d'une scene : image preparee -> voix -> duree -> animation.
// Retourne les metadonnees persistees dans project.json.
export async function renderOneScene(project, scene, index = 0) {
  const format = project.format || '9:16';
  const dir = sceneWorkPath(project.id, scene.id);
  fs.mkdirSync(dir, { recursive: true });
  const hash = sceneHash(scene, format, project);

  const srcPath = scene.image
    ? path.join(projectSourceDir(project.id), scene.image)
    : path.join(projectSourceDir(project.id), (project.images[0] || {}).file || '');
  if (!fs.existsSync(srcPath)) throw new Error('Image source introuvable pour la scene ' + scene.id);

  // 1. Image normalisee (recadrage + format)
  const imagePath = path.join(dir, 'image.jpg');
  await prepareSceneImage(srcPath, scene.crop, format, imagePath);

  // 2. Voix (si dialogue)
  let audioPath = null;
  let voiceDuration = 0;
  let voiceSource = null;
  const dialogue = (scene.dialogue || '').trim();
  if (dialogue) {
    const voiceId = resolveVoice(project, scene);
    const res = await synthesize(dialogue, voiceId, null, {
      pathFor: (provider) => voiceFilePath(dir, voiceId, dialogue, provider),
    });
    audioPath = res.path;
    voiceSource = res.source;
    voiceDuration = await mediaDuration(audioPath);
    if (!voiceDuration) throw new Error('Audio de voix illisible pour la scene ' + scene.id);
  }

  // 3. Duree : voix + pause, jamais de coupe en pleine phrase
  const duration = Number(scene.durationOverride) > 0
    ? Number(scene.durationOverride)
    : dialogue
      ? voiceDuration + PAUSE_AFTER_VOICE
      : AMBIANCE_DURATION;

  // 4. Animation : IA si disponible, sinon mouvement leger
  const videoPath = path.join(dir, 'video.mp4');
  let usedAI = false;
  if (aiAvailable() && !scene.forceLightMotion) {
    try {
      const rawAI = path.join(dir, 'ai-raw.mp4');
      await generateSceneVideo({ imagePath, outPath: rawAI });
      await muxAudio({ videoPath: rawAI, audioPath, duration, format, outPath: videoPath });
      usedAI = true;
    } catch {
      // repli silencieux sur le mouvement leger, la scene est toujours produite
      await renderScene({ imagePath, audioPath, duration, format, motion: pickMotion(scene, index), outPath: videoPath });
    }
  } else {
    await renderScene({ imagePath, audioPath, duration, format, motion: pickMotion(scene, index), outPath: videoPath });
  }

  await assertPlayableVideo(videoPath);
  return {
    hash,
    image: imagePath,
    audio: audioPath,
    video: videoPath,
    duration,
    usedAI,
    voiceSource,
    voiceId: dialogue ? resolveVoice(project, scene) : null,
  };
}

// Generation complete : scenes une a une (erreurs isolees), puis montage.
// Les scenes dont le hash correspond et dont la video est valide sont sautees.
export async function runGeneration(project, onProgress) {
  const scenes = project.scenes || [];
  const okScenes = [];
  const failed = [];
  let processed = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const format = project.format || '9:16';
    const hash = sceneHash(scene, format, project);
    const videoPath = path.join(sceneWorkPath(project.id, scene.id), 'video.mp4');
    const prev = scene.generated;
    if (prev && prev.hash === hash && prev.duration > 0 && (await playable(videoPath))) {
      okScenes.push(scene);
      processed++;
      onProgress && onProgress({ processed, total: scenes.length, failed });
      continue;
    }
    try {
      scene.generated = await renderOneScene(project, scene, i);
      okScenes.push(scene);
    } catch (e) {
      scene.generated = { ...(scene.generated || {}), hash, error: String((e && e.message) || e) };
      failed.push({ sceneId: scene.id, error: String((e && e.message) || e) });
    }
    // Persistence apres CHAQUE scene : reprise possible a tout moment.
    saveProject(project);
    processed++;
    onProgress && onProgress({ processed, total: scenes.length, failed });
  }

  if (okScenes.length === 0) {
    throw new Error(
      'Aucune scene n a pu etre generee : ' + failed.map((f) => f.error).join(' | ')
    );
  }

  // Montage final avec les scenes reussies, dans l'ordre du storyboard.
  const srt = buildSRT(
    okScenes.map((s) => ({ id: s.id, text: s.dialogue, duration: s.generated.duration }))
  );
  const srtPath = path.join(projectOutputDir(project.id), 'sous-titres.srt');
  fs.mkdirSync(projectOutputDir(project.id), { recursive: true });
  fs.writeFileSync(srtPath, srt);

  const outPath = path.join(projectOutputDir(project.id), 'final.mp4');
  const musicPath =
    project.music && fs.existsSync(path.join(UPLOADS_DIR, project.music))
      ? path.join(UPLOADS_DIR, project.music)
      : null;
  await assembleFinal({
    sceneFiles: okScenes.map((s) => s.generated.video),
    srtPath,
    musicPath,
    outPath,
    workDir: projectWorkDir(project.id),
  });

  const totalDuration = okScenes.reduce((acc, s) => acc + s.generated.duration, 0);

  // Manifeste : trace de ce qui a reellement ete produit (ordre, voix, durees).
  let t = 0;
  const manifestScenes = okScenes.map((s) => {
    const entry = {
      id: s.id,
      image: s.image,
      dialogue: s.dialogue || '',
      characterId: s.characterId || null,
      voiceId: s.generated.voiceId || null,
      voiceSource: s.generated.voiceSource || null,
      start: Number(t.toFixed(3)),
      duration: Number(s.generated.duration.toFixed(3)),
    };
    t += s.generated.duration;
    return entry;
  });
  const voiceSources = [...new Set(manifestScenes.map((m) => m.voiceSource).filter(Boolean))];
  const manifest = {
    projectId: project.id,
    title: project.title,
    format: project.format || '9:16',
    tts: ttsConfig(),
    voiceSources,
    realVoice: voiceSources.length > 0 && !voiceSources.includes('test'),
    totalDuration: Number(totalDuration.toFixed(3)),
    scenes: manifestScenes,
    failed,
  };
  fs.writeFileSync(path.join(projectOutputDir(project.id), 'manifest.json'), JSON.stringify(manifest, null, 2));

  return {
    finalPath: outPath,
    srtPath,
    done: okScenes.length,
    failed,
    totalDuration,
    voiceSources,
    realVoice: manifest.realVoice,
  };
}
