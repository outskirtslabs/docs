'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { nextActiveResultIndex, isNewTabEnter } = require('../src/js/09-search-hotkey')

test('ArrowDown selects first result when nothing is active', () => {
  assert.equal(nextActiveResultIndex(-1, 3, 1), 0)
})

test('ArrowDown wraps from last result to first result', () => {
  assert.equal(nextActiveResultIndex(2, 3, 1), 0)
})

test('ArrowUp selects last result when nothing is active', () => {
  assert.equal(nextActiveResultIndex(-1, 3, -1), 2)
})

test('ArrowUp wraps from first result to last result', () => {
  assert.equal(nextActiveResultIndex(0, 3, -1), 2)
})

test('returns -1 when there are no results', () => {
  assert.equal(nextActiveResultIndex(-1, 0, 1), -1)
  assert.equal(nextActiveResultIndex(0, 0, -1), -1)
})

test('Ctrl/Cmd+Enter opens result in a new tab', () => {
  assert.equal(isNewTabEnter({ key: 'Enter', ctrlKey: true, metaKey: false }), true)
  assert.equal(isNewTabEnter({ key: 'Enter', ctrlKey: false, metaKey: true }), true)
  assert.equal(isNewTabEnter({ key: 'Enter', ctrlKey: false, metaKey: false }), false)
  assert.equal(isNewTabEnter({ key: 'a', ctrlKey: true, metaKey: true }), false)
})
