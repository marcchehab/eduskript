// Builds the built-in plugin templates in public/plugin-templates/ (SVG maps with
// data-id / data-name / data-point-of, see src/lib/plugin-templates/index.ts).
// Not part of the build: run in a scratch dir after
//   npm i d3-geo topojson-client world-atlas swiss-maps i18n-iso-countries
// then copy the SVGs and regenerate src/lib/plugin-templates/builtin.json.
// Sources: world-atlas (Natural Earth, public domain), swiss-maps 2026 (swisstopo/BFS, BSD-3).
import fs from 'node:fs'
import { geoPath, geoAzimuthalEqualArea, geoEqualEarth, geoMercator } from 'd3-geo'
import { feature } from 'topojson-client'
import countries from 'i18n-iso-countries'
import de from 'i18n-iso-countries/langs/de.json' with { type: 'json' }
countries.registerLocale(de)
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const alpha2 = (numId, name) => {
  if (name === 'Kosovo') return 'xk'
  if (name === 'N. Cyprus') return null
  const a = numId ? countries.numericToAlpha2(numId) : null
  return a ? a.toLowerCase() : null
}
const deName = (a2, fallback) => (a2 === 'xk' ? 'Kosovo' : countries.getName(a2.toUpperCase(), 'de') || fallback)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function svg({ name, W, H, context, shapes, points, extra = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" data-template="${name}" style="width:100%;height:auto;display:block">
<g class="es-context" fill="#e2e8f0" stroke="#ffffff" stroke-width="0.5">${context.map((d) => `<path d="${d}"/>`).join('')}</g>
${extra}<g class="es-shapes" fill="#94a3b8" stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round">${shapes.map((s) => `<path data-id="${s.id}" data-name="${esc(s.name)}" d="${s.d}"/>`).join('')}</g>
<g class="es-points" fill="#dc2626" stroke="#ffffff" stroke-width="1">${points.map((p) => `<circle data-point-of="${p.of}" data-name="${esc(p.name)}" cx="${p.x}" cy="${p.y}" r="${p.r ?? 3.5}"/>`).join('')}</g>
</svg>`
}

// ---------- Europe ----------
const EU = 'al ad at by be ba bg hr cy cz dk ee fi fr de gr hu is ie it xk lv li lt lu mt md mc me nl mk no pl pt ro ru sm rs sk si es se ch tr ua gb va ge am az'.split(' ')
const CAPITALS = { al: ['Tirana', 19.82, 41.33], ad: ['Andorra la Vella', 1.52, 42.51], at: ['Wien', 16.37, 48.21], by: ['Minsk', 27.56, 53.9], be: ['Brüssel', 4.35, 50.85], ba: ['Sarajevo', 18.41, 43.86], bg: ['Sofia', 23.32, 42.7], hr: ['Zagreb', 15.98, 45.81], cy: ['Nikosia', 33.36, 35.17], cz: ['Prag', 14.42, 50.08], dk: ['Kopenhagen', 12.57, 55.68], ee: ['Tallinn', 24.75, 59.44], fi: ['Helsinki', 24.94, 60.17], fr: ['Paris', 2.35, 48.86], de: ['Berlin', 13.4, 52.52], gr: ['Athen', 23.73, 37.98], hu: ['Budapest', 19.04, 47.5], is: ['Reykjavík', -21.94, 64.15], ie: ['Dublin', -6.26, 53.35], it: ['Rom', 12.5, 41.9], xk: ['Pristina', 21.17, 42.66], lv: ['Riga', 24.11, 56.95], li: ['Vaduz', 9.52, 47.14], lt: ['Vilnius', 25.28, 54.69], lu: ['Luxemburg', 6.13, 49.61], mt: ['Valletta', 14.51, 35.9], md: ['Chișinău', 28.86, 47.01], mc: ['Monaco', 7.42, 43.74], me: ['Podgorica', 19.26, 42.44], nl: ['Amsterdam', 4.9, 52.37], mk: ['Skopje', 21.43, 42.0], no: ['Oslo', 10.75, 59.91], pl: ['Warschau', 21.01, 52.23], pt: ['Lissabon', -9.14, 38.72], ro: ['Bukarest', 26.1, 44.43], ru: ['Moskau', 37.62, 55.76], sm: ['San Marino', 12.45, 43.94], rs: ['Belgrad', 20.46, 44.79], sk: ['Bratislava', 17.11, 48.15], si: ['Ljubljana', 14.51, 46.06], es: ['Madrid', -3.7, 40.42], se: ['Stockholm', 18.07, 59.33], ch: ['Bern', 7.45, 46.95], tr: ['Ankara', 32.85, 39.93], ua: ['Kiew', 30.52, 50.45], gb: ['London', -0.13, 51.51], va: ['Vatikanstadt', 12.45, 41.9], ge: ['Tiflis', 44.79, 41.72], am: ['Jerewan', 44.51, 40.18], az: ['Baku', 49.87, 40.41] }
{
  const w = read('node_modules/world-atlas/countries-50m.json')
  const fc = feature(w, w.objects.countries)
  const W = 1000, H = 820
  const proj = geoAzimuthalEqualArea().rotate([-12, -53]).clipExtent([[0, 0], [W, H]])
  proj.fitExtent([[0, 0], [W, H]], { type: 'MultiPoint', coordinates: [[-24, 35], [44, 35], [-12, 71], [42, 70], [10, 34], [30, 72]] })
  const path = geoPath(proj).digits(1)
  const shapes = [], context = []
  for (const f of fc.features) {
    const d = path(f)
    if (!d) continue
    const a2 = alpha2(f.id, f.properties.name)
    if (a2 && EU.includes(a2)) shapes.push({ id: a2, name: deName(a2, f.properties.name), d })
    else context.push(d)
  }
  const points = Object.entries(CAPITALS).map(([of, [name, lon, lat]]) => { const [x, y] = proj([lon, lat]); return { of, name, x: x.toFixed(1), y: y.toFixed(1) } })
  fs.writeFileSync('europe.svg', svg({ name: 'europe', W, H, context, shapes, points }))
  console.log('europe', shapes.length, 'countries', points.length, 'capitals', fs.statSync('europe.svg').size)
}
// ---------- World ----------
{
  const w = read('node_modules/world-atlas/countries-110m.json')
  const fc = feature(w, w.objects.countries)
  const W = 1000, H = 520
  const proj = geoEqualEarth().fitExtent([[2, 2], [W - 2, H - 2]], { type: 'Sphere' })
  const path = geoPath(proj).digits(1)
  const shapes = [], context = []
  for (const f of fc.features) {
    const d = path(f)
    if (!d) continue
    const a2 = alpha2(f.id, f.properties.name)
    if (a2) shapes.push({ id: a2, name: deName(a2, f.properties.name), d }); else context.push(d)
  }
  fs.writeFileSync('world.svg', svg({ name: 'world', W, H, context, shapes, points: [] }))
  console.log('world', shapes.length, fs.statSync('world.svg').size)
}
// ---------- Switzerland ----------
const CANTONS = [['zh', 'Zürich', 'Zürich', 8.54, 47.37], ['be', 'Bern', 'Bern', 7.45, 46.95], ['lu', 'Luzern', 'Luzern', 8.31, 47.05], ['ur', 'Uri', 'Altdorf', 8.64, 46.88], ['sz', 'Schwyz', 'Schwyz', 8.65, 47.02], ['ow', 'Obwalden', 'Sarnen', 8.25, 46.9], ['nw', 'Nidwalden', 'Stans', 8.37, 46.96], ['gl', 'Glarus', 'Glarus', 9.07, 47.04], ['zg', 'Zug', 'Zug', 8.52, 47.17], ['fr', 'Freiburg', 'Freiburg', 7.16, 46.81], ['so', 'Solothurn', 'Solothurn', 7.54, 47.21], ['bs', 'Basel-Stadt', 'Basel', 7.59, 47.56], ['bl', 'Basel-Landschaft', 'Liestal', 7.73, 47.48], ['sh', 'Schaffhausen', 'Schaffhausen', 8.63, 47.7], ['ar', 'Appenzell Ausserrhoden', 'Herisau', 9.28, 47.39], ['ai', 'Appenzell Innerrhoden', 'Appenzell', 9.41, 47.33], ['sg', 'St. Gallen', 'St. Gallen', 9.38, 47.42], ['gr', 'Graubünden', 'Chur', 9.53, 46.85], ['ag', 'Aargau', 'Aarau', 8.04, 47.39], ['tg', 'Thurgau', 'Frauenfeld', 8.9, 47.56], ['ti', 'Tessin', 'Bellinzona', 9.02, 46.19], ['vd', 'Waadt', 'Lausanne', 6.63, 46.52], ['vs', 'Wallis', 'Sitten', 7.36, 46.23], ['ne', 'Neuenburg', 'Neuenburg', 6.93, 46.99], ['ge', 'Genf', 'Genf', 6.14, 46.2], ['ju', 'Jura', 'Delsberg', 7.34, 47.37]]
{
  const t = read('node_modules/swiss-maps/2026/ch-combined.json')
  const cantons = feature(t, t.objects.cantons)
  const lakes = feature(t, t.objects.lakes)
  const W = 1000, H = 640
  const proj = geoMercator().fitExtent([[6, 6], [W - 6, H - 6]], cantons)
  const path = geoPath(proj).digits(1)
  const shapes = cantons.features.map((f) => { const c = CANTONS[Number(f.id) - 1]; return { id: c[0], name: c[1], d: path(f) } })
  const lakePaths = lakes.features.map((f) => `<path d="${path(f)}"/>`).join('')
  const points = CANTONS.map(([of, , name, lon, lat]) => { const [x, y] = proj([lon, lat]); return { of, name, x: x.toFixed(1), y: y.toFixed(1), r: 4 } })
  fs.writeFileSync('switzerland.svg', svg({ name: 'switzerland', W, H, context: [], shapes, points, extra: '' }).replace('<g class="es-points"', `<g class="es-lakes" fill="#bfdbfe">${lakePaths}</g>\n<g class="es-points"`))
  console.log('switzerland', shapes.length, fs.statSync('switzerland.svg').size)
}
