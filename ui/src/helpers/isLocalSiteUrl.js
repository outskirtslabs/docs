'use strict'

module.exports = (siteUrl) => {
  if (!siteUrl || typeof siteUrl !== 'string') return false

  try {
    const parsed = new URL(siteUrl, 'http://example.invalid')
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}
