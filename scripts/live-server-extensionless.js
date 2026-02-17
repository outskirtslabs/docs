#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { parse, format } = require('url')

const siteRoot = path.resolve(process.cwd(), 'build/site')

function tryServeSvg(pathname, res) {
  if (path.extname(pathname).toLowerCase() !== '.svg') return false

  // Resolve to build/site and block path traversal attempts.
  const absolutePath = path.resolve(siteRoot, `.${pathname}`)
  if (!absolutePath.startsWith(siteRoot + path.sep)) return false
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return false

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
  fs.createReadStream(absolutePath).pipe(res)
  return true
}

module.exports = function extensionlessHtmlMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()

  const parsed = parse(req.url)
  const pathname = parsed.pathname || '/'

  if (tryServeSvg(pathname, res)) return

  if (pathname === '/' || pathname.endsWith('/')) return next()
  if (path.extname(pathname)) return next()

  const withHtml = path.join(siteRoot, pathname + '.html')
  if (fs.existsSync(withHtml) && fs.statSync(withHtml).isFile()) {
    parsed.pathname = pathname + '.html'
    req.url = format(parsed)
    return next()
  }

  const asIndex = path.join(siteRoot, pathname, 'index.html')
  if (fs.existsSync(asIndex) && fs.statSync(asIndex).isFile()) {
    parsed.pathname = pathname + '/index.html'
    req.url = format(parsed)
  }

  return next()
}
