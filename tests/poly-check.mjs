// tests/poly-check.mjs — verifica el polígono de alerta de src/sismos.nx.
//
//   node tests/poly-check.mjs                 (solo puntos de control)
//   node tests/poly-check.mjs /tmp/q.txt      (además, contra sismos reales)
//
// Los vértices NO se copian aquí: se extraen de src/sismos.nx (las llamadas
// ve_push), que es la única fuente de verdad. Si tocas el polígono, corre esto.
//
// Contexto: sustituyó a la caja lat 0.5..12.9 / lon -73.6..-60.5, que dejaba
// pasar el nido de Bucaramanga (48 eventos M4+ en un solo feed), Grenada y un
// M6.3 en Colombia central a ~700 km. Venezuela es cóncava: ninguna caja puede
// contenerla sin tragarse a los vecinos. Margen ~60 km: el criterio es la
// DISTANCIA, no la nacionalidad (un M4.9 colombiano pegado a Cúcuta entra; el
// nido de Bucaramanga, a ~116 km, no).
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../src/sismos.nx', import.meta.url), 'utf8');
const VE = [...src.matchAll(/ve_push\(lons,\s*lats,\s*(-?[\d.]+),\s*(-?[\d.]+)\)/g)]
  .map(m => [parseFloat(m[1]), parseFloat(m[2])]);
if (VE.length < 3) throw new Error('No se pudieron extraer los vértices de src/sismos.nx');

// Ray casting — mismo algoritmo que point_in_ve() en src/sismos.nx.
function inside(lat, lon) {
  let ins = false;
  for (let i = 0, j = VE.length - 1; i < VE.length; j = i++) {
    const [xi, yi] = VE[i], [xj, yj] = VE[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}

const DENTRO = [
  ['Caracas / La Guaira', 10.60, -66.93], ['Maracaibo', 10.65, -71.61],
  ['Cumana', 10.45, -64.18], ['Macuro (Paria)', 10.92, -61.83],
  ['Offshore Sucre', 10.75, -62.71], ['Golfo de Paria', 10.00, -62.00],
  ['Trinidad (Puerto Espana)', 10.65, -61.51], ['Ciudad Guayana', 8.35, -62.64],
  ['San Cristobal (Tachira)', 7.77, -72.22], ['Cucuta (en la frontera)', 7.89, -72.50],
  ['Puerto Ayacucho', 5.66, -67.60], ['Santa Elena de Uairen', 4.60, -61.11],
  ['Roraima (triple frontera)', 5.15, -60.80], ['Merida', 8.60, -71.15],
  ['Valledupar +33km E (lo reporta FUNVISIS)', 10.50, -72.95],
  ['Isla Margarita', 11.00, -63.90], ['Paraguana', 11.95, -70.00],
  ['Barinas', 8.62, -70.21], ['Puerto Carreno (frontera)', 6.19, -67.48],
  ['Delta Amacuro', 8.60, -60.80],
  // Dependencias federales: son Venezuela
  ['Los Roques', 11.85, -66.75], ['La Orchila', 11.80, -66.17],
  ['La Blanquilla', 11.85, -64.60], ['Los Testigos', 11.37, -63.10],
  ['La Tortuga', 10.93, -65.33], ['Isla de Coche', 10.79, -63.95],
  // Costa afuera del norte de Paria (falla de El Pilar); EMSC los etiqueta VENEZUELA
  ['Offshore Sucre real (2026-07-16)', 11.36, -61.80],
  ['Offshore Sucre real 2 (2026-07-16)', 11.34, -62.00],
  // El criterio es distancia, no nacionalidad: a ~40 km de San Cristobal, se siente
  ['M4.9 colombiano pegado a Cucuta', 7.65, -72.77],
];

const FUERA = [
  // El ruido que motivó el cambio
  ['NIDO DE BUCARAMANGA (M4+ a diario, ~116 km)', 6.75, -73.03],
  ['Bucaramanga ciudad', 7.13, -73.12],
  ['Colombia central (el M6.3 del 2026-07-16)', 4.48, -73.17],
  ['Villavicencio', 4.15, -73.63], ['Bogota', 4.71, -74.07], ['Medellin', 6.24, -75.58],
  ['Grenada', 12.11, -61.68], ['Barbados', 13.10, -59.54], ['Santa Lucia', 13.90, -60.98],
  ['St. Vincent', 13.25, -61.20], ['Tobago', 11.25, -60.65],
  ['Georgetown (Guyana)', 6.80, -58.15], ['Boa Vista (Brasil)', 2.82, -60.67],
  ['Manaos (Brasil)', -3.10, -60.02], ['Panama', 8.98, -79.52],
  ['Kingston (Jamaica)', 17.97, -76.79],
  ['Bonaire', 12.15, -68.28], ['Curazao', 12.17, -68.95],
  ['Caribe abierto al N (M4.5 del 2026-07-16)', 12.21, -64.78],
  ['Caribe abierto al N 2', 12.87, -63.17],
  // (0,0): a lo que colapsa una coordenada corrupta vía to_float0 — debe descartarse
  ['(0,0) — coordenada corrupta', 0.0, 0.0],
];

let fallos = 0;
for (const [n, la, lo] of DENTRO) if (!inside(la, lo)) { console.log(`FALLO (deberia ENTRAR): ${n}`); fallos++; }
for (const [n, la, lo] of FUERA) if (inside(la, lo))  { console.log(`FALLO (deberia QUEDAR FUERA): ${n}`); fallos++; }

console.log(`${VE.length} vertices · ${DENTRO.length} deben entrar · ${FUERA.length} deben quedar fuera`);

// Opcional: contra un volcado real "lat|lon|mag|place" por linea.
if (process.argv[2]) {
  const filas = readFileSync(process.argv[2], 'utf8').trim().split('\n');
  const d = {}, f = {};
  for (const fila of filas) {
    const [la, lo, , place] = fila.split('|');
    const k = place.replace(/^[0-9]+ km al [a-z]+ +de .*/, '[FUNVISIS: localidad VE]').replace(/,.*/, '');
    const t = inside(parseFloat(la), parseFloat(lo)) ? d : f;
    t[k] = (t[k] || 0) + 1;
  }
  const fmt = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}x ${k}`).join(', ');
  console.log(`\nDENTRO: ${fmt(d)}`);
  console.log(`\nFUERA:  ${fmt(f)}`);
}

if (fallos > 0) { console.log(`\n*** ${fallos} FALLOS ***`); process.exit(1); }
console.log('TODOS LOS PUNTOS DE CONTROL PASARON');
