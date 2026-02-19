'use strict'

module.exports.register = function register() {
  this.once('contentClassified', ({ contentCatalog }) => {
    contentCatalog.getComponents().forEach((component) => {
      // If a component already has a versionless version, /component/ already resolves.
      if (component.versions.find((it) => !it.version)) return

      const rel = contentCatalog.resolvePage('index.adoc', { component: component.name })
      if (!rel) return

      contentCatalog.addFile({
        src: { component: component.name, version: '', module: 'ROOT', family: 'alias', relative: 'index.adoc' },
        rel,
      })
    })
  })
}
