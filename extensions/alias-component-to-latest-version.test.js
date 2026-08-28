'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const extension = require('./alias-component-to-latest-version')

test('aliases project roots and short ol project names', () => {
  const pages = new Map()
  const components = [
    { name: 'ROOT', versions: [{ version: '' }] },
    { name: 'ol.clave', versions: [{ version: 'next' }] },
    { name: 'ol.ron', versions: [{ version: 'next' }] },
    { name: 'datahike-sqlite', versions: [{ version: 'next' }] },
    { name: 'ol.shared', versions: [{ version: 'next' }] },
    { name: 'shared', versions: [{ version: 'next' }] },
    { name: 'ol.legacy', versions: [{ version: '' }] },
  ]

  components.forEach(({ name }) => pages.set(name, { src: { component: name, family: 'page' } }))

  const aliases = []
  const contentCatalog = {
    getComponents: () => components,
    resolvePage: (_page, { component }) => pages.get(component),
    addFile: (file) => {
      const { component, relative } = file.src
      const url = component === 'ROOT' ? `/${relative.slice(0, -5)}` : `/${component}/`
      file.pub = { url }
      aliases.push(file)
      return file
    },
  }

  let contentClassified
  extension.register({
    once: (event, listener) => {
      assert.equal(event, 'contentClassified')
      contentClassified = listener
    },
  }, {
    config: { aliases: { 'ol.ron': ['clj-ron', 'ron-clj'] } },
  })
  contentClassified({ contentCatalog })

  const alias = (component, relative) =>
    aliases.find((file) => file.src.component === component && file.src.relative === relative)

  const claveRoot = alias('ol.clave', 'index.adoc')
  assert.equal(claveRoot.rel, pages.get('ol.clave'))
  assert.equal(alias('ROOT', 'ol.clave.adoc').rel, pages.get('ol.clave'))
  assert.equal(alias('ROOT', 'clave.adoc').rel.pub.url, '/ol.clave/')
  assert.equal(alias('clave', 'index.adoc').rel.pub.url, '/ol.clave/')

  const ronRoot = alias('ol.ron', 'index.adoc')
  assert.equal(ronRoot.rel, pages.get('ol.ron'))
  assert.equal(alias('ROOT', 'ol.ron.adoc').rel, pages.get('ol.ron'))
  assert.equal(alias('ROOT', 'ron.adoc').rel.pub.url, '/ol.ron/')
  assert.equal(alias('ron', 'index.adoc').rel.pub.url, '/ol.ron/')
  assert.equal(alias('ROOT', 'clj-ron.adoc').rel.pub.url, '/ol.ron/')
  assert.equal(alias('clj-ron', 'index.adoc').rel.pub.url, '/ol.ron/')
  assert.equal(alias('ROOT', 'ron-clj.adoc').rel.pub.url, '/ol.ron/')
  assert.equal(alias('ron-clj', 'index.adoc').rel.pub.url, '/ol.ron/')

  assert.equal(alias('datahike-sqlite', 'index.adoc').rel, pages.get('datahike-sqlite'))
  assert.equal(alias('ROOT', 'datahike-sqlite.adoc').rel, pages.get('datahike-sqlite'))

  assert.equal(alias('ROOT', 'shared.adoc').rel, pages.get('shared'))
  assert.equal(alias('shared', 'index.adoc').rel, pages.get('shared'))
  assert.equal(alias('ROOT', 'legacy.adoc'), undefined)
  assert.equal(alias('ol.legacy', 'index.adoc'), undefined)
})
