/* Panel to Motion - SPA vanilla, mobile-first */
const $ = (sel) => document.querySelector(sel);
const state = { project: null, voices: [] };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (opts.raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
  return data;
}

function showStep(n) {
  for (const id of ['step1', 'step2', 'step3']) $('#' + id).classList.add('hidden');
  $('#step' + n).classList.remove('hidden');
  window.scrollTo({ top: 0 });
}

function setStatus(sel, msg, isError) {
  const el = $(sel);
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

// ---------- Etape 1 : import ----------

$('#pick-files').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', () => uploadFiles($('#file-input').files));
const dz = $('#dropzone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('drag');
  uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(files) {
  if (!files || !files.length) return;
  try {
    if (!state.project) {
      state.project = await api('/projects', {
        method: 'POST',
        body: {
          title: $('#project-title').value || 'Planche sans titre',
          reading: $('#project-reading').value,
          format: $('#project-format').value,
          targetDuration: 60,
        },
      });
    } else {
      await api('/projects/' + state.project.id, {
        method: 'PUT',
        body: {
          title: $('#project-title').value || state.project.title,
          reading: $('#project-reading').value,
          format: $('#project-format').value,
        },
      });
    }
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    setStatus('#analyze-status', 'Import en cours…');
    const res = await fetch('/api/projects/' + state.project.id + '/images', {
      method: 'POST',
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import impossible');
    state.project.images = data.images;
    renderImportedList();
    $('#analyze-btn').disabled = false;
    setStatus('#analyze-status', data.images.length + ' image(s) importee(s)');
  } catch (e) {
    setStatus('#analyze-status', e.message, true);
  }
}

function renderImportedList() {
  const ul = $('#imported-list');
  ul.innerHTML = '';
  for (const img of (state.project && state.project.images) || []) {
    const li = document.createElement('li');
    li.textContent = img.file + ' (' + img.width + '×' + img.height + ')';
    ul.appendChild(li);
  }
}

$('#analyze-btn').addEventListener('click', async () => {
  if (!state.project) return;
  $('#analyze-btn').disabled = true;
  setStatus('#analyze-status', 'Analyse en cours : detection des cases, des bulles, OCR…');
  try {
    const { job } = await api('/projects/' + state.project.id + '/analyze', { method: 'POST' });
    await pollJob(job.id, (j) => {
      setStatus('#analyze-status', 'Analyse… (job ' + j.status + ')');
    });
    state.project = await api('/projects/' + state.project.id);
    setStatus('#analyze-status', '');
    renderStoryboard();
    showStep(2);
  } catch (e) {
    setStatus('#analyze-status', e.message, true);
  } finally {
    $('#analyze-btn').disabled = false;
  }
});

// ---------- Etape 2 : storyboard ----------

function estimateDuration(scene) {
  const d = (scene.dialogue || '').trim();
  if (scene.durationOverride > 0) return scene.durationOverride;
  if (d) return Math.max(1.2, d.length / 14) + 0.45;
  return 2.5;
}

function voiceSelect(value, onChange) {
  const sel = document.createElement('select');
  for (const v of state.voices) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    sel.appendChild(opt);
  }
  sel.value = value || state.voices[0].id;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// Personnages : un nom et une voix ; chaque scene peut etre attribuee a un personnage.
function renderCharacters() {
  const box = $('#characters');
  box.innerHTML = '';
  const chars = (state.project.characters = state.project.characters || []);
  chars.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'scene-row';
    const name = document.createElement('input');
    name.value = c.name;
    name.setAttribute('aria-label', 'Nom du personnage');
    name.addEventListener('change', () => { c.name = name.value.trim() || 'Personnage'; saveStoryboard(); });
    const del = document.createElement('button');
    del.className = 'btn small danger';
    del.textContent = 'retirer';
    del.addEventListener('click', () => {
      chars.splice(i, 1);
      state.project.scenes.forEach((s) => { if (s.characterId === c.id) s.characterId = null; });
      saveStoryboard();
    });
    row.append(name, voiceSelect(c.voiceId, (v) => { c.voiceId = v; saveStoryboard(); }), del);
    box.appendChild(row);
  });
}

function renderStoryboard() {
  const p = state.project;
  renderCharacters();
  const board = $('#storyboard');
  board.innerHTML = '';
  let total = 0;
  (p.scenes || []).forEach((scene, i) => {
    total += estimateDuration(scene);
    board.appendChild(sceneCard(scene, i));
  });
  const n = (p.scenes || []).length;
  $('#scene-count').textContent = n + ' scene' + (n > 1 ? 's' : '');
  $('#total-estimate').textContent = 'duree estimee : ' + Math.round(total) + ' s';
  $('#target-hint').textContent = '(cible ' + (p.targetDuration || 60) + ' s)';
}

function sceneCard(scene, i) {
  const card = document.createElement('div');
  card.className = 'scene-card' + (scene.generated && scene.generated.error ? ' error-outline' : '');

  const thumb = document.createElement('img');
  thumb.className = 'scene-thumb';
  thumb.src = '/api/projects/' + state.project.id + '/image/' + scene.image;
  thumb.loading = 'lazy';

  const fields = document.createElement('div');
  fields.className = 'scene-fields';

  const ta = document.createElement('textarea');
  ta.value = scene.dialogue || '';
  ta.placeholder = 'Dialogue (laisser vide pour une scene d ambiance)';
  ta.addEventListener('change', () => {
    scene.dialogue = ta.value;
    scene.ocrConfidence = 100; // texte verifie a la main : plus d'avertissement OCR
    saveStoryboard();
  });

  const row = document.createElement('div');
  row.className = 'scene-row';

  const speakerSel = document.createElement('select');
  speakerSel.setAttribute('aria-label', 'Qui parle');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Qui parle : voix de la scène';
  speakerSel.appendChild(none);
  for (const c of state.project.characters || []) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = 'Qui parle : ' + c.name;
    speakerSel.appendChild(opt);
  }
  speakerSel.value = scene.characterId || '';

  const voiceSel = voiceSelect(scene.voiceId, (v) => {
    scene.voiceId = v;
    saveStoryboard();
  });
  const speaker = (state.project.characters || []).find((c) => c.id === scene.characterId);
  if (speaker) { voiceSel.value = speaker.voiceId; voiceSel.disabled = true; voiceSel.title = 'Voix de ' + speaker.name; }
  speakerSel.addEventListener('change', () => {
    scene.characterId = speakerSel.value || null;
    saveStoryboard();
  });

  const preview = document.createElement('button');
  preview.className = 'btn small';
  preview.textContent = '▶ preecouter';
  preview.addEventListener('click', async () => {
    if (!ta.value.trim()) return;
    try {
      const res = await api('/projects/' + state.project.id + '/voice-preview', {
        method: 'POST',
        raw: true,
        body: { text: ta.value, voiceId: voiceSel.value },
      });
      const blob = await res.blob();
      new Audio(URL.createObjectURL(blob)).play();
    } catch (e) {
      alert(e.message);
    }
  });

  const motionSel = document.createElement('select');
  for (const m of ['auto', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'ken-burns', 'static']) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = 'mouvement : ' + m;
    motionSel.appendChild(opt);
  }
  motionSel.value = scene.motion || 'auto';
  motionSel.addEventListener('change', () => {
    scene.motion = motionSel.value === 'auto' ? null : motionSel.value;
    saveStoryboard();
  });

  const dur = document.createElement('input');
  dur.type = 'number';
  dur.min = '0';
  dur.step = '0.5';
  dur.title = 'Duree forcee (s), vide = auto';
  dur.placeholder = 'dur. s';
  dur.value = scene.durationOverride || '';
  dur.addEventListener('change', () => {
    scene.durationOverride = Number(dur.value) > 0 ? Number(dur.value) : null;
    saveStoryboard();
  });

  row.append(speakerSel, voiceSel, preview, motionSel, dur);
  fields.append(ta);

  if (scene.dialogue && (scene.ocrConfidence || 0) < 70) {
    const warn = document.createElement('div');
    warn.className = 'ocr-warn';
    warn.textContent = '⚠ texte illisible : verifiez le dialogue';
    fields.append(warn);
  }

  const actions = document.createElement('div');
  actions.className = 'scene-actions';
  const mkBtn = (label, fn, danger) => {
    const b = document.createElement('button');
    b.className = 'btn small' + (danger ? ' danger' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  actions.append(
    mkBtn('↑', () => moveScene(i, -1)),
    mkBtn('↓', () => moveScene(i, 1)),
    mkBtn('dupliquer', () => {
      state.project.scenes.splice(i + 1, 0, { ...scene, id: undefined, generated: null });
      saveStoryboard();
    }),
    mkBtn('fusionner ↓', () => mergeScene(i)),
    mkBtn('supprimer', () => { state.project.scenes.splice(i, 1); saveStoryboard(); }, true)
  );
  fields.append(row, actions);

  card.append(thumb, fields);
  return card;
}

function moveScene(i, dir) {
  const s = state.project.scenes;
  const j = i + dir;
  if (j < 0 || j >= s.length) return;
  [s[i], s[j]] = [s[j], s[i]];
  saveStoryboard();
}

function mergeScene(i) {
  const s = state.project.scenes;
  if (i + 1 >= s.length) return;
  s[i].dialogue = ((s[i].dialogue || '') + ' ' + (s[i + 1].dialogue || '')).trim();
  s.splice(i + 1, 1);
  saveStoryboard();
}

async function saveStoryboard() {
  try {
    state.project = await api('/projects/' + state.project.id + '/storyboard', {
      method: 'PUT',
      body: { scenes: state.project.scenes, characters: state.project.characters || [] },
    });
    renderStoryboard();
  } catch (e) {
    setStatus('#generate-status', e.message, true);
  }
}

$('#add-character').addEventListener('click', () => {
  const chars = (state.project.characters = state.project.characters || []);
  chars.push({ id: 'ch_' + Math.random().toString(16).slice(2, 10), name: 'Personnage ' + (chars.length + 1), voiceId: state.voices[0].id });
  saveStoryboard();
});

$('#add-scene').addEventListener('click', () => {
  const img = state.project.images[0];
  state.project.scenes.push({
    id: undefined,
    image: img ? img.file : null,
    crop: null,
    dialogue: '',
    voiceId: state.voices[0].id,
    motion: null,
    durationOverride: null,
    generated: null,
  });
  saveStoryboard();
});

$('#go-generate').addEventListener('click', () => showStep(3));

// ---------- Etape 3 : generation ----------

$('#music-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f || !state.project) return;
  const fd = new FormData();
  fd.append('file', f);
  const res = await fetch('/api/projects/' + state.project.id + '/music', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) return setStatus('#generate-status', data.error, true);
  $('#music-remove').hidden = false;
  setStatus('#generate-status', 'Musique ajoutee (ducking automatique pendant les dialogues)');
});

$('#music-remove').addEventListener('click', async () => {
  await api('/projects/' + state.project.id + '/music', { method: 'DELETE' });
  $('#music-remove').hidden = true;
  $('#music-input').value = '';
});

$('#generate-btn').addEventListener('click', async () => {
  if (!state.project || !state.project.scenes.length) return;
  $('#generate-btn').disabled = true;
  $('#generate-progress').classList.remove('hidden');
  try {
    const { job } = await api('/projects/' + state.project.id + '/generate', { method: 'POST' });
    await pollJob(job.id, (j) => {
      const pr = j.progress || { processed: 0, total: state.project.scenes.length };
      const pct = pr.total ? Math.round((pr.processed / pr.total) * 100) : 0;
      $('#progress-bar').style.width = pct + '%';
      $('#progress-label').textContent =
        'Scene ' + Math.min(pr.processed + 1, pr.total) + ' / ' + pr.total + ' (' + pct + '%)' +
        (pr.failed && pr.failed.length ? ' — ' + pr.failed.length + ' scene(s) en erreur (ignorees)' : '');
    });
    state.project = await api('/projects/' + state.project.id);
    showResult();
  } catch (e) {
    setStatus('#generate-status', e.message, true);
  } finally {
    $('#generate-btn').disabled = false;
  }
});

$('#assemble-again').addEventListener('click', async () => {
  try {
    const { job } = await api('/projects/' + state.project.id + '/assemble', { method: 'POST' });
    await pollJob(job.id, () => {});
    showResult();
  } catch (e) {
    setStatus('#generate-status', e.message, true);
  }
});

$('#back-step2').addEventListener('click', () => {
  renderStoryboard();
  showStep(2);
});

function showResult() {
  const id = state.project.id;
  $('#final-video').src = '/api/projects/' + id + '/video/final';
  $('#dl-final').href = '/api/projects/' + id + '/video/final';
  $('#dl-srt').href = '/api/projects/' + id + '/subtitles';
  $('#result').classList.remove('hidden');
  setStatus('#generate-status', 'Video prete. Verifiez le son et l ordre des scenes.');
}

// ---------- Jobs ----------

function pollJob(jobId, onUpdate) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const j = await api('/jobs/' + jobId);
        onUpdate(j);
        if (j.status === 'done') { clearInterval(timer); resolve(j); }
        if (j.status === 'error') { clearInterval(timer); reject(new Error(j.error || 'Job en erreur')); }
      } catch (e) {
        clearInterval(timer);
        reject(e);
      }
    }, 1500);
  });
}

// ---------- Init ----------

(async function init() {
  try {
    state.voices = await api('/voices');
  } catch {
    state.voices = [{ id: 'fr-FR-DeniseNeural', name: 'Denise' }];
  }
  // reprise d'un projet existant (dernier projet)
  try {
    const projects = await api('/projects');
    if (projects.length) {
      state.project = projects[0];
      $('#project-title').value = state.project.title;
      $('#project-reading').value = state.project.reading;
      $('#project-format').value = state.project.format;
      renderImportedList();
      if (state.project.images && state.project.images.length) $('#analyze-btn').disabled = false;
      if (state.project.scenes && state.project.scenes.length) {
        renderStoryboard();
        showStep(2);
      }
    }
  } catch { /* premier lancement */ }
})();
