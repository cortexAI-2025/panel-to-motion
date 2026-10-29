# Fournisseurs externes

## Voix de synthese (gratuit)

`msedge-tts` utilise l'endpoint public de lecture a voix haute de Microsoft Edge. Gratuit, sans cle, mais requiert un acces reseau sortant. Si le service est indisponible, l'application le signale clairement ; l'utilisateur peut importer un enregistrement audio personnel par scene (meme format que la musique).

Voix francaises proposees : Denise, Elope, Vivienne, Remy, Alice, Claude, Henri (identifiants `fr-FR-...Neural`).

## Animation IA (optionnel, payant)

Fournisseur par defaut : Replicate, modele `stable-video-diffusion` (image vers video, ~4 s par clip 1024x576).

- Activer : `VIDEO_AI_PROVIDER=replicate` et `REPLICATE_API_TOKEN` dans `server/.env`.
- Couts indicatifs : comptage a la seconde sur Replicate, ordre de grandeur de quelques centimes par clip genere ; verifier le tarif actuel sur replicate.com avant usage.
- Quotas / limites : duree fixe ~4 s par clip (la scene est ensuite tronquee/padee a la duree reelle du dialogue), pas de controle de mouvement fin, la qualite depend de l'image source.
- En cas d'echec (quota, reseau, contenu refuse) : nouvelle tentative proposee, sinon repli automatique sur le mouvement leger. Le clip reste toujours produit.

Le moteur est interchangeable : implementer `generateSceneVideo` dans `server/src/pipeline/videoai.js` avec un autre fournisseur (Runway, Pika, etc.) sans toucher au reste.

## Ce qui n'utilise AUCUN service externe

Detection de cases et de bulles (sharp), OCR (tesseract.js, modele fra embarque), mouvement leger, montage, sous-titres, exports.
