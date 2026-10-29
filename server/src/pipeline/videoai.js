import fs from 'fs';
import { runFFmpeg, mediaDuration } from '../ffmpeg.js';

export function aiAvailable() {
  return (
    process.env.VIDEO_AI_PROVIDER === 'replicate' &&
    Boolean(process.env.REPLICATE_API_TOKEN)
  );
}

// Moteur IA optionnel (Replicate / Stable Video Diffusion).
// En cas d'echec, l'appelant replie sur le mouvement leger.
export async function generateSceneVideo({ imagePath, outPath }) {
  const token = process.env.REPLICATE_API_TOKEN;
  const model = process.env.REPLICATE_VIDEO_MODEL || 'stability-ai/stable-video-diffusion';
  const imageB64 = fs.readFileSync(imagePath).toString('base64');

  const createRes = await fetch(
    'https://api.replicate.com/v1/models/' + model + '/predictions',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({
        input: {
          input_image: 'data:image/jpeg;base64,' + imageB64,
          video_length: '25_frames_with_svd_xt',
          sizing_strategy: 'maintain_aspect_ratio',
          frames_per_second: 8,
        },
      }),
    }
  );
  if (!createRes.ok) {
    throw new Error('Replicate a refuse la requete (HTTP ' + createRes.status + ')');
  }
  let prediction = await createRes.json();

  const deadline = Date.now() + 10 * 60 * 1000;
  while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    if (Date.now() > deadline) throw new Error('Replicate : delai depasse');
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: 'Bearer ' + token },
    });
    prediction = await poll.json();
  }
  if (prediction.status !== 'succeeded' || !prediction.output || !prediction.output.length) {
    throw new Error('Replicate : generation echouee (' + prediction.status + ')');
  }

  const videoUrl = prediction.output[prediction.output.length - 1];
  const dl = await fetch(videoUrl);
  if (!dl.ok) throw new Error('Replicate : telechargement du clip impossible');
  const buf = Buffer.from(await dl.arrayBuffer());
  fs.writeFileSync(outPath, buf);

  const dur = await mediaDuration(outPath);
  if (!dur || dur < 0.5) throw new Error('Replicate : clip genere illisible');
  return outPath;
}
