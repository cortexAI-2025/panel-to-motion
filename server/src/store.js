import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

export function ensureDirs() {
  for (const d of [PROJECTS_DIR, UPLOADS_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });
}
ensureDirs();

export function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

export function projectDir(id) {
  return path.join(PROJECTS_DIR, id);
}
export function projectSourceDir(id) {
  return path.join(projectDir(id), 'source');
}
export function projectWorkDir(id) {
  return path.join(projectDir(id), 'work');
}
export function projectOutputDir(id) {
  return path.join(projectDir(id), 'output');
}

export function ensureProjectDirs(id) {
  for (const d of [projectSourceDir(id), projectWorkDir(id), projectOutputDir(id)]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

// Ecriture atomique : jamais de project.json a moitie ecrit.
export function saveProject(project) {
  ensureProjectDirs(project.id);
  const file = path.join(projectDir(project.id), 'project.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2));
  fs.renameSync(tmp, file);
}

export function loadProject(id) {
  const file = path.join(projectDir(id), 'project.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function listProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR)
    .map((id) => {
      try { return loadProject(id); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// ---- File de jobs persistee ----
function loadJobs() {
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function getJobs() {
  return loadJobs();
}

export function getJob(id) {
  return loadJobs().find((j) => j.id === id) || null;
}

export function saveJob(job) {
  const jobs = loadJobs();
  const i = jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) jobs[i] = job;
  else jobs.push(job);
  const tmp = JOBS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, JOBS_FILE);
  return job;
}

// Au demarrage, les jobs d'une session precedente ne tournent plus :
// on les marque "interrupted" et resumables.
export function markInterruptedOnBoot() {
  const jobs = loadJobs();
  let changed = false;
  for (const j of jobs) {
    if (j.status === 'running' || j.status === 'queued') {
      j.status = 'interrupted';
      j.resumable = true;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
  }
}
