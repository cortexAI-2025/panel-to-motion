import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { runFFmpeg } from '../ffmpeg.js';

const require = createRequire(import.meta.url);

// Voix francaises gratuites via l'endpoint Microsoft Edge.
export const FRENCH_VOICES = [
  { id: 'fr-FR-DeniseNeural', name: 'Denise (femme douce)' },
  { id: 'fr-FR-ElopeNeural', name: 'Elope (femme)' },
  { id: 'fr-FR-VivienneMultilingualNeural', name: 'Vivienne (femme)' },
  { id: 'fr-FR-RemyMultilingualNeural', name: 'Remy (homme)' },
  { id: 'fr-FR-AliceMultilingualNeural', name: 'Alice (femme)' },
  { id: 'fr-FR-ClaudeMultilingualNeural', name: 'Claude (homme)' },
  { id: 'fr-FR-HenriNeural', name: 'Henri (homme)' },
];

const MALE = /Remy|Claude|Henri/;

// Fournisseurs de voix :
//  - edge  : voix neuronales Microsoft Edge (reseau requis) ; defaut.
//  - local : synthese eSpeak (meSpeak) hors ligne, voix reelle mais robotique.
//  - test  : audio de TEST (bips) qui ne contient PAS de parole ; sert a valider
//            le montage quand aucune synthese vocale n'est disponible.
export const TTS_PROVIDERS = ['edge', 'local', 'test'];

export function ttsConfig(env = process.env) {
  const provider = TTS_PROVIDERS.includes(env.TTS_PROVIDER) ? env.TTS_PROVIDER : 'edge';
  const fb = env.TTS_FALLBACK;
  const fallback = fb && fb !== provider && TTS_PROVIDERS.includes(fb) ? fb : null;
  return { provider, fallback };
}

export function voiceFilePath(workDir, voiceId, text, provider = 'edge') {
  const hash = crypto
    .createHash('sha256')
    .update(provider + '|' + voiceId + '|' + text)
    .digest('hex')
    .slice(0, 16);
  const ext = provider === 'edge' ? 'mp3' : 'wav';
  const prefix = provider === 'test' ? 'voice-TEST-' : 'voice-';
  return path.join(workDir, prefix + hash + '.' + ext);
}

async function synthEdge(text, voiceId, outPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  try {
    await tts.toFile(outPath, text);
  } catch (e) {
    throw new Error('Synthese vocale indisponible (reseau requis) : ' + (e && e.message ? e.message : e));
  }
}

let meSpeakInstance = null;
function loadMeSpeak() {
  if (meSpeakInstance) return meSpeakInstance;
  let meSpeak;
  try {
    meSpeak = require('mespeak');
  } catch {
    throw new Error('Voix locale indisponible : paquet mespeak non installe');
  }
  meSpeak.loadConfig(require('mespeak/src/mespeak_config.json'));
  meSpeak.loadVoice(require('mespeak/voices/fr.json'));
  meSpeakInstance = meSpeak;
  return meSpeak;
}

async function synthLocal(text, voiceId, outPath) {
  const meSpeak = loadMeSpeak();
  const variant = MALE.test(voiceId) ? 'm3' : 'f2';
  const data = meSpeak.speak(text, { rawdata: 'buffer', voice: 'fr', variant, speed: 150 });
  if (!data || !data.length) throw new Error('Voix locale : synthese vide');
  fs.writeFileSync(outPath, Buffer.from(data));
}

// Audio de test : une salve de bips par mot, hauteur propre a chaque voix.
export function testToneDuration(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.2, words * 0.32);
}

async function synthTest(text, voiceId, outPath) {
  const dur = testToneDuration(text);
  const hash = crypto.createHash('sha256').update(voiceId).digest();
  const freq = 220 + (hash[0] % 12) * 30;
  const expr = `sin(2*PI*${freq}*t)*0.35*lt(mod(t\\,0.32)\\,0.2)`;
  await runFFmpeg([
    '-y', '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=24000:d=${dur.toFixed(3)}`,
    '-ac', '1', '-c:a', 'pcm_s16le', outPath,
  ]);
}

const IMPL = { edge: synthEdge, local: synthLocal, test: synthTest };

// Synthetise un dialogue. Retourne { path, source, real } ou `source` est le
// fournisseur reellement utilise ; `real` est faux pour l'audio de test.
export async function synthesize(text, voiceId, outPathOrDir, opts = {}) {
  if (!text || !text.trim()) throw new Error('Texte vide : rien a synthetiser');
  const cfg = opts.config || ttsConfig();
  const chain = [cfg.provider, cfg.fallback].filter(Boolean);
  const errors = [];
  for (const provider of chain) {
    const out = opts.pathFor ? opts.pathFor(provider) : outPathOrDir;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (fs.existsSync(out) && fs.statSync(out).size >= 500) {
      return { path: out, source: provider, real: provider !== 'test', cached: true };
    }
    try {
      await IMPL[provider](text, voiceId, out);
      if (!fs.existsSync(out) || fs.statSync(out).size < 500) throw new Error('fichier audio vide');
      return { path: out, source: provider, real: provider !== 'test', cached: false };
    } catch (e) {
      errors.push(provider + ' : ' + (e && e.message ? e.message : e));
      fs.rmSync(out, { force: true });
    }
  }
  throw new Error('Synthese vocale : ' + errors.join(' | '));
}
