// Genere la planche de demonstration (4 cases, 3 personnages) en PNG.
// Dessin original, libre de droits (CC0). Usage : node demo/make-board.mjs
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(path.join(here, '../server/package.json'))('sharp');

const F = 'DejaVu Sans, Verdana, sans-serif';
const bubble = (x, y, w, h, lines, tail) => `
  ${tail ? `<polygon points="${tail}" fill="#fff" stroke="#000" stroke-width="6" stroke-linejoin="round"/>` : ''}
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${tail ? 46 : 6}" fill="#fff" stroke="#000" stroke-width="6"/>
  ${tail ? `<polygon points="${tail}" fill="#fff"/>` : ''}
  ${lines.map((t, i) => `<text x="${x + w / 2}" y="${y + h / 2 + (i - (lines.length - 1) / 2) * 46 + 14}" font-family="${F}" font-weight="700" font-size="38" text-anchor="middle" fill="#000">${t}</text>`).join('')}`;

const stars = [[90,90],[180,150],[300,70],[420,130],[520,60],[640,110],[760,70],[880,140],[930,60],[70,230],[350,230],[700,210]]
  .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#9aa4c0"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500">
<defs>
  <clipPath id="a"><rect x="40" y="40" width="920" height="470"/></clipPath>
  <clipPath id="b"><rect x="40" y="540" width="540" height="480"/></clipPath>
  <clipPath id="c"><rect x="610" y="540" width="350" height="480"/></clipPath>
  <clipPath id="d"><rect x="40" y="1050" width="920" height="420"/></clipPath>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b132b"/><stop offset="1" stop-color="#27346a"/></linearGradient>
  <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2541"/><stop offset="1" stop-color="#5b3a6b"/></linearGradient>
</defs>
<rect width="1000" height="1500" fill="#fff"/>

<!-- Case 1 : la ville -->
<g clip-path="url(#a)">
  <rect x="40" y="40" width="920" height="470" fill="url(#sky)"/>${stars}
  <circle cx="800" cy="150" r="62" fill="#b9b4a0"/><circle cx="780" cy="132" r="11" fill="#a29d89"/><circle cx="820" cy="172" r="15" fill="#a29d89"/>
  <path d="M40 510 V340 h70 v-60 h60 v90 h60 v-120 h50 v120 h70 v-40 h60 v70 h60 v-150 h50 v150 h80 v-70 h70 v50 h60 v-110 h50 v110 h80 v-40 h70 V510Z" fill="#161b33"/>
  <path d="M40 510 V420 h100 v-70 h80 v70 h60 v-90 h70 v90 h110 v-50 h90 v50 h90 v-80 h60 v80 h90 v-40 h90 V510Z" fill="#05060f"/>
  <g fill="#ffb703"><rect x="62" y="436" width="14" height="20"/><rect x="104" y="458" width="14" height="20"/><rect x="170" y="392" width="14" height="20"/><rect x="262" y="372" width="14" height="20"/><rect x="302" y="440" width="14" height="20"/><rect x="498" y="420" width="14" height="20"/><rect x="662" y="400" width="14" height="20"/><rect x="740" y="452" width="14" height="20"/></g>
  <g fill="#e63946"><rect x="598" y="438" width="14" height="20"/></g>
  ${bubble(70, 66, 410, 130, ['Minuit. La ville', 'retient son souffle.'], null)}
</g>
<rect x="40" y="40" width="920" height="470" fill="none" stroke="#000" stroke-width="8"/>

<!-- Case 2 : le toit -->
<g clip-path="url(#b)">
  <rect x="40" y="540" width="540" height="480" fill="url(#dusk)"/>
  <circle cx="440" cy="700" r="120" fill="#a9a3c2"/>
  <rect x="40" y="900" width="540" height="120" fill="#05060f"/><rect x="40" y="880" width="540" height="10" fill="#05060f"/>
  <g fill="#05060f"><rect x="80" y="880" width="10" height="30"/><rect x="200" y="880" width="10" height="30"/><rect x="320" y="880" width="10" height="30"/><rect x="440" y="880" width="10" height="30"/></g>
  <path d="M140 760 Q175 735 215 760 L245 900 L110 900Z" fill="#05060f"/><circle cx="178" cy="722" r="30" fill="#05060f"/>
  <path d="M150 755 Q95 758 60 800 Q110 786 148 790Z" fill="#e63946"/>
  <path d="M215 790 Q262 805 292 850 L276 862 Q250 826 212 818Z" fill="#05060f"/>
  ${bubble(250, 566, 310, 140, ['Tu l’as vu,', 'toi aussi ?'], '300,700 262,762 354,702')}
</g>
<rect x="40" y="540" width="540" height="480" fill="none" stroke="#000" stroke-width="8"/>

<!-- Case 3 : la fenetre -->
<g clip-path="url(#c)">
  <rect x="610" y="540" width="350" height="480" fill="#10121f"/>
  <rect x="650" y="580" width="270" height="250" fill="#ffb703"/><rect x="650" y="580" width="270" height="250" fill="none" stroke="#05060f" stroke-width="10"/>
  <line x1="785" y1="580" x2="785" y2="830" stroke="#05060f" stroke-width="10"/><line x1="650" y1="705" x2="920" y2="705" stroke="#05060f" stroke-width="10"/>
  <path d="M610 1020 V900 Q700 840 790 880 Q880 840 960 900 V1020Z" fill="#05060f"/>
  <circle cx="700" cy="860" r="42" fill="#05060f"/>
  ${bubble(630, 868, 310, 130, ['… Il vient de', 's’allumer.'], '700,870 668,832 742,870')}
</g>
<rect x="610" y="540" width="350" height="480" fill="none" stroke="#000" stroke-width="8"/>

<!-- Case 4 : la tour -->
<g clip-path="url(#d)">
  <rect x="40" y="1050" width="920" height="420" fill="url(#sky)"/>${stars.replace(/cy="(\d+)"/g, (m, v) => `cy="${Number(v) + 1050}"`)}
  <polygon points="760,1160 140,1120 140,1330" fill="#ffb703" opacity="0.28"/>
  <rect x="740" y="1170" width="70" height="300" fill="#05060f"/><rect x="722" y="1120" width="106" height="56" fill="#05060f"/>
  <rect x="752" y="1136" width="34" height="26" fill="#ffb703"/>
  <path d="M40 1470 V1380 Q300 1340 520 1372 T960 1360 V1470Z" fill="#05060f"/>
  <circle cx="300" cy="1306" r="18" fill="#3a3f66"/><path d="M276 1338 Q300 1322 324 1338 L336 1388 L264 1388Z" fill="#3a3f66"/>
  <circle cx="368" cy="1312" r="16" fill="#e63946"/><path d="M346 1342 Q368 1328 390 1342 L400 1388 L336 1388Z" fill="#e63946"/>
  ${bubble(70, 1076, 330, 100, ['Alors, on y va.'], '230,1170 262,1236 290,1170')}
</g>
<rect x="40" y="1050" width="920" height="420" fill="none" stroke="#000" stroke-width="8"/>
</svg>`;

const out = path.join(here, 'planche-demo.png');
await sharp(Buffer.from(svg), { density: 96 }).flatten({ background: '#fff' }).png({ compressionLevel: 9 }).toFile(out);
console.log('Planche ecrite :', out);
