'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const isLocalSiteUrl = require('../src/helpers/isLocalSiteUrl')

test('returns true for localhost URLs', () => {
  assert.equal(isLocalSiteUrl('http://localhost:8084'), true)
  assert.equal(isLocalSiteUrl('https://localhost'), true)
})

test('returns true for loopback IP URLs', () => {
  assert.equal(isLocalSiteUrl('http://127.0.0.1:3000'), true)
  assert.equal(isLocalSiteUrl('http://[::1]:3000'), true)
})

test('returns false for non-local URLs and invalid values', () => {
  assert.equal(isLocalSiteUrl('https://docs.outskirtslabs.com'), false)
  assert.equal(isLocalSiteUrl('/relative/path'), false)
  assert.equal(isLocalSiteUrl(undefined), false)
})
