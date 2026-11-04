import { execFile } from 'child_process';
import { existsSync } from 'fs';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// Binaire : variable d'environnement > binaire npm s'il est present > PATH systeme.
function resolveBin(envName, npmPath, systemName) {
  if (process.env[envName]) return process.env[envName];
  if (npmPath && existsSync(npmPath)) return npmPath;
  return systemName;
}

export const ffmpegPath = resolveBin('FFMPEG_PATH', ffmpegStatic, 'ffmpeg');
export const ffprobePath = resolveBin('FFPROBE_PATH', ffprobeStatic && ffprobeStatic.path, 'ffprobe');

export function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || '').split('\n').slice(-6).join(' ').trim();
        reject(new Error('FFmpeg a echoue : ' + tail));
      } else {
        resolve(stdout);
      }
    });
  });
}

export function probe(file) {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error('ffprobe a echoue sur ' + file));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('ffprobe : reponse illisible pour ' + file)); }
      }
    );
  });
}

export async function mediaDuration(file) {
  const p = await probe(file);
  const d = parseFloat(p.format && p.format.duration);
  return Number.isFinite(d) ? d : 0;
}

// Garde-fou : le statut "termine" n'est pose que si le fichier est
// reellement lisible, avec une piste video ET une piste audio.
export async function assertPlayableVideo(file) {
  const p = await probe(file);
  const streams = p.streams || [];
  const hasVideo = streams.some((s) => s.codec_type === 'video');
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  const duration = parseFloat(p.format && p.format.duration);
  if (!hasVideo) throw new Error('Piste video absente dans ' + file);
  if (!hasAudio) throw new Error('Piste audio absente dans ' + file);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Duree invalide pour ' + file);
  return { duration };
}

export async function isPlayable(file) {
  try {
    await assertPlayableVideo(file);
    return true;
  } catch {
    return false;
  }
}
