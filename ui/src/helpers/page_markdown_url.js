'use strict'

module.exports = (url) => {
  if (!url || typeof url !== 'string') return url

  const match = url.match(/^([^?#]*)(.*)$/)
  if (!match) return url

  const path = match[1]
  const suffix = match[2]
  if (!path) return url

  if (path.endsWith('.md')) return `${path}${suffix}`
  if (path.endsWith('.html')) return `${path.slice(0, -5)}.md${suffix}`
  if (path.endsWith('/')) return `${path}index.md${suffix}`

  return `${path}.md${suffix}`
}
