# Panel to Motion

Transforme automatiquement des planches de bande dessinee en videos animees (cible ~60 s) avec dialogues synthétises, montage et export MP4.

## Parcours

Importer -> Verifier -> Generer

1. Import d'images (JPG, PNG, WebP) ou de PDF (converti via poppler).
2. Analyse : detection des cases (XY-cut), des bulles (composantes claires) et OCR francais (Tesseract). Ordre de lecture occidental ou manga.
3. Storyboard editable : dialogues, personnages, voix, durees, recadrages, ordre (reordonner / dupliquer / fusionner / supprimer / ajouter).
4. Generation : voix de synthese gratuites, animation "mouvement leger" (zoom, pan, ken-burns) via FFmpeg, montage final avec musique facultative (ducking), normalisation du volume, sous-titres SRT embarques.
5. Export MP4 H.264 + AAC, formats 9:16, 16:9, 1:1. Lecture integree + telechargements (clip final, SRT, chaque scene).

## Ce qui fonctionne sans aucune cle payante

- Chaine complete : import -> storyboard -> voix (msedge-tts, endpoint Microsoft Edge gratuit, reseau requis) -> mouvement leger (FFmpeg local) -> montage -> MP4 telechargeable.
- Reprise apres interruption : chaque scene est rendue independamment avec un hash d'entrees ; les scenes deja produites et valides sont sautees.
- Regeneration d'une seule scene sans toucher aux autres.
- Parcours manuel : si l'analyse automatique echoue, chaque scene reste editable a la main (image, recadrage, dialogue).

## Ce qui exige une cle externe

- Animation IA image-vers-video (moteur interchangeable, Replicate / Stable Video Diffusion par defaut) : definir `REPLICATE_API_TOKEN`. Si le moteur echoue ou est absent, repli automatique sur le mouvement leger. Voir `docs/PROVIDERS.md` (couts, quotas, limites).
- Aucune autre fonction ne necessite de service externe. L'OCR et la synthese vocale sont gratuits.

## Reste a developper

- Suppression des bulles avec reconstruction du fond (inpainting) : option prevue, non integree.
- Synchronisation labiale : option avancee, non integree.
- Attribution automatique du personnage parlant : a ce jour, choix manuel par scene.

## Architecture

Backend unique Node.js 20 / Express, FFmpeg local, stockage fichier durable par projet (JSON + medias), file de traitements persistee (`jobs.json`) avec statuts et reprise au redemarrage. Les cles API restent cote serveur (`server/.env`, jamais exposes au frontend). PWA mobile-first (responsive, utilisable sur Android).

Choix : un seul service sans base de donnees garde le deploiement trivial (Docker ou Node), le stockage JSON par projet suffit pour le MVP, et le rendu FFmpeg "mouvement leger" garantit un premier clip sans service payant.

## Installation (Node 20+)

    # Prerequis : FFmpeg et poppler (pdftoppm) installes
    cd server
    cp .env.example .env
    npm install
    npm start

Ouvrir http://localhost:3000

## Installation (Docker, recommande)

    docker compose up -d --build

FFmpeg et poppler sont inclus dans l'image. Les donnees persistent dans `./data`.

## Variables d'environnement

Voir `server/.env.example` : `PORT`, `DATA_DIR`, `MAX_UPLOAD_MB`, `VIDEO_AI_PROVIDER`, `REPLICATE_API_TOKEN`, `REPLICATE_VIDEO_MODEL`.

## Demo reproductible : planche -> MP4 + SRT

La planche de demonstration `demo/planche-demo.png` (4 cases, 3 personnages) est un dessin
original, libre de droits (CC0) ; `node demo/make-board.mjs` la regenere.

Depuis un clone propre (Node 22, FFmpeg et ffprobe installes) :

    git clone https://github.com/cortexAI-2025/panel-to-motion && cd panel-to-motion
    git checkout feat/v1-planche-to-mp4
    cd server && npm ci --ignore-scripts
    FFMPEG_PATH=$(which ffmpeg) FFPROBE_PATH=$(which ffprobe) \
      TTS_PROVIDER=local E2E_OUT=$PWD/../e2e-out npm run e2e

La commande demarre le serveur par son point d'entree normal (`node src/index.js`), puis, par
l'API : importe la planche, lance l'analyse (cases + OCR), corrige l'ordre / le texte / l'attribution
des personnages, genere les voix et le montage, puis controle le resultat (ffprobe : H.264 + AAC +
piste de sous-titres, duree, SRT, image de chaque scene, voix scene par scene). Sortie dans
`e2e-out/` : `final.mp4`, `sous-titres.srt`, `manifest.json`, `report.json`, `frames/`.

### Fournisseurs de voix (`TTS_PROVIDER`)

| Valeur | Voix | Reseau |
|---|---|---|
| `edge` (defaut) | voix neuronales Microsoft Edge, 7 voix francaises | requis |
| `local` | synthese eSpeak (meSpeak), robotique mais reelle | non |
| `test` | **audio de test** (bips, pas de parole) pour valider le montage seul | non |

`TTS_FALLBACK=local|test` autorise un repli explicite si le premier fournisseur echoue. Le fournisseur
reellement utilise est consigne par scene dans `output/manifest.json` (`voiceSource`, `realVoice`) :
un audio de test n'est jamais presente comme une voix generee. meSpeak (GPL) est une dependance
optionnelle.

### Corriger avant le rendu

Etape 2 de l'interface : texte de chaque bulle, ordre (↑ ↓, dupliquer, fusionner, supprimer),
personnages (nom + voix) et attribution de chaque replique au personnage qui parle.

### CI

`.github/workflows/ci.yml` : tests unitaires, puis la demo ci-dessus (voix locale, hors ligne).
Artefacts : `demo-mp4-srt-voix-locale` (MP4, SRT, rapport, images) et, si le reseau Microsoft
repond, `demo-mp4-srt-voix-edge`.

## Tests de validation

Suivre la checklist `docs/VALIDATION.md` : d'abord 2 scenes, puis une planche de 8 a 12 scenes ; verifier son synchronise, ordre des scenes, lecture sur Android, reprise apres erreur, regeneration d'une scene, telechargements reels.
