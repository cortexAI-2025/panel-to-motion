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

## Tests de validation

Suivre la checklist `docs/VALIDATION.md` : d'abord 2 scenes, puis une planche de 8 a 12 scenes ; verifier son synchronise, ordre des scenes, lecture sur Android, reprise apres erreur, regeneration d'une scene, telechargements reels.
