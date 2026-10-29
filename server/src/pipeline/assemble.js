import fs from 'fs';
import path from 'path';
import { runFFmpeg, assertPlayableVideo } from '../ffmpeg.js';

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${f}`;
}

// sceneTimings : [{ id, text, duration }] dans l'ordre du montage.
export function buildSRT(sceneTimings) {
  let t = 0;
  let index = 1;
  let out = '';
  for (const sc of sceneTimings) {
    if (sc.text && sc.text.trim()) {
      out += `${index}\n`;
      out += `${srtTime(t)} --> ${srtTime(t + sc.duration)}\n`;
      out += String(sc.text).trim().replace(/\r/g, '') + '\n\n';
      index++;
    }
    t += sc.duration;
  }
  return out;
}

// Montage final : concat des scenes, normalisation du volume,
// musique facultative avec ducking (baisse pendant les dialogues),
// sous-titres SRT embarques en piste mov_text.
export async function assembleFinal({ sceneFiles, srtPath, musicPath, outPath, workDir }) {
  fs.mkdirSync(workDir, { recursive: true });
  const listFile = path.join(workDir, 'concat.txt');
  fs.writeFileSync(listFile, sceneFiles.map((p) => 'file ' + JSON.stringify(path.resolve(p))).join('\n'));

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', srtPath];
  let filter;
  if (musicPath) {
    args.push('-stream_loop', '-1', '-i', musicPath);
    filter =
      '[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[da];' +
      '[2:a]volume=0.35[m];' +
      '[m][da]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400[duck];' +
      '[da][duck]amix=inputs=2:duration=first:dropout_transition=0[a]';
  } else {
    filter = '[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]';
  }
  args.push(
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[a]', '-map', '1:s',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '160k',
    '-c:s', 'mov_text',
    '-metadata:s:s:0', 'language=fre',
    '-shortest',
    '-movflags', '+faststart',
    outPath
  );
  await runFFmpeg(args);
  // Garde-fou : le montage n'est valide que s'il est relisable.
  await assertPlayableVideo(outPath);
  return outPath;
}
