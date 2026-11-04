import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildSRT, concatLine } from '../src/pipeline/assemble.js';
import { ttsConfig, voiceFilePath, synthesize, testToneDuration } from '../src/pipeline/tts.js';
import { sceneHash, resolveVoice } from '../src/pipeline/render.js';
import { orderRegions } from '../src/pipeline/analyze.js';
import { motionFilter, FORMATS } from '../src/pipeline/animate.js';
import { probe } from '../src/ffmpeg.js';

test('buildSRT : cues cumulees, scenes sans dialogue sautees mais comptees dans le temps', () => {
  const srt = buildSRT([
    { text: 'Un', duration: 2 },
    { text: '', duration: 1.5 },
    { text: 'Deux', duration: 3.25 },
  ]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:02,000\nUn\n\n2\n00:00:03,500 --> 00:00:06,750\nDeux\n\n');
});

test('concatLine : guillemets simples et apostrophes echappees', () => {
  assert.equal(concatLine("/tmp/a b/v.mp4"), "file '/tmp/a b/v.mp4'");
  assert.equal(concatLine("/tmp/l'ete/v.mp4"), "file '/tmp/l'\\''ete/v.mp4'");
});

test('ttsConfig : fournisseur par defaut, valeurs invalides ignorees, repli explicite', () => {
  assert.deepEqual(ttsConfig({}), { provider: 'edge', fallback: null });
  assert.deepEqual(ttsConfig({ TTS_PROVIDER: 'nimporte' }), { provider: 'edge', fallback: null });
  assert.deepEqual(ttsConfig({ TTS_PROVIDER: 'edge', TTS_FALLBACK: 'local' }), { provider: 'edge', fallback: 'local' });
  assert.deepEqual(ttsConfig({ TTS_PROVIDER: 'local', TTS_FALLBACK: 'local' }), { provider: 'local', fallback: null });
});

test('voiceFilePath : le fournisseur change le fichier ; l\'audio de test est identifiable', () => {
  const a = voiceFilePath('/w', 'v', 'bonjour', 'edge');
  const b = voiceFilePath('/w', 'v', 'bonjour', 'local');
  const c = voiceFilePath('/w', 'v', 'bonjour', 'test');
  assert.notEqual(a, b);
  assert.match(a, /\.mp3$/);
  assert.match(b, /\.wav$/);
  assert.match(path.basename(c), /^voice-TEST-/);
});

test('synthesize : texte vide refuse ; repli declare quand le premier fournisseur echoue', async () => {
  await assert.rejects(() => synthesize('  ', 'fr-FR-DeniseNeural', '/tmp/x.wav'), /Texte vide/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-tts-'));
  const r = await synthesize('Bonjour tout le monde', 'fr-FR-HenriNeural', null, {
    config: { provider: 'edge', fallback: 'test' },
    pathFor: (p) => voiceFilePath(dir, 'fr-FR-HenriNeural', 'Bonjour tout le monde', p),
    // pas de reseau garanti : si Edge repond, le test reste valable
  });
  assert.ok(['edge', 'test'].includes(r.source));
  assert.equal(r.real, r.source !== 'test');
  assert.ok(fs.statSync(r.path).size > 500);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('audio de test : duree proportionnelle au nombre de mots, fichier lisible', async () => {
  assert.equal(testToneDuration('un deux trois quatre'), 1.28);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-tts-'));
  const r = await synthesize('un deux trois quatre', 'fr-FR-DeniseNeural', null, {
    config: { provider: 'test', fallback: null },
    pathFor: (p) => voiceFilePath(dir, 'v', 'un deux trois quatre', p),
  });
  const info = await probe(r.path);
  assert.ok(Math.abs(parseFloat(info.format.duration) - 1.28) < 0.05);
  assert.equal(r.real, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('voix locale (eSpeak) : parole reelle, differente selon le personnage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-tts-'));
  const cfg = { provider: 'local', fallback: null };
  const f = await synthesize('Tu l’as vu, toi aussi ?', 'fr-FR-DeniseNeural', null, { config: cfg, pathFor: (p) => voiceFilePath(dir, 'f', 'x', p) });
  const m = await synthesize('Tu l’as vu, toi aussi ?', 'fr-FR-RemyMultilingualNeural', null, { config: cfg, pathFor: (p) => voiceFilePath(dir, 'm', 'x', p) });
  assert.equal(f.real, true);
  assert.notDeepEqual(fs.readFileSync(f.path), fs.readFileSync(m.path));
  assert.ok(parseFloat((await probe(f.path)).format.duration) > 0.8);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sceneHash / resolveVoice : le personnage attribue pilote la voix et invalide le rendu', () => {
  const project = { characters: [{ id: 'c1', name: 'Léa', voiceId: 'fr-FR-RemyMultilingualNeural' }] };
  const scene = { id: 's', image: 'a.png', dialogue: 'Salut', voiceId: 'fr-FR-DeniseNeural' };
  assert.equal(resolveVoice(project, scene), 'fr-FR-DeniseNeural');
  const h0 = sceneHash(scene, '9:16', project);
  const withChar = { ...scene, characterId: 'c1' };
  assert.equal(resolveVoice(project, withChar), 'fr-FR-RemyMultilingualNeural');
  assert.notEqual(sceneHash(withChar, '9:16', project), h0);
  assert.notEqual(sceneHash({ ...scene, dialogue: 'Salut !' }, '9:16', project), h0);
  assert.equal(sceneHash(scene, '9:16', project), h0);
});

test('orderRegions : occidental (gauche->droite) et manga (droite->gauche)', () => {
  const r = [{ x: 600, y: 0, w: 300, h: 300 }, { x: 0, y: 0, w: 300, h: 300 }, { x: 0, y: 400, w: 900, h: 300 }];
  assert.deepEqual(orderRegions(r, 'western').map((q) => q.x), [0, 600, 0]);
  assert.deepEqual(orderRegions(r, 'manga').map((q) => q.x), [600, 0, 0]);
});

test('motionFilter : mouvements legers, static sans filtre', () => {
  const f = FORMATS['9:16'];
  assert.equal(motionFilter('static', 3, f), null);
  for (const m of ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'ken-burns']) {
    assert.match(motionFilter(m, 3, f), /^zoompan=/);
  }
  assert.match(motionFilter('zoom-in', 3, f), /1\.15/);
});
