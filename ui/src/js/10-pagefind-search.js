/* global CustomEvent */
'use strict'

function debounce(func, wait) {
  var timeout
  return function () {
    var context = this
    var args = arguments
    clearTimeout(timeout)
    timeout = setTimeout(function () {
      func.apply(context, args)
    }, wait)
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(function (term) {
      return term.replace(/^[^a-z0-9._/-]+|[^a-z0-9._/-]+$/g, '')
    })
    .filter(Boolean)
}

function normalizeSiteRootPath(siteRootPath) {
  var root = String(siteRootPath || '').trim()
  if (!root || root === '/') return ''
  return root.replace(/\/+$/, '')
}

function resolveAssetPath(siteRootPath, assetPath) {
  var root = normalizeSiteRootPath(siteRootPath)
  var path = String(assetPath || '').replace(/^\/+/, '')
  if (!root) return '/' + path
  return root + '/' + path
}

function filterHitsByCurrentVersion(hits, currentComponent, currentVersion) {
  if (!currentComponent || !currentVersion) return hits
  return hits.filter(function (hit) {
    if (!hit || !hit.component) return true
    if (hit.component !== currentComponent) return true
    return String(hit.version || '') === String(currentVersion)
  })
}

function sortHits(hits, currentComponent) {
  var indexedHits = hits.map(function (hit, index) {
    return { hit: hit, index: index }
  })

  indexedHits.sort(function (a, b) {
    var aPriority = currentComponent && a.hit.component === currentComponent ? 0 : 1
    var bPriority = currentComponent && b.hit.component === currentComponent ? 0 : 1
    if (aPriority !== bPriority) return aPriority - bPriority

    if (a.hit.rank !== b.hit.rank) return a.hit.rank - b.hit.rank

    var aScore = Number(a.hit.score || 0)
    var bScore = Number(b.hit.score || 0)
    if (aScore !== bScore) return bScore - aScore

    if (a.hit.subRank !== b.hit.subRank) return a.hit.subRank - b.hit.subRank

    return a.index - b.index
  })

  return indexedHits.map(function (entry) {
    return entry.hit
  })
}

function collectSearchHits(resultsWithData) {
  var maxSubResultsPerPage = 3
  var hits = []

  resultsWithData.forEach(function (result, rank) {
    var data = result && result.data ? result.data : null
    if (!data || !data.url) return

    var meta = data.meta || {}
    var pageTitle = meta.title || ''
    var baseHit = {
      component: meta.component || '',
      componentTitle: meta.component_title || meta.component || '',
      version: meta.version || '',
      displayVersion: meta.display_version || meta.version || '',
      pageTitle: pageTitle,
      score: Number(result.score || 0),
      rank: typeof result.rank === 'number' ? result.rank : rank,
    }

    var seenUrls = new Set()
    var subResults = Array.isArray(data.sub_results) ? data.sub_results : []
    var subResultHits = subResults
      .filter(function (subResult) {
        return Boolean(subResult && subResult.url && subResult.excerpt)
      })
      .filter(function (subResult) {
        if (seenUrls.has(subResult.url)) return false
        seenUrls.add(subResult.url)
        return true
      })
      .slice(0, maxSubResultsPerPage)
      .map(function (subResult, subRank) {
        return {
          ...baseHit,
          subRank: subRank,
          sectionTitle: subResult.title && subResult.title !== pageTitle ? subResult.title : '',
          excerpt: subResult.excerpt || data.excerpt || '',
          url: subResult.url || data.url,
        }
      })

    if (subResultHits.length > 0) {
      hits.push.apply(hits, subResultHits)
      return
    }

    hits.push({
      ...baseHit,
      subRank: 0,
      sectionTitle: '',
      excerpt: data.excerpt || '',
      url: data.url,
    })
  })

  return hits
}

function getComponentHeaderText(hit) {
  var title = hit.componentTitle || hit.component || 'Documentation'
  if (hit.displayVersion) return title + ' ' + hit.displayVersion
  if (hit.version) return title + ' ' + hit.version
  return title
}

function clearSearchResults(container) {
  if (!container) return
  container.innerHTML = ''
}

function appendHighlightedText(doc, target, text, terms) {
  var source = String(text || '')
  if (!source) return

  var uniqueTerms = Array.from(
    new Set(
      (terms || [])
        .map(function (term) {
          return String(term || '').trim()
        })
        .filter(Boolean)
    )
  )

  if (!uniqueTerms.length) {
    target.appendChild(doc.createTextNode(source))
    return
  }

  uniqueTerms.sort(function (a, b) {
    return b.length - a.length
  })

  var pattern = uniqueTerms.map(escapeRegExp).join('|')
  if (!pattern) {
    target.appendChild(doc.createTextNode(source))
    return
  }

  var regex = new RegExp('(' + pattern + ')', 'ig')
  var lastIndex = 0
  var match

  while ((match = regex.exec(source)) !== null) {
    if (match.index > lastIndex) {
      target.appendChild(doc.createTextNode(source.slice(lastIndex, match.index)))
    }
    var mark = doc.createElement('span')
    mark.classList.add('search-result-highlight')
    mark.textContent = match[0]
    target.appendChild(mark)
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < source.length) {
    target.appendChild(doc.createTextNode(source.slice(lastIndex)))
  }
}

function appendExcerpt(doc, target, excerptHtml) {
  var html = String(excerptHtml || '')
  if (!html) return

  var template = doc.createElement('template')
  template.innerHTML = html
  var marks = template.content.querySelectorAll('mark')
  marks.forEach(function (markEl) {
    var replacement = doc.createElement('span')
    replacement.classList.add('search-result-highlight')
    replacement.textContent = markEl.textContent
    markEl.replaceWith(replacement)
  })
  target.appendChild(template.content)
}

function createSearchResultItem(doc, hit, terms) {
  var searchResultItem = doc.createElement('div')
  searchResultItem.classList.add('search-result-item')

  var documentTitle = doc.createElement('div')
  documentTitle.classList.add('search-result-document-title')
  appendHighlightedText(doc, documentTitle, hit.pageTitle, terms)

  var documentHit = doc.createElement('div')
  documentHit.classList.add('search-result-document-hit')

  var documentHitLink = doc.createElement('a')
  documentHitLink.href = hit.url
  if (hit.sectionTitle) {
    var sectionTitle = doc.createElement('div')
    sectionTitle.classList.add('search-result-section-title')
    appendHighlightedText(doc, sectionTitle, hit.sectionTitle, terms)
    documentHitLink.appendChild(sectionTitle)
  }
  appendExcerpt(doc, documentHitLink, hit.excerpt)
  documentHit.appendChild(documentHitLink)

  searchResultItem.appendChild(documentTitle)
  searchResultItem.appendChild(documentHit)
  searchResultItem.addEventListener('mousedown', function (e) {
    e.preventDefault()
  })

  return searchResultItem
}

function renderSearchResults(doc, container, hits, terms) {
  clearSearchResults(container)
  if (!hits.length) return

  var dataset = doc.createElement('div')
  dataset.classList.add('search-result-dataset')
  var currentHeader = null

  hits.forEach(function (hit) {
    var headerText = getComponentHeaderText(hit)
    if (headerText && headerText !== currentHeader) {
      var header = doc.createElement('div')
      header.classList.add('search-result-component-header')
      header.textContent = headerText
      dataset.appendChild(header)
      currentHeader = headerText
    }

    dataset.appendChild(createSearchResultItem(doc, hit, terms))
  })

  container.appendChild(dataset)
}

function enableSearchInput(searchInput, enabled, title) {
  if (!searchInput) return
  searchInput.disabled = !enabled
  searchInput.title = title || ''
}

function initPagefindSearch(options) {
  var opts = options || {}
  var doc = opts.document || (typeof document !== 'undefined' ? document : null)
  var win = opts.window || (typeof window !== 'undefined' ? window : null)
  var CustomEventCtor = opts.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null)

  if (!doc || !win) return

  var modal = doc.getElementById('search-modal')
  var modalBody = doc.getElementById('search-modal-body')
  var searchInput = doc.getElementById('search-input')
  var searchConfig = doc.getElementById('search-ui-config')

  if (!modal || !modalBody || !searchInput || !searchConfig) return

  var siteRootPath = searchConfig.dataset.siteRootPath || ''
  var excerptLength = Number.parseInt(searchConfig.dataset.excerptLength || '30', 10)
  var currentComponent = modal.dataset.currentComponent || ''
  var currentVersion = modal.dataset.currentVersion || ''
  var resultLimit = 25
  var searchToken = 0
  var pagefindPromise

  var searchResultContainer = doc.createElement('div')
  searchResultContainer.classList.add('search-result-dropdown-menu')
  modalBody.appendChild(searchResultContainer)

  function dispatchLoadedIndexEvent() {
    if (!CustomEventCtor) return
    searchInput.dispatchEvent(new CustomEventCtor('loadedindex'))
  }

  async function ensurePagefind() {
    if (!pagefindPromise) {
      var modulePath = resolveAssetPath(siteRootPath, 'pagefind/pagefind.js')
      pagefindPromise = import(modulePath)
        .then(function (moduleValue) {
          return moduleValue && moduleValue.default ? moduleValue.default : moduleValue
        })
        .then(async function (pagefindApi) {
          await pagefindApi.options({
            excerptLength: Number.isFinite(excerptLength) ? excerptLength : 30,
          })
          await pagefindApi.init()
          return pagefindApi
        })
    }
    return pagefindPromise
  }

  async function runSearch(query, token) {
    var trimmedQuery = query.trim()
    if (!trimmedQuery) {
      clearSearchResults(searchResultContainer)
      return
    }

    var pagefindApi = await ensurePagefind()
    if (token !== searchToken) return

    var searchResult = await pagefindApi.search(trimmedQuery)
    if (token !== searchToken || !searchResult) return

    var pageResults = Array.isArray(searchResult.results) ? searchResult.results : []
    var loadedResults = await Promise.all(
      pageResults.slice(0, resultLimit).map(async function (result, rank) {
        return {
          score: result.score,
          rank: rank,
          data: await result.data(),
        }
      })
    )
    if (token !== searchToken) return

    var hits = collectSearchHits(loadedResults)
    hits = filterHitsByCurrentVersion(hits, currentComponent, currentVersion)
    hits = sortHits(hits, currentComponent)
    renderSearchResults(doc, searchResultContainer, hits, tokenizeQuery(trimmedQuery))
  }

  var debouncedSearch = debounce(function () {
    var query = searchInput.value || ''
    var token = ++searchToken

    if (!query.trim()) {
      clearSearchResults(searchResultContainer)
      return
    }

    runSearch(query, token).catch(function (error) {
      if (token !== searchToken) return
      clearSearchResults(searchResultContainer)
      if (typeof console !== 'undefined' && console.error) {
        console.error('Pagefind search failed', error)
      }
    })
  }, 120)

  searchInput.addEventListener('input', function () {
    debouncedSearch()
  })

  enableSearchInput(searchInput, false, 'Loading index...')
  ensurePagefind()
    .then(function () {
      enableSearchInput(searchInput, true)
      dispatchLoadedIndexEvent()
    })
    .catch(function (error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('Failed to initialize Pagefind', error)
      }
      enableSearchInput(searchInput, false, 'Search unavailable')
    })
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initPagefindSearch()
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    collectSearchHits: collectSearchHits,
    filterHitsByCurrentVersion: filterHitsByCurrentVersion,
    initPagefindSearch: initPagefindSearch,
    resolveAssetPath: resolveAssetPath,
    sortHits: sortHits,
    tokenizeQuery: tokenizeQuery,
  }
}
