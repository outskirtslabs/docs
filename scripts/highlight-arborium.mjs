#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CODE_BLOCK_RX = /<pre\b([^>]*)>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi
const HTML_ENTITY_RX = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g

const NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
}

const LANGUAGE_ALIASES = new Map([
  ['shell', 'bash'],
  ['sh', 'bash'],
])

function parseArgs (argv) {
  let siteDir = path.join('build', 'site')

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]
    if (arg === '--site-dir') {
      siteDir = argv[idx + 1]
      idx += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true, siteDir }
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!siteDir) {
    throw new Error('Missing value for --site-dir')
  }

  return { help: false, siteDir }
}

function usage () {
  return 'Usage: node scripts/highlight-arborium.mjs [--site-dir build/site]'
}

function getAttr (attrs, name) {
  const quoted = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
  const quotedMatch = attrs.match(quoted)
  if (quotedMatch) return quotedMatch[2] ?? quotedMatch[3] ?? ''

  const bare = new RegExp(`${name}\\s*=\\s*([^\\s"'>]+)`, 'i')
  const bareMatch = attrs.match(bare)
  if (bareMatch) return bareMatch[1] ?? ''

  return null
}

function hasClass (attrs, className) {
  const classAttr = getAttr(attrs, 'class')
  if (!classAttr) return false
  return classAttr.split(/\s+/).includes(className)
}

export function decodeHtmlEntities (value) {
  return value.replace(HTML_ENTITY_RX, (entity, token) => {
    if (token.startsWith('#x') || token.startsWith('#X')) {
      const codepoint = Number.parseInt(token.slice(2), 16)
      return Number.isNaN(codepoint) ? entity : String.fromCodePoint(codepoint)
    }

    if (token.startsWith('#')) {
      const codepoint = Number.parseInt(token.slice(1), 10)
      return Number.isNaN(codepoint) ? entity : String.fromCodePoint(codepoint)
    }

    return NAMED_ENTITIES[token] ?? entity
  })
}

export function normalizeLanguage (rawLanguage) {
  if (!rawLanguage) return null

  const cleaned = rawLanguage
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .replace(/[^a-z0-9_+.-].*$/, '')

  if (!cleaned) return null
  return LANGUAGE_ALIASES.get(cleaned) ?? cleaned
}

export function resolveLanguage (codeAttrs) {
  const dataLang = normalizeLanguage(getAttr(codeAttrs, 'data-lang'))
  if (dataLang) return dataLang

  const classAttr = getAttr(codeAttrs, 'class')
  if (!classAttr) return null

  for (const className of classAttr.split(/\s+/)) {
    if (!className.startsWith('language-')) continue
    const normalized = normalizeLanguage(className)
    if (normalized) return normalized
  }

  return null
}

function classifyHighlightError (stderr = '') {
  const normalized = stderr.toLowerCase()
  if (normalized.includes('unsupported language') || normalized.includes('could not detect language')) {
    return 'unsupported'
  }

  return 'error'
}

export function createArboriumHighlighter () {
  return (language, sourceText) => {
    const result = spawnSync('arborium', ['--lang', language, '--html'], {
      encoding: 'utf8',
      input: sourceText,
      maxBuffer: 10 * 1024 * 1024,
    })

    if (result.error) {
      return {
        ok: false,
        kind: 'error',
        message: result.error.message,
      }
    }

    if (result.status !== 0) {
      return {
        ok: false,
        kind: classifyHighlightError(result.stderr),
        message: (result.stderr || '').trim() || `arborium exited with code ${result.status}`,
      }
    }

    return {
      ok: true,
      html: result.stdout,
    }
  }
}

export function transformHtml (html, { highlight } = {}) {
  if (typeof highlight !== 'function') {
    throw new Error('transformHtml requires a highlight(language, source) function')
  }

  const warnings = []
  const stats = {
    candidates: 0,
    highlighted: 0,
    unsupported: 0,
    skippedAlreadyHighlighted: 0,
    skippedNoLanguage: 0,
    skippedNotHighlightBlock: 0,
  }

  const rewritten = html.replace(CODE_BLOCK_RX, (fullMatch, preAttrs, codeAttrs, codeHtml) => {
    if (!hasClass(preAttrs, 'highlight')) {
      stats.skippedNotHighlightBlock += 1
      return fullMatch
    }

    if (codeHtml.includes('<a-')) {
      stats.skippedAlreadyHighlighted += 1
      return fullMatch
    }

    const language = resolveLanguage(codeAttrs)
    if (!language) {
      stats.skippedNoLanguage += 1
      return fullMatch
    }

    stats.candidates += 1

    const sourceText = decodeHtmlEntities(codeHtml)
    const highlighted = highlight(language, sourceText)

    if (!highlighted.ok) {
      if (highlighted.kind === 'unsupported') {
        stats.unsupported += 1
        warnings.push({ language, message: highlighted.message })
        return fullMatch
      }

      throw new Error(`Arborium failed for language '${language}': ${highlighted.message}`)
    }

    stats.highlighted += 1
    return fullMatch.replace(codeHtml, highlighted.html)
  })

  return {
    html: rewritten,
    stats,
    warnings,
  }
}

async function collectHtmlFiles (siteDir) {
  const htmlFiles = []

  async function walk (currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (entry.isFile() && fullPath.endsWith('.html')) {
        htmlFiles.push(fullPath)
      }
    }
  }

  await walk(siteDir)
  htmlFiles.sort()
  return htmlFiles
}

function aggregateWarningCounts (warnings, counts) {
  for (const warning of warnings) {
    const current = counts.get(warning.language) ?? 0
    counts.set(warning.language, current + 1)
  }
}

export function preflightArborium () {
  const probe = spawnSync('arborium', ['--lang', 'bash', '--html'], {
    encoding: 'utf8',
    input: 'echo ok\n',
  })

  if (probe.error) {
    if (probe.error.code === 'ENOENT') {
      throw new Error('arborium executable not found. Run this from the flake devshell where arborium is on PATH.')
    }
    throw new Error(`Failed to execute arborium: ${probe.error.message}`)
  }

  if (probe.status !== 0) {
    throw new Error(`arborium preflight failed: ${(probe.stderr || '').trim()}`)
  }
}

export async function processSiteDirectory (siteDir, { highlight, logger = console } = {}) {
  const htmlFiles = await collectHtmlFiles(siteDir)
  const warningCounts = new Map()

  const totals = {
    files: htmlFiles.length,
    changedFiles: 0,
    candidates: 0,
    highlighted: 0,
    unsupported: 0,
    skippedAlreadyHighlighted: 0,
    skippedNoLanguage: 0,
    skippedNotHighlightBlock: 0,
  }

  for (const filePath of htmlFiles) {
    const inputHtml = await fs.readFile(filePath, 'utf8')
    const transformed = transformHtml(inputHtml, { highlight })

    totals.candidates += transformed.stats.candidates
    totals.highlighted += transformed.stats.highlighted
    totals.unsupported += transformed.stats.unsupported
    totals.skippedAlreadyHighlighted += transformed.stats.skippedAlreadyHighlighted
    totals.skippedNoLanguage += transformed.stats.skippedNoLanguage
    totals.skippedNotHighlightBlock += transformed.stats.skippedNotHighlightBlock

    aggregateWarningCounts(transformed.warnings, warningCounts)

    if (transformed.html !== inputHtml) {
      await fs.writeFile(filePath, transformed.html, 'utf8')
      totals.changedFiles += 1
    }
  }

  const warningLines = [...warningCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([language, count]) => `${language}=${count}`)

  logger.log(
    `[arborium] files=${totals.files} changed=${totals.changedFiles} candidates=${totals.candidates} highlighted=${totals.highlighted} unsupported=${totals.unsupported}`
  )

  if (warningLines.length > 0) {
    logger.warn(`[arborium] unsupported language blocks: ${warningLines.join(', ')}`)
  }

  return totals
}

async function main () {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  preflightArborium()

  const resolvedSiteDir = path.resolve(args.siteDir)
  await processSiteDirectory(resolvedSiteDir, {
    highlight: createArboriumHighlighter(),
    logger: console,
  })
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMainModule) {
  main().catch((error) => {
    console.error(`[arborium] ${error.message}`)
    process.exitCode = 1
  })
}
