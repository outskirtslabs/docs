'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  collectSearchHits,
  filterHitsByCurrentVersion,
  resolveAssetPath,
  sortHits,
  tokenizeQuery,
} = require('../src/js/10-pagefind-search')

test('resolveAssetPath supports root and nested paths', () => {
  assert.equal(resolveAssetPath('', 'pagefind/pagefind.js'), '/pagefind/pagefind.js')
  assert.equal(resolveAssetPath('.', 'pagefind/pagefind.js'), './pagefind/pagefind.js')
  assert.equal(resolveAssetPath('..', 'pagefind/pagefind.js'), '../pagefind/pagefind.js')
  assert.equal(resolveAssetPath('/docs', 'pagefind/pagefind.js'), '/docs/pagefind/pagefind.js')
})

test('tokenizeQuery strips punctuation around terms', () => {
  assert.deepEqual(tokenizeQuery('  ol.client-ip (core)  '), ['ol.client-ip', 'core'])
})

test('filterHitsByCurrentVersion keeps non-current components at any version', () => {
  const hits = [
    { component: 'ol.client-ip', version: 'next', url: '/client-ip/latest' },
    { component: 'ol.client-ip', version: '1.0', url: '/client-ip/1.0' },
    { component: 'ol.sfv', version: 'next', url: '/sfv/latest' },
  ]

  const filtered = filterHitsByCurrentVersion(hits, 'ol.client-ip', '1.0')
  assert.deepEqual(
    filtered.map((hit) => hit.url),
    ['/client-ip/1.0', '/sfv/latest']
  )
})

test('sortHits prioritizes current component and preserves relevance ordering', () => {
  const hits = [
    { component: 'ol.sfv', rank: 0, score: 100, subRank: 0, url: '/a' },
    { component: 'ol.client-ip', rank: 2, score: 50, subRank: 0, url: '/b' },
    { component: 'ol.client-ip', rank: 1, score: 10, subRank: 0, url: '/c' },
    { component: 'ol.sfv', rank: 3, score: 5, subRank: 0, url: '/d' },
  ]

  const sorted = sortHits(hits, 'ol.client-ip')
  assert.deepEqual(
    sorted.map((hit) => hit.url),
    ['/c', '/b', '/a', '/d']
  )
})

test('collectSearchHits expands sub results and falls back to page excerpts', () => {
  const hits = collectSearchHits([
    {
      score: 2,
      rank: 0,
      data: {
        url: '/one',
        excerpt: 'fallback',
        meta: { title: 'One', component: 'a', version: 'next' },
        sub_results: [
          { title: 'One', url: '/one', excerpt: 'one main' },
          { title: 'Section', url: '/one#section', excerpt: 'one section' },
        ],
      },
    },
    {
      score: 1,
      rank: 1,
      data: {
        url: '/two',
        excerpt: 'two fallback',
        meta: { title: 'Two', component: 'b', version: 'next' },
        sub_results: [],
      },
    },
  ])

  assert.equal(hits.length, 3)
  assert.deepEqual(
    hits.map((hit) => hit.url),
    ['/one', '/one#section', '/two']
  )
  assert.equal(hits[1].sectionTitle, 'Section')
  assert.equal(hits[2].excerpt, 'two fallback')
})
