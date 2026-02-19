'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const llmsContextLinks = require('../src/helpers/llms_context_links')

test('returns site-level links for root content', () => {
  const links = llmsContextLinks({ component: { name: 'ROOT' } }, 'Outskirts Labs Docs')

  assert.equal(links.site.label, 'Outskirts Labs Docs')
  assert.deepEqual(links.site.files, [
    { href: '/llms.txt', label: '/llms.txt' },
    { href: '/llms-full.txt', label: '/llms-full.txt' },
  ])
  assert.equal(links.component, null)
  assert.equal(links.version, null)
})

test('normalizes non-string site title values from template context', () => {
  const links = llmsContextLinks({ component: { name: 'ROOT' } }, { value: 'Outskirts Labs Docs' })

  assert.equal(links.site.label, 'Outskirts Labs Docs')
})

test('falls back to site links when page context is missing', () => {
  const links = llmsContextLinks()

  assert.equal(links.site.label, 'docs')
  assert.equal(links.component, null)
  assert.equal(links.version, null)
})

test('returns site, component, and version links for versioned pages', () => {
  const links = llmsContextLinks(
    {
      component: { name: 'ol.client-ip', title: 'client-ip' },
      version: '0.1',
      componentVersion: { displayVersion: '0.1' },
    },
    'Outskirts Labs Docs'
  )

  assert.equal(links.site.label, 'Outskirts Labs Docs')
  assert.equal(links.component.label, 'ol.client-ip')
  assert.deepEqual(links.component.files, [
    { href: '/ol.client-ip/llms.txt', label: '/ol.client-ip/llms.txt' },
    { href: '/ol.client-ip/llms-full.txt', label: '/ol.client-ip/llms-full.txt' },
  ])
  assert.equal(links.version.label, '0.1')
  assert.deepEqual(links.version.files, [
    { href: '/ol.client-ip/0.1/llms.txt', label: '/ol.client-ip/0.1/llms.txt' },
    { href: '/ol.client-ip/0.1/llms-full.txt', label: '/ol.client-ip/0.1/llms-full.txt' },
  ])
})
