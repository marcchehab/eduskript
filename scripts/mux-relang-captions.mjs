#!/usr/bin/env node
/**
 * Re-language Mux auto-generated captions.
 *
 * Mux auto-captions can't be re-languaged in place. This script deletes the
 * wrong generated subtitle track(s) and regenerates from the primary audio
 * track in the target language.
 *
 * Usage:
 *   node scripts/mux-relang-captions.mjs <assetOrPlaybackId> [--lang=de] [--apply]
 *
 * Without --apply it runs as a dry run (prints the plan, changes nothing).
 *
 * Note: the new track is processed async by Mux — it appears in `ready`
 * status a short while after this script returns.
 */

import dotenv from 'dotenv'
import Mux from '@mux/mux-node'

dotenv.config({ path: '.env.local' })
dotenv.config() // fallback to .env

// Languages Mux supports for auto-generated captions (per @mux/mux-node v12 types).
const SUPPORTED = ['en', 'es', 'it', 'pt', 'de', 'fr', 'pl', 'ru', 'nl', 'ca',
  'tr', 'sv', 'uk', 'no', 'fi', 'sk', 'el', 'cs', 'hr', 'da', 'ro', 'bg']

const LANG_NAMES = {
  de: 'Deutsch (CC)', en: 'English (CC)', fr: 'Français (CC)', es: 'Español (CC)',
  it: 'Italiano (CC)', pt: 'Português (CC)', nl: 'Nederlands (CC)',
}

function parseArgs(argv) {
  const args = { id: null, lang: 'de', apply: false }
  for (const a of argv) {
    if (a === '--apply') args.apply = true
    else if (a.startsWith('--lang=')) args.lang = a.slice('--lang='.length)
    else if (!a.startsWith('--') && !args.id) args.id = a
  }
  return args
}

async function resolveAsset(mux, id) {
  // The given id may be an asset id or a playback id. Try asset first.
  // Mux returns 404 for an unknown id and 400 when the id is a playback id.
  try {
    return await mux.video.assets.retrieve(id)
  } catch (err) {
    if (err?.status !== 404 && err?.status !== 400) throw err
  }
  // Fall back to treating it as a playback id.
  const pb = await mux.video.playbackIds.retrieve(id)
  const assetId = pb?.object?.id
  if (pb?.object?.type !== 'asset' || !assetId) {
    throw new Error(`Playback id ${id} does not map to an asset`)
  }
  console.log(`Resolved playback id ${id} -> asset ${assetId}`)
  return await mux.video.assets.retrieve(assetId)
}

async function main() {
  const { id, lang, apply } = parseArgs(process.argv.slice(2))

  if (!id) {
    console.error('Usage: node scripts/mux-relang-captions.mjs <assetOrPlaybackId> [--lang=de] [--apply]')
    process.exit(1)
  }
  if (!SUPPORTED.includes(lang)) {
    console.error(`Language "${lang}" is not supported for Mux auto-captions.`)
    console.error(`Supported: ${SUPPORTED.join(', ')}`)
    process.exit(1)
  }
  if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
    console.error('MUX_TOKEN_ID / MUX_TOKEN_SECRET not found in environment (.env / .env.local).')
    process.exit(1)
  }

  const mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET,
  })

  const asset = await resolveAsset(mux, id)
  const tracks = asset.tracks ?? []

  console.log(`\nAsset ${asset.id} (status: ${asset.status})`)
  console.log('Tracks:')
  for (const t of tracks) {
    const bits = [`type=${t.type}`, t.id]
    if (t.type === 'audio') bits.push(`primary=${!!t.primary}`)
    if (t.type === 'text') bits.push(`text_source=${t.text_source}`, `lang=${t.language_code}`, `status=${t.status}`, `name="${t.name ?? ''}"`)
    console.log(`  - ${bits.join('  ')}`)
  }

  // Primary audio track is the source for generated subtitles.
  const audio = tracks.find((t) => t.type === 'audio' && t.primary) ?? tracks.find((t) => t.type === 'audio')
  if (!audio) {
    console.error('\nNo audio track found on this asset — cannot generate subtitles.')
    process.exit(1)
  }

  // Auto-generated text tracks in the wrong language → delete and regenerate.
  const generated = tracks.filter((t) => t.type === 'text' && t.text_source === 'generated_vod')
  const wrongLang = generated.filter((t) => (t.language_code ?? '').split('-')[0] !== lang)
  const alreadyTarget = generated.some((t) => (t.language_code ?? '').split('-')[0] === lang)

  console.log(`\nPlan (target language: ${lang}):`)
  if (wrongLang.length === 0) {
    console.log('  - No wrong-language generated tracks to delete.')
  } else {
    for (const t of wrongLang) console.log(`  - DELETE generated track ${t.id} (lang=${t.language_code})`)
  }
  if (alreadyTarget) {
    console.log(`  - SKIP regeneration: a generated "${lang}" track already exists.`)
  } else {
    console.log(`  - GENERATE subtitles from audio track ${audio.id} in "${lang}"`)
  }

  if (!apply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.')
    return
  }

  console.log('\nApplying...')
  for (const t of wrongLang) {
    await mux.video.assets.deleteTrack(asset.id, t.id)
    console.log(`  deleted track ${t.id}`)
  }
  if (!alreadyTarget) {
    await mux.video.assets.generateSubtitles(asset.id, audio.id, {
      generated_subtitles: [{ language_code: lang, name: LANG_NAMES[lang] ?? lang }],
    })
    console.log(`  requested "${lang}" subtitle generation from audio track ${audio.id}`)
  }
  console.log('\nDone. Mux processes the new track async — check the asset in a minute or two.')
}

main().catch((err) => {
  console.error('\nError:', err?.message ?? err)
  if (err?.status) console.error('HTTP status:', err.status)
  process.exit(1)
})
