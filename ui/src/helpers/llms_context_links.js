'use strict'

function fileLinks(basePath) {
  return [
    { href: `${basePath}/llms.txt`, label: `${basePath}/llms.txt` },
    { href: `${basePath}/llms-full.txt`, label: `${basePath}/llms-full.txt` },
  ]
}

function isHandlebarsOptions(value) {
  return !!(value && typeof value === 'object' && value.hash && value.data)
}

function toLabel(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((it) => toLabel(it)).join('').trim()
  if (typeof value === 'object') {
    for (const key of ['text', 'value', 'content', 'label', 'title']) {
      const candidate = toLabel(value[key])
      if (candidate) return candidate
    }
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const str = String(value).trim()
      if (str && str !== '[object Object]') return str
    }
    return ''
  }
  const str = String(value).trim()
  return str === '[object Object]' ? '' : str
}

module.exports = (page, siteTitleOrOptions, maybeOptions) => {
  let siteTitle = siteTitleOrOptions
  if (isHandlebarsOptions(siteTitleOrOptions)) siteTitle = undefined
  if (isHandlebarsOptions(maybeOptions)) {
    // no-op; present only when called as a handlebars helper
  }

  const siteLabel = toLabel(siteTitle) || toLabel(page && page.site && page.site.title) || 'docs'

  const links = {
    site: {
      label: siteLabel,
      files: fileLinks(''),
    },
    component: null,
    version: null,
  }

  const componentName = page && page.component && page.component.name
  if (!componentName || componentName === 'ROOT') return links

  const componentBase = `/${componentName}`
  links.component = {
    label: componentName,
    files: fileLinks(componentBase),
  }

  const version = (page && page.version) || (page && page.componentVersion && page.componentVersion.version)
  if (!version) return links

  const versionBase = `${componentBase}/${version}`
  const versionLabel = (page && page.componentVersion && page.componentVersion.displayVersion) || version
  links.version = {
    label: versionLabel,
    files: fileLinks(versionBase),
  }

  return links
}
