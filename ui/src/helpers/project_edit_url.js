'use strict'

const PROJECT_INDEX_PATH = '/doc/modules/ROOT/pages/index.adoc'

module.exports = (url) => {
  if (!url || typeof url !== 'string') return url
  if (!url.includes(PROJECT_INDEX_PATH)) return url
  return url.replace(PROJECT_INDEX_PATH, '/README.adoc')
}
