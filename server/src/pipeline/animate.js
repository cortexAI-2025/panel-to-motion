import path from 'path';
import sharp from 'sharp';
import { runFFmpeg } from '../ffmpeg.js';

export const FORMATS = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
};

export const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'ken-burns', 'static'];

function clamp01(v) {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

// Recadrage normalise (cx, cy, cw, ch en fractions de l'image source) puis mise
// au format cible. Si la case a des proportions proches du format, elle remplit
// l'image ("cover") ; sinon elle est montree ENTIERE, centree sur un fond flou
// issu du meme dessin, pour que ni la bulle ni le dessin ne soient coupes.
export async function prepareSceneImage(srcPath, crop, format, outPath) {
  const f = FORMATS[format] || FORMATS['9:16'];
  let pipeline = sharp(srcPath).rotate();
  if (crop && crop.cw > 0 && crop.ch > 0) {
    const meta = await sharp(srcPath).metadata();
    const cw = clamp01(crop.cw);
    const ch = clamp01(crop.ch);
    let width = Math.max(8, Math.round(cw * meta.width));
    let height = Math.max(8, Math.round(ch * meta.height));
    let left = Math.round((clamp01(crop.cx) - cw / 2) * meta.width);
    let top = Math.round((clamp01(crop.cy) - ch / 2) * meta.height);
    left = Math.min(Math.max(0, left), Math.max(0, meta.width - width));
    top = Math.min(Math.max(0, top), Math.max(0, meta.height - height));
    width = Math.min(width, meta.width - left);
    height = Math.min(height, meta.height - top);
    pipeline = pipeline.extract({ left, top, width, height });
  }
  let cropped = await pipeline.png().toBuffer();
  // Les marges blanches (gouttieres) incluses dans la case sont retirees.
  const corner = await sharp(cropped).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  if (corner[0] > 245 && corner[1] > 245 && corner[2] > 245) {
    try {
      cropped = await sharp(cropped).trim({ background: '#ffffff', threshold: 12 }).png().toBuffer();
    } catch {
      /* image entierement blanche : on garde le recadrage tel quel */
    }
  }
  const cm = await sharp(cropped).metadata();
  const ratio = cm.width / cm.height / (f.w / f.h);
  if (ratio > 0.8 && ratio < 1.25) {
    await sharp(cropped).resize(f.w, f.h, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toFile(outPath);
    return outPath;
  }
  const bg = await sharp(cropped)
    .resize(f.w, f.h, { fit: 'cover', position: 'centre' })
    .blur(28)
    .modulate({ brightness: 0.55 })
    .toBuffer();
  const fg = await sharp(cropped).resize(f.w, f.h, { fit: 'inside' }).toBuffer();
  await sharp(bg)
    .composite([{ input: fg, gravity: 'centre' }])
    .jpeg({ quality: 92 })
    .toFile(outPath);
  return outPath;
}

// Filtre zoompan correspondant au mouvement demande.
export function motionFilter(kind, duration, f) {
  const fps = 25;
  const frames = Math.max(2, Math.round(duration * fps));
  const size = f.w + 'x' + f.h;
  const cx = 'iw/2-(iw/zoom/2)';
  const cy = 'ih/2-(ih/zoom/2)';
  switch (kind) {
    case 'zoom-in':
      return `zoompan=z='min(zoom+0.0006,1.15)':x='${cx}':y='${cy}':d=${frames}:s=${size}:fps=${fps}`;
    case 'zoom-out':
      return `zoompan=z='if(lte(on,1),1.15,max(1.15-0.0006*on,1.001))':x='${cx}':y='${cy}':d=${frames}:s=${size}:fps=${fps}`;
    case 'pan-left':
      return `zoompan=z='1.12':x='(iw-iw/zoom)*(1-on/${frames})':y='${cy}':d=${frames}:s=${size}:fps=${fps}`;
    case 'pan-right':
      return `zoompan=z='1.12':x='(iw-iw/zoom)*(on/${frames})':y='${cy}':d=${frames}:s=${size}:fps=${fps}`;
    case 'ken-burns':
      return `zoompan=z='min(zoom+0.0005,1.12)':x='(iw-iw/zoom)*(on/${frames})':y='(ih-ih/zoom)*(on/${frames})':d=${frames}:s=${size}:fps=${fps}`;
    default:
      return null; // 'static'
  }
}

// Rend une scene : image fixe animee + audio (voix) ou silence.
export async function renderScene({ imagePath, audioPath, duration, format, motion, outPath }) {
  const f = FORMATS[format] || FORMATS['9:16'];
  duration = Math.max(0.5, duration);
  const args = ['-y', '-loop', '1', '-i', imagePath];
  const mf = motionFilter(motion, duration, f);
  let videoChain;
  if (mf) {
    videoChain = `scale=${f.w * 2}:${f.h * 2}:force_original_aspect_ratio=increase,crop=${f.w * 2}:${f.h * 2},${mf},format=yuv420p`;
  } else {
    videoChain = `scale=${f.w}:${f.h}:force_original_aspect_ratio=increase,crop=${f.w}:${f.h},format=yuv420p`;
  }
  let filterComplex = `[0:v]${videoChain}[v]`;
  let maps;
  if (audioPath) {
    args.push('-i', audioPath);
    filterComplex += `;[1:a]apad=whole_dur=${duration}[a]`;
    maps = ['-map', '[v]', '-map', '[a]'];
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
    filterComplex += `;[1:a]atrim=0:${duration}[a]`;
    maps = ['-map', '[v]', '-map', '[a]'];
  }
  args.push(
    '-filter_complex', filterComplex,
    ...maps,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '25',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-t', String(duration),
    '-movflags', '+faststart',
    outPath
  );
  await runFFmpeg(args);
  return outPath;
}

// Mux d'un clip video (IA) avec l'audio de la scene, duree exacte imposee.
export async function muxAudio({ videoPath, audioPath, duration, format, outPath }) {
  const f = FORMATS[format] || FORMATS['9:16'];
  const args = ['-y', '-i', videoPath];
  let filterComplex;
  let maps;
  if (audioPath) {
    args.push('-i', audioPath);
    filterComplex = `[0:v]scale=${f.w}:${f.h}:force_original_aspect_ratio=increase,crop=${f.w}:${f.h},fps=25,format=yuv420p[v];[1:a]apad=whole_dur=${duration}[a]`;
    maps = ['-map', '[v]', '-map', '[a]'];
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
    filterComplex = `[0:v]scale=${f.w}:${f.h}:force_original_aspect_ratio=increase,crop=${f.w}:${f.h},fps=25,format=yuv420p[v];[1:a]atrim=0:${duration}[a]`;
    maps = ['-map', '[v]', '-map', '[a]'];
  }
  args.push(
    '-filter_complex', filterComplex,
    ...maps,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-t', String(duration),
    '-movflags', '+faststart',
    outPath
  );
  await runFFmpeg(args);
  return outPath;
}
