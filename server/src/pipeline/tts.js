import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

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

export function voiceFilePath(workDir, voiceId, text) {
  const hash = crypto
    .createHash('sha256')
    .update(voiceId + '|' + text)
    .digest('hex')
    .slice(0, 16);
  return path.join(workDir, 'voice-' + hash + '.mp3');
}

export async function synthesize(text, voiceId, outPath) {
  if (!text || !text.trim()) throw new Error('Texte vide : rien a synthetiser');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  try {
    await tts.toFile(outPath, text);
  } catch (e) {
    throw new Error('Synthese vocale indisponible (reseau requis) : ' + (e && e.message ? e.message : e));
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 500) {
    throw new Error('Synthese vocale : fichier audio vide');
  }
  return outPath;
}
