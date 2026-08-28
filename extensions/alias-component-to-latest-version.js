'use strict'

const addIndexAlias = (contentCatalog, component, rel) =>
  contentCatalog.addFile({
    src: { component, version: '', module: 'ROOT', family: 'alias', relative: 'index.adoc' },
    rel,
  })

const addRootAlias = (contentCatalog, name, rel) =>
  contentCatalog.addFile({
    src: { component: 'ROOT', version: '', module: 'ROOT', family: 'alias', relative: `${name}.adoc` },
    rel,
  })

module.exports.register = function register(context, vars) {
  const aliasesByComponent = vars?.config?.aliases || {}

  context.once('contentClassified', ({ contentCatalog }) => {
    const components = contentCatalog.getComponents()
    const componentNames = new Set(components.map(({ name }) => name))

    components.forEach((component) => {
      // A versionless component already owns both /component and /component/.
      if (component.versions.find((it) => !it.version)) return

      const page = contentCatalog.resolvePage('index.adoc', { component: component.name })
      if (!page) return

      const componentAlias = addIndexAlias(contentCatalog, component.name, page)
      addRootAlias(contentCatalog, component.name, page)

      const aliasNames = new Set()
      if (component.name.startsWith('ol.')) aliasNames.add(component.name.slice(3))

      const configuredAliases = aliasesByComponent[component.name]
      if (Array.isArray(configuredAliases)) {
        configuredAliases.forEach((name) => aliasNames.add(name))
      }

      // Antora 3 cannot chain aliases, so present the component alias as a page target.
      const componentRoot = { src: { family: 'page' }, pub: componentAlias.pub }
      aliasNames.forEach((name) => {
        if (!name || componentNames.has(name)) return
        addRootAlias(contentCatalog, name, componentRoot)
        addIndexAlias(contentCatalog, name, componentRoot)
      })
    })
  })
}
