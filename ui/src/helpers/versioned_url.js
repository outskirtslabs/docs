'use strict'

module.exports = (siteUrl, versionSegment, url) => {
  if (!url) {
    // occurs with stock pages like 404.html
    return url
  }

  const normalizedUrl = url.startsWith('/') ? url : `/${url}`
  const versionPath =
    versionSegment && !normalizedUrl.includes(`/${versionSegment}/`)
      ? `/${versionSegment}${normalizedUrl}`
      : normalizedUrl

  if (!siteUrl) return versionPath

  return `${siteUrl.replace(/\/+$/, '')}${versionPath}`
}
