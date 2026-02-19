#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const siteDirArg = process.argv[2]
if (!siteDirArg) {
  console.error('Usage: node scripts/inject-dev-live-reload.mjs <site-dir>')
  process.exit(2)
}

const siteDir = resolve(siteDirArg)

const snippet = `<!-- dev-live-reload:start -->
<script>
;(() => {
  const endpoint = '/_dev/reload.txt'
  let currentToken = null

  async function poll() {
    try {
      const res = await fetch(endpoint + '?t=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) return
      const nextToken = (await res.text()).trim()
      if (!nextToken) return
      if (currentToken === null) {
        currentToken = nextToken
        return
      }
      if (nextToken !== currentToken) {
        window.location.reload()
      }
    } catch (_) {
      // Ignore transient network errors in dev.
    }
  }

  setInterval(poll, 1000)
  poll()
})()
</script>
<!-- dev-live-reload:end -->`

const blockRegex = /<!-- dev-live-reload:start -->[\s\S]*?<!-- dev-live-reload:end -->/

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const st = statSync(fullPath)
    if (st.isDirectory()) {
      walk(fullPath, acc)
      continue
    }
    if (fullPath.endsWith('.html')) acc.push(fullPath)
  }
}

function inject(pathname) {
  const original = readFileSync(pathname, 'utf8')
  const withoutOld = original.replace(blockRegex, '').trimEnd()
  const lower = withoutOld.toLowerCase()
  const bodyClose = lower.lastIndexOf('</body>')

  let next
  if (bodyClose >= 0) {
    next = withoutOld.slice(0, bodyClose) + '\n' + snippet + '\n' + withoutOld.slice(bodyClose)
  } else {
    next = withoutOld + '\n' + snippet + '\n'
  }

  if (next !== original) writeFileSync(pathname, next)
}

const htmlFiles = []
walk(siteDir, htmlFiles)
htmlFiles.forEach(inject)

