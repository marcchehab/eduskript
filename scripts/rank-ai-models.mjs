#!/usr/bin/env node
/**
 * rank-ai-models.mjs
 *
 * Rank AI models for the AI Edit feature against three criteria:
 *   - Intelligence (Artificial Analysis Index, manually cached)
 *   - Speed (OpenRouter p50 throughput + p50 TTFT, fastest provider)
 *   - Cost (OpenRouter completion price)
 *
 * Composite score: 50% intelligence + 30% speed + 20% cost (min-max normalised).
 * Speed sub-score: 70% throughput + 30% TTFT.
 * Pareto-optimal entries (not dominated on any axis) are flagged with `*`.
 *
 * Usage:
 *   node scripts/rank-ai-models.mjs                       # default markdown table
 *   node scripts/rank-ai-models.mjs --json                # raw JSON
 *   node scripts/rank-ai-models.mjs --top 20              # change list length
 *   node scripts/rank-ai-models.mjs --no-floor            # show all candidates
 *   node scripts/rank-ai-models.mjs --floor 45            # custom intelligence floor
 *   node scripts/rank-ai-models.mjs --html                # write model-ranking.html
 *   node scripts/rank-ai-models.mjs --html /tmp/x.html    # custom path
 *   node scripts/rank-ai-models.mjs --no-floor --html     # combine flags
 *
 * Data sources:
 *   - scripts/data/ai-model-intelligence.json (intelligence; manual cache)
 *   - https://openrouter.ai/api/v1/models (cost; live)
 *   - https://openrouter.ai/api/frontend/stats/endpoint (speed; live, undocumented)
 */

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INTEL_CACHE = join(__dirname, 'data', 'ai-model-intelligence.json')

const WEIGHTS = { intelligence: 0.5, speed: 0.3, cost: 0.2 }
const SPEED_WEIGHTS = { throughput: 0.7, ttft: 0.3 }
const DEFAULT_FLOOR = 40
const DEFAULT_TOP = 10

const args = process.argv.slice(2)
const flag = (name, defaultVal) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return defaultVal
  const v = args[i + 1]
  return v && !v.startsWith('--') ? v : true
}

const opts = {
  json: args.includes('--json'),
  noFloor: args.includes('--no-floor'),
  floor: parseFloat(flag('floor', DEFAULT_FLOOR)),
  top: parseInt(flag('top', DEFAULT_TOP), 10),
  html: args.includes('--html') ? (typeof flag('html') === 'string' ? flag('html') : 'model-ranking.html') : null,
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'eduskript-model-ranker/1.0' },
  })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

/**
 * Fetch p50 throughput + TTFT for a model from OpenRouter's frontend stats
 * endpoint. The endpoint keys models by `canonical_slug` (the dated
 * permaslug, e.g. `anthropic/claude-4.7-opus-20260416`), NOT the friendly
 * user-facing id. The caller passes the resolved canonical slug.
 */
async function fetchSpeed(canonicalSlug) {
  try {
    // NOTE: don't encodeURIComponent the slug — its `/` is part of the path
    // shape OpenRouter expects. encoding it to `%2F` returns 404.
    const data = await fetchJson(
      `https://openrouter.ai/api/frontend/stats/endpoint?permaslug=${canonicalSlug}&variant=standard`
    )
    const endpoints = (data.data ?? []).filter(
      e => e.stats?.p50_throughput != null
    )
    if (endpoints.length === 0) return null

    const fastest = endpoints.reduce((a, b) =>
      b.stats.p50_throughput > a.stats.p50_throughput ? b : a
    )
    return {
      provider: fastest.provider_name,
      throughput: fastest.stats.p50_throughput,
      ttft: fastest.stats.p50_latency,
      providerCostPerM: parseFloat(fastest.pricing.completion) * 1_000_000,
    }
  } catch {
    return null
  }
}

/**
 * Fetch the full model list once to build a friendly-id → canonical_slug
 * map. Models without a separate canonical_slug fall back to the id itself.
 */
async function fetchCanonicalSlugMap() {
  const data = await fetchJson('https://openrouter.ai/api/v1/models')
  const map = new Map()
  for (const m of data.data ?? []) {
    map.set(m.id, m.canonical_slug || m.id)
  }
  return map
}

async function fetchModelCost(slug) {
  try {
    // Don't encodeURIComponent — the `/` is part of the URL path.
    const data = await fetchJson(
      `https://openrouter.ai/api/v1/models/${slug}/endpoints`
    )
    // The model-level page lists all endpoints; lowest completion price is our reference.
    const prices = (data.data?.endpoints ?? [])
      .map(e => parseFloat(e.pricing?.completion))
      .filter(p => Number.isFinite(p))
    if (prices.length === 0) return null
    return Math.min(...prices) * 1_000_000
  } catch {
    return null
  }
}

/**
 * Build a self-contained HTML page with a Plotly 3D scatter (intelligence ×
 * throughput × cost) plus a 2D bubble chart and a sortable table. Loads
 * Plotly from CDN; no other dependencies.
 *
 * Encoding choices for the 3D plot:
 *   x = intelligence (linear)              higher is better
 *   y = throughput   (linear)              higher is better
 *   z = cost         (linear, clamped 0-5) lower is better. Clamped at $5/M
 *                                           so the $14-25 outliers float off
 *                                           the top of the chart without
 *                                           crushing the dense cluster below.
 *   color = composite score (Viridis)
 *   marker symbol: diamond if Pareto-optimal, circle otherwise
 *   marker size: scaled inverse-TTFT so faster-to-first-byte models stand out
 *
 * The 2D chart is the same data flattened (intel × throughput, bubble = 1/cost,
 * color = TTFT) for readers who don't want to rotate.
 */
function renderHtml(rows, meta) {
  const data = rows.map(r => ({
    slug: r.slug,
    intelligence: r.intelligence,
    provider: r.provider,
    throughput: r.throughput,
    ttft: r.ttft,
    cost: r.cost,
    score: r.score,
    pareto: r.pareto,
  }))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Eduskript AI Model Ranking</title>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1115;
    --panel: #181b21;
    --border: #2a2f38;
    --fg: #e6e8eb;
    --muted: #8a8f99;
    --accent: #5dadec;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #fafbfc;
      --panel: #ffffff;
      --border: #e5e7eb;
      --fg: #1a1d21;
      --muted: #6b7280;
      --accent: #2563eb;
    }
  }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg); color: var(--fg);
    margin: 0; padding: 2rem;
    max-width: 1280px; margin: 0 auto;
  }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  .meta { color: var(--muted); font-size: 0.875rem; margin-bottom: 2rem; line-height: 1.6; }
  .meta code { background: var(--panel); padding: 0.1em 0.4em; border-radius: 4px; font-size: 0.85em; }
  .panel {
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 1rem; margin-bottom: 1.5rem;
  }
  .panel h2 { font-size: 1rem; margin: 0 0 0.5rem; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; cursor: pointer; user-select: none; }
  th:hover { color: var(--fg); }
  tr:hover { background: rgba(127,127,127,0.05); }
  td.num { text-align: right; }
  .pareto-yes { color: var(--accent); font-weight: 600; }
  .footer { color: var(--muted); font-size: 0.75rem; text-align: center; margin-top: 2rem; }
</style>
</head>
<body>

<h1>AI Model Ranking for Eduskript AI Edit</h1>
<p class="meta">
  Weights: <code>${(meta.weights.intelligence * 100).toFixed(0)}% intelligence + ${(meta.weights.speed * 100).toFixed(0)}% speed + ${(meta.weights.cost * 100).toFixed(0)}% cost</code>;
  speed sub-score <code>${(meta.speedWeights.throughput * 100).toFixed(0)}% throughput + ${(meta.speedWeights.ttft * 100).toFixed(0)}% TTFT</code>;
  intelligence floor <code>${meta.floor === -Infinity ? 'none' : '≥ ' + meta.floor}</code>.<br>
  Sources: Artificial Analysis Index (manual cache, ${meta.intelUpdated}); OpenRouter live data (${meta.generated}).
</p>

<div class="panel">
  <h2>3D scatter — Intelligence × Throughput × 1/Cost</h2>
  <div id="plot3d" style="height:580px"></div>
</div>

<div class="panel">
  <h2>2D view — Intelligence × Throughput, bubble size = 1/cost, colour = TTFT</h2>
  <div id="plot2d" style="height:480px"></div>
</div>

<div class="panel">
  <h2>All models ranked by composite score (click headers to sort)</h2>
  <table id="ranking">
    <thead>
      <tr>
        <th data-key="rank" data-numeric="true">#</th>
        <th data-key="slug">Model</th>
        <th data-key="intelligence" data-numeric="true">Intel</th>
        <th data-key="provider">Provider</th>
        <th data-key="throughput" data-numeric="true">Throughput (tok/s)</th>
        <th data-key="ttft" data-numeric="true">TTFT (ms)</th>
        <th data-key="cost" data-numeric="true">$/M out</th>
        <th data-key="score" data-numeric="true">Score</th>
        <th data-key="pareto">Pareto</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
</div>

<p class="footer">Pareto-optimal entries (rendered as diamonds in the scatter, ✓ in the table) aren't dominated on all three axes by another model in the candidate set.</p>

<script>
const data = ${JSON.stringify(data)};

// Build hover text shared by both plots — keeps tooltip layout consistent.
const hovers = data.map(d =>
  '<b>' + d.slug + '</b><br>' +
  'Provider: ' + d.provider + '<br>' +
  'Intelligence: ' + d.intelligence.toFixed(1) + '<br>' +
  'Throughput: ' + Math.round(d.throughput) + ' tok/s<br>' +
  'TTFT: ' + Math.round(d.ttft) + ' ms<br>' +
  'Cost: $' + d.cost.toFixed(2) + ' / Mtok<br>' +
  'Score: ' + d.score.toFixed(3) + (d.pareto ? '<br>★ Pareto-optimal' : '')
);

// Inverse-TTFT marker size for the 3D plot: faster TTFT (lower ms) → bigger
// marker. Clamped so very-slow models still appear.
const markerSize = data.map(d => Math.max(8, Math.min(28, 4000 / d.ttft)));

const symbols = data.map(d => d.pareto ? 'diamond' : 'circle');
const labels = data.map(d => d.slug.split('/')[1] || d.slug);

Plotly.newPlot('plot3d', [{
  x: data.map(d => d.intelligence),
  y: data.map(d => d.throughput),
  z: data.map(d => d.cost),
  text: labels,
  hovertext: hovers,
  hoverinfo: 'text',
  mode: 'markers+text',
  textposition: 'top center',
  textfont: { size: 10, color: 'rgba(180,180,180,0.7)' },
  type: 'scatter3d',
  marker: {
    size: markerSize,
    color: data.map(d => d.score),
    colorscale: 'Viridis',
    colorbar: { title: { text: 'Score', font: { size: 11 } }, thickness: 12, len: 0.75 },
    symbol: symbols,
    line: { color: 'rgba(0,0,0,0.4)', width: 1 },
    opacity: 0.9,
  },
}], {
  scene: {
    xaxis: { title: 'Intelligence (AA Index)' },
    yaxis: { title: 'Throughput (tok/s)' },
    zaxis: { title: 'Cost ($/Mtok, lower is better)', range: [0, 5] },
    camera: { eye: { x: 1.6, y: 1.6, z: 1.0 } },
  },
  margin: { l: 0, r: 0, t: 0, b: 0 },
  paper_bgcolor: 'rgba(0,0,0,0)',
  font: { color: getComputedStyle(document.body).color, family: 'system-ui' },
}, { displayModeBar: false, responsive: true });

Plotly.newPlot('plot2d', [{
  x: data.map(d => d.intelligence),
  y: data.map(d => d.throughput),
  text: labels,
  hovertext: hovers,
  hoverinfo: 'text',
  mode: 'markers+text',
  textposition: 'top center',
  textfont: { size: 10, color: 'rgba(140,140,140,0.8)' },
  type: 'scatter',
  marker: {
    size: data.map(d => Math.max(10, Math.min(50, 30 / Math.sqrt(d.cost)))),
    color: data.map(d => d.ttft),
    colorscale: 'RdYlGn',
    reversescale: true,
    colorbar: { title: { text: 'TTFT (ms)', font: { size: 11 } }, thickness: 12, len: 0.75 },
    line: { color: 'rgba(0,0,0,0.3)', width: 1 },
    opacity: 0.85,
    symbol: symbols,
  },
}], {
  xaxis: { title: 'Intelligence (AA Index)' },
  yaxis: { title: 'Throughput (tok/s)' },
  margin: { l: 60, r: 20, t: 20, b: 50 },
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(127,127,127,0.04)',
  font: { color: getComputedStyle(document.body).color, family: 'system-ui' },
}, { displayModeBar: false, responsive: true });

// Sortable table.
const tbody = document.querySelector('#ranking tbody');
const ranked = data.map((d, i) => ({ ...d, rank: i + 1 }));
let sortKey = 'rank';
let sortAsc = true;

function render() {
  const sorted = [...ranked].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'number') return sortAsc ? av - bv : bv - av;
    return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
  tbody.innerHTML = sorted.map(r => '<tr>' +
    '<td class="num">' + r.rank + '</td>' +
    '<td><code>' + r.slug + '</code></td>' +
    '<td class="num">' + r.intelligence.toFixed(1) + '</td>' +
    '<td>' + r.provider + '</td>' +
    '<td class="num">' + Math.round(r.throughput) + '</td>' +
    '<td class="num">' + Math.round(r.ttft) + '</td>' +
    '<td class="num">$' + r.cost.toFixed(2) + '</td>' +
    '<td class="num">' + r.score.toFixed(3) + '</td>' +
    '<td>' + (r.pareto ? '<span class="pareto-yes">✓</span>' : '') + '</td>' +
  '</tr>').join('');
}
document.querySelectorAll('#ranking thead th').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = key !== 'score' && key !== 'pareto'; }
    render();
  });
});
render();
</script>
</body>
</html>`;
}

function minmax(values, { invert = false } = {}) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  return values.map(v => {
    if (span === 0) return 0.5
    const norm = (v - min) / span
    return invert ? 1 - norm : norm
  })
}

/**
 * Find Pareto-optimal entries on (intelligence, combinedSpeed, cost).
 * "combinedSpeed" is a higher-is-better composite of throughput & TTFT.
 * A model is Pareto-optimal if no other model is ≥ on all three axes
 * AND > on at least one (cost is "lower better", so we compare -cost).
 */
function paretoMask(rows) {
  return rows.map((r, i) =>
    !rows.some(
      (s, j) =>
        i !== j &&
        s.intelligence >= r.intelligence &&
        s.combinedSpeed >= r.combinedSpeed &&
        -s.cost >= -r.cost &&
        (s.intelligence > r.intelligence ||
          s.combinedSpeed > r.combinedSpeed ||
          -s.cost > -r.cost)
    )
  )
}

async function main() {
  const intelData = JSON.parse(readFileSync(INTEL_CACHE, 'utf-8'))
  const allModels = Object.entries(intelData.models)
    .map(([slug, intelligence]) => ({ slug, intelligence }))

  const floor = opts.noFloor ? -Infinity : opts.floor
  const candidates = allModels.filter(m => m.intelligence >= floor)

  if (candidates.length === 0) {
    console.error(`No models pass the intelligence floor of ${floor}`)
    process.exit(1)
  }

  console.error(`Fetching live data for ${candidates.length} models...`)

  // Build the friendly-id → canonical_slug map up front (single API call).
  const canonicalMap = await fetchCanonicalSlugMap()

  // Fetch speed + cost in parallel for all candidates.
  const enriched = await Promise.all(
    candidates.map(async m => {
      const canonicalSlug = canonicalMap.get(m.slug) ?? m.slug
      const [speed, cost] = await Promise.all([
        fetchSpeed(canonicalSlug),
        fetchModelCost(m.slug),
      ])
      return { ...m, speed, cost }
    })
  )

  const usable = enriched.filter(m => m.speed && m.cost != null)

  if (usable.length === 0) {
    console.error('No models had usable live speed + cost data')
    process.exit(1)
  }

  if (usable.length < enriched.length) {
    const dropped = enriched.filter(m => !m.speed || m.cost == null).map(m => m.slug)
    console.error(`Dropped (no live data): ${dropped.join(', ')}`)
  }

  // Normalise.
  const intelNorm = minmax(usable.map(m => m.intelligence))
  const throughputNorm = minmax(usable.map(m => m.speed.throughput))
  const ttftNorm = minmax(usable.map(m => m.speed.ttft), { invert: true })
  const costNorm = minmax(usable.map(m => m.cost), { invert: true })

  const rows = usable.map((m, i) => {
    const combinedSpeed =
      SPEED_WEIGHTS.throughput * throughputNorm[i] +
      SPEED_WEIGHTS.ttft * ttftNorm[i]
    const score =
      WEIGHTS.intelligence * intelNorm[i] +
      WEIGHTS.speed * combinedSpeed +
      WEIGHTS.cost * costNorm[i]
    return {
      slug: m.slug,
      intelligence: m.intelligence,
      provider: m.speed.provider,
      throughput: m.speed.throughput,
      ttft: m.speed.ttft,
      cost: m.cost,
      combinedSpeed,
      score,
    }
  })

  const pareto = paretoMask(rows)
  rows.forEach((r, i) => (r.pareto = pareto[i]))

  rows.sort((a, b) => b.score - a.score)
  const top = rows.slice(0, opts.top)

  if (opts.html) {
    // Visualization always renders ALL ranked rows (not just top N) so the
    // scatter plots aren't artificially truncated. The table sorts itself.
    const outPath = resolve(opts.html)
    const html = renderHtml(rows, {
      weights: WEIGHTS,
      speedWeights: SPEED_WEIGHTS,
      floor: opts.noFloor ? -Infinity : opts.floor,
      intelUpdated: intelData._updated,
      generated: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    })
    writeFileSync(outPath, html, 'utf-8')
    console.error(`Wrote ${outPath}`)
    console.error(`Open with: xdg-open ${outPath}  (or just double-click)`)
    return
  }

  if (opts.json) {
    console.log(JSON.stringify(top, null, 2))
    return
  }

  // Markdown table to stdout.
  const fmtCost = c => `$${c.toFixed(2)}`
  const fmtThroughput = t => `${Math.round(t)} t/s`
  const fmtTtft = ms => `${Math.round(ms)} ms`
  const fmtScore = s => s.toFixed(3)
  const fmtIntel = n => n.toFixed(1)

  console.log()
  console.log('| #  | Model                                   | Intel | Provider     | Throughput | TTFT     | $/M out | Score | Pareto |')
  console.log('|----|-----------------------------------------|-------|--------------|------------|----------|---------|-------|--------|')
  top.forEach((r, i) => {
    console.log(
      `| ${(i + 1).toString().padStart(2)} | ${r.slug.padEnd(39)} | ${fmtIntel(r.intelligence).padStart(5)} | ${r.provider.padEnd(12)} | ${fmtThroughput(r.throughput).padStart(10)} | ${fmtTtft(r.ttft).padStart(8)} | ${fmtCost(r.cost).padStart(7)} | ${fmtScore(r.score)} | ${r.pareto ? '  *   ' : '      '} |`
    )
  })

  console.log()
  console.log(`Weights: ${(WEIGHTS.intelligence * 100).toFixed(0)}% intelligence + ${(WEIGHTS.speed * 100).toFixed(0)}% speed + ${(WEIGHTS.cost * 100).toFixed(0)}% cost`)
  console.log(`Speed:   ${(SPEED_WEIGHTS.throughput * 100).toFixed(0)}% throughput + ${(SPEED_WEIGHTS.ttft * 100).toFixed(0)}% TTFT (lower better)`)
  console.log(`Floor:   intelligence ≥ ${opts.noFloor ? 'none' : floor}`)
  console.log(`Sources: AA Index (manual cache, ${intelData._updated}); OpenRouter (live)`)
  console.log()
  console.log(`Pareto-optimal entries are marked with *. They aren't dominated on all axes by another model in the set.`)
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
