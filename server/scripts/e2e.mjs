// Test de bout en bout : planche -> analyse -> corrections -> voix -> MP4 + SRT.
// Utilise le point d'entree normal (node src/index.js) et l'API HTTP.
// Usage : node scripts/e2e.mjs [planche.png]
// Env   : E2E_OUT (dossier des artefacts), TTS_PROVIDER / TTS_FALLBACK,
//         E2E_REQUIRE_REAL_VOICE=1 pour refuser un audio de test.
import { spawn, execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { ffmpegPath, ffprobePath } from '../src/ffmpeg.js';
import { prepareSceneImage } from '../src/pipeline/animate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const board = path.resolve(process.argv[2] || path.join(serverDir, '../demo/planche-demo.png'));
const outDir = path.resolve(process.env.E2E_OUT || path.join(serverDir, '../e2e-out'));
const requireRealVoice = process.env.E2E_REQUIRE_REAL_VOICE === '1';
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });

// ---- Verite terrain de la planche de demonstration ----
const TRUTH = [
  { panel: { x: 40, y: 40, w: 920, h: 470 }, text: 'Minuit. La ville retient son souffle.', who: 'Narrateur' },
  { panel: { x: 40, y: 540, w: 540, h: 480 }, text: 'Tu l’as vu, toi aussi ?', who: 'Léa' },
  { panel: { x: 610, y: 540, w: 350, h: 480 }, text: '… Il vient de s’allumer.', who: 'Marc' },
  { panel: { x: 40, y: 1050, w: 920, h: 420 }, text: 'Alors, on y va.', who: 'Léa' },
];
const CHARACTERS = [
  { id: 'ch_narrateur', name: 'Narrateur', voiceId: 'fr-FR-HenriNeural' },
  { id: 'ch_lea', name: 'Léa', voiceId: 'fr-FR-DeniseNeural' },
  { id: 'ch_marc', name: 'Marc', voiceId: 'fr-FR-RemyMultilingualNeural' },
];
const BOARD_W = 1000;
const BOARD_H = 1500;

const checks = [];
const report = { board: path.relative(process.cwd(), board), startedAt: new Date().toISOString(), checks, info: {} };
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 256 * 1024 * 1024, encoding: opts.encoding || 'utf8' }, (err, stdout, stderr) =>
      err ? reject(new Error(bin + ' : ' + String(stderr).slice(-400))) : resolve({ stdout, stderr })
    );
  });
}
function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const norm = (t) => t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-zà-ÿ' ]/g, ' ').replace(/\s+/g, ' ').trim();
const sim = (a, b) => 1 - lev(norm(a), norm(b)) / Math.max(1, norm(a).length, norm(b).length);

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-e2e-'));
const port = await freePort();
const base = `http://127.0.0.1:${port}/api`;
const server = spawn(process.execPath, ['src/index.js'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function api(p, opts = {}) {
  const res = await fetch(base + p, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json', ...(opts.headers || {}) } : opts.headers,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${p} -> ${res.status} ${await res.text()}`);
  return res;
}
async function waitJob(id, label, timeoutMs = 600000) {
  const t0 = Date.now();
  for (;;) {
    const job = await (await api('/jobs/' + id)).json();
    if (job.status === 'done') return job;
    if (job.status === 'error') throw new Error(label + ' : ' + job.error);
    if (Date.now() - t0 > timeoutMs) throw new Error(label + ' : delai depasse');
    await new Promise((r) => setTimeout(r, 500));
  }
}

try {
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/voices'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    if (i === 79) throw new Error('Serveur injoignable : ' + serverLog);
  }
  const tts = await (await api('/tts')).json();
  report.info.tts = tts;
  console.log('Fournisseur de voix :', JSON.stringify(tts));

  // 1. Projet + import
  const project = await (await api('/projects', { method: 'POST', body: { title: 'Planche de demonstration', format: '9:16' } })).json();
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(board)], { type: 'image/png' }), path.basename(board));
  const up = await (await api(`/projects/${project.id}/images`, { method: 'POST', body: form })).json();
  check('import : une image acceptee', up.images.length === 1, up.images);

  // 2. Analyse (detection des cases + OCR existants)
  const aJob = await (await api(`/projects/${project.id}/analyze`, { method: 'POST' })).json();
  await waitJob(aJob.job.id, 'analyse');
  let p = await (await api(`/projects/${project.id}`)).json();
  check('analyse : 3 a 5 cases detectees', p.scenes.length >= 3 && p.scenes.length <= 5, p.scenes.length);
  check('analyse : une scene par case attendue', p.scenes.length === TRUTH.length, p.scenes.length);

  const centre = (s) => ({ x: s.crop.cx * BOARD_W, y: s.crop.cy * BOARD_H });
  const inPanel = (c, r) => c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h;
  const detectedOrder = p.scenes.map((s) => TRUTH.findIndex((t) => inPanel(centre(s), t.panel)));
  report.info.detectedOrder = detectedOrder;
  report.info.ocrBefore = p.scenes.map((s) => ({ ocr: s.dialogue, confidence: Math.round(s.ocrConfidence || 0) }));

  // 3. Corrections humaines avant rendu : ordre, texte, attribution
  const byTruth = new Map();
  p.scenes.forEach((s, i) => byTruth.set(detectedOrder[i], s));
  check('ordre : chaque case de la planche est couverte', TRUTH.every((_, i) => byTruth.has(i)), detectedOrder);
  const ocrSim = TRUTH.map((t, i) => Number(sim(byTruth.get(i).dialogue || '', t.text).toFixed(2)));
  report.info.ocrSimilarity = ocrSim;
  const orderWasWrong = detectedOrder.join() !== '0,1,2,3';
  const corrected = TRUTH.map((t, i) => {
    const s = byTruth.get(i);
    const ch = CHARACTERS.find((c) => c.name === t.who);
    return { ...s, dialogue: t.text, characterId: ch.id };
  });
  const saved = await (await api(`/projects/${project.id}/storyboard`, { method: 'PUT', body: { scenes: corrected, characters: CHARACTERS } })).json();
  p = saved;
  check('corrections : ordre, texte et personnages enregistres',
    p.scenes.map((s) => s.dialogue).join('|') === TRUTH.map((t) => t.text).join('|') &&
    p.scenes.map((s) => s.characterId).join() === ['ch_narrateur', 'ch_lea', 'ch_marc', 'ch_lea'].join(),
    { orderWasWrong, ocrSimilarityAvantCorrection: ocrSim });
  const bad = await fetch(base + `/projects/${project.id}/storyboard`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenes: [{ ...p.scenes[0], characterId: 'inconnu' }] }) });
  check('corrections : un personnage inconnu est refuse', bad.status === 400, bad.status);

  // 4. Generation (voix + montage)
  const gJob = await (await api(`/projects/${project.id}/generate`, { method: 'POST' })).json();
  const done = await waitJob(gJob.job.id, 'generation');
  report.info.generation = done.result;
  check('generation : aucune scene en echec', done.result.failed.length === 0, done.result.failed);
  check('generation : voix', done.result.voiceSources.length > 0, { sources: done.result.voiceSources, voixReelle: done.result.realVoice });
  if (requireRealVoice) check('generation : voix reelle exigee', done.result.realVoice, done.result.voiceSources);

  const mp4 = path.join(outDir, 'final.mp4');
  const srtFile = path.join(outDir, 'sous-titres.srt');
  fs.writeFileSync(mp4, Buffer.from(await (await api(`/projects/${project.id}/video/final`)).arrayBuffer()));
  fs.writeFileSync(srtFile, Buffer.from(await (await api(`/projects/${project.id}/subtitles`)).arrayBuffer()));
  p = await (await api(`/projects/${project.id}`)).json();
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'projects', project.id, 'output', 'manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 5. ffprobe : pistes, codecs, duree
  const probe = JSON.parse((await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', mp4])).stdout);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const st = probe.streams.find((s) => s.codec_type === 'subtitle');
  const dur = parseFloat(probe.format.duration);
  report.info.ffprobe = { format: probe.format.format_name, duration: dur, video: v && { codec: v.codec_name, profile: v.profile, width: v.width, height: v.height, fps: v.r_frame_rate, pix_fmt: v.pix_fmt }, audio: a && { codec: a.codec_name, sample_rate: a.sample_rate, channels: a.channels }, subtitle: st && st.codec_name };
  check('ffprobe : piste video H.264', v && v.codec_name === 'h264', v && v.codec_name);
  check('ffprobe : piste audio AAC', a && a.codec_name === 'aac', a && a.codec_name);
  check('ffprobe : piste de sous-titres embarquee', !!st, st && st.codec_name);
  check('ffprobe : format 9:16 (1080x1920)', v && v.width === 1080 && v.height === 1920, v && [v.width, v.height]);
  check('ffprobe : duree = somme des scenes (+-0.3 s)', Math.abs(dur - manifest.totalDuration) <= 0.3, { dur, attendu: manifest.totalDuration });
  check('ffprobe : duree lisible (>= 8 s)', dur >= 8, dur);

  // 6. SRT : cues alignees sur les scenes, texte = dialogue corrige
  const cues = fs.readFileSync(srtFile, 'utf8').trim().split(/\n\n+/).map((blk) => {
    const [, time, ...text] = blk.split('\n');
    const m = time.match(/(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)/);
    const sec = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    return { start: sec(...m.slice(1, 5)), end: sec(...m.slice(5, 9)), text: text.join(' ') };
  });
  check('srt : une cue par dialogue', cues.length === TRUTH.length, cues.length);
  check('srt : textes = dialogues corriges', cues.every((c, i) => c.text === TRUTH[i].text), cues.map((c) => c.text));
  const m0 = manifest.scenes;
  check('srt : debut/fin alignes sur les scenes (+-50 ms)', cues.every((c, i) => Math.abs(c.start - m0[i].start) < 0.05 && Math.abs(c.end - (m0[i].start + m0[i].duration)) < 0.05), cues.map((c) => [c.start, c.end]));
  check('srt : cues ordonnees sans chevauchement', cues.every((c, i) => c.end > c.start && (i === 0 || c.start >= cues[i - 1].end - 1e-3)));
  check('srt : derniere cue termine avec la video (+-0.3 s)', Math.abs(cues[cues.length - 1].end - dur) <= 0.3, [cues[cues.length - 1].end, dur]);

  // 7. Lecture reelle : images au milieu de chaque scene, comparees a la case attendue
  const refs = [];
  for (let i = 0; i < p.scenes.length; i++) {
    const rp = path.join(outDir, 'frames', `ref-${i + 1}.png`);
    await prepareSceneImage(path.join(dataDir, 'projects', project.id, 'source', p.scenes[i].image), p.scenes[i].crop, '9:16', rp);
    refs.push(await sharp(rp).resize(24, 42, { fit: 'fill' }).removeAlpha().raw().toBuffer());
  }
  const diff = (x, y) => x.reduce((acc, v, k) => acc + Math.abs(v - y[k]), 0) / x.length;
  const frameMatch = [];
  for (let i = 0; i < m0.length; i++) {
    const t = m0[i].start + m0[i].duration / 2;
    const fp = path.join(outDir, 'frames', `scene-${i + 1}.png`);
    await run(ffmpegPath, ['-y', '-ss', t.toFixed(3), '-i', mp4, '-frames:v', '1', fp]);
    const fb = await sharp(fp).resize(24, 42, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const d = refs.map((r) => diff(fb, r));
    frameMatch.push({ scene: i + 1, t: Number(t.toFixed(2)), best: d.indexOf(Math.min(...d)) + 1, distances: d.map((x) => Number(x.toFixed(1))) });
  }
  report.info.frameMatch = frameMatch;
  check('lecture : l\'image de chaque scene correspond a sa case (ordre des cases)', frameMatch.every((f) => f.best === f.scene), frameMatch.map((f) => f.best));
  check('lecture : cases dans l\'ordre de lecture de la planche', byTruth.size === 4 && [0, 1, 2, 3].every((i) => p.scenes[i].id === byTruth.get(i).id));

  // 8. Audio : la voix de chaque scene demarre au debut de la scene et se termine avant la suivante
  const pcm = (await run(ffmpegPath, ['-v', 'error', '-i', mp4, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { encoding: 'buffer' })).stdout;
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const win = 320; // 20 ms
  const rms = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let k = 0; k < win; k++) s += samples[i + k] * samples[i + k];
    rms.push(Math.sqrt(s / win) / 32768);
  }
  const peak = Math.max(...rms);
  const thr = Math.max(0.004, peak * 0.05);
  const voiced = rms.map((r) => r > thr);
  const audioSync = m0.map((sc) => {
    const w0 = Math.floor(sc.start / 0.02), w1 = Math.min(voiced.length, Math.floor((sc.start + sc.duration) / 0.02));
    let first = -1, last = -1;
    for (let w = w0; w < w1; w++) if (voiced[w]) { if (first < 0) first = w; last = w; }
    return {
      scene: m0.indexOf(sc) + 1,
      onset: first < 0 ? null : Number((first * 0.02 - sc.start).toFixed(2)),
      end: last < 0 ? null : Number(((last + 1) * 0.02 - sc.start).toFixed(2)),
      duration: sc.duration,
    };
  });
  report.info.audioSync = audioSync;
  check('audio : de la parole/du son dans chaque scene', audioSync.every((s) => s.onset !== null), audioSync);
  check('audio : la voix demarre dans les 0,40 s qui suivent le debut de scene', audioSync.every((s) => s.onset !== null && s.onset <= 0.4), audioSync.map((s) => s.onset));
  check('audio : la voix finit avant la fin de scene (pause conservee)', audioSync.every((s) => s.end !== null && s.end <= s.duration - 0.1), audioSync.map((s) => [s.end, s.duration]));
  check('audio : la voix couvre l\'essentiel de la scene', audioSync.every((s) => s.end !== null && (s.end - s.onset) >= (s.duration - 0.45) * 0.5), audioSync.map((s) => [s.onset, s.end]));
  check('audio : voix distinctes par personnage', new Set(m0.map((s) => s.voiceId)).size === 3, m0.map((s) => s.voiceId));

  report.info.voice = { sources: manifest.voiceSources, real: manifest.realVoice };
} catch (e) {
  check('execution du test', false, String((e && e.message) || e));
} finally {
  server.kill();
  report.finishedAt = new Date().toISOString();
  report.passed = checks.every((c) => c.ok);
  report.serverLogTail = serverLog.split('\n').slice(-8);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(report.passed ? '\nE2E OK' : '\nE2E ECHEC');
  console.log('Artefacts :', outDir);
  process.exit(report.passed ? 0 : 1);
}
