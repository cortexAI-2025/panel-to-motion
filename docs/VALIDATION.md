# Checklist de validation

## Etape 1 : deux scenes

1. Importer une planche simple (2 cases avec bulles).
2. Verifier l'ordre de lecture et le texte extrait ; corriger un dialogue.
3. Generer : la video finale dure la somme des voix + pauses ; son present et synchronise (regarder la scene 1 : la voix commence des la premiere image).
4. Telecharger le MP4 : lecture sur Android (VLC ou lecteur natif), format 9:16.
5. Telecharger l'audio et la video d'une scene individuellement : fichiers reels non vides.

## Etape 2 : planche de 8 a 12 scenes

1. Verifier l'ordre des scenes et le total estime (~60 s).
2. Inclure une case sans dialogue : elle devient une scene d'ambiance.
3. Ajouter une musique : le volume doit baisser pendant les dialogues (ducking).
4. Sous-titres : activer la piste dans le lecteur, ordre et timing corrects.

## Fiabilite

1. Reprise : relancer le serveur pendant une generation ; au redemarrage, `POST /api/jobs/:id/resume` termine le travail sans refaire les scenes deja produites.
2. Erreur isolee : une scene en erreur ne doit pas empecher le montage des autres ; la regeneration ne refait que cette scene.
3. Modification d'un dialogue : seuls la voix et la video de cette scene, puis le montage final, sont refaits (hash d'entrees par scene).
4. Le statut "termine" n'est jamais pose si le MP4 final n'existe pas ou n'est pas lisible (son + video verifies par ffprobe).
