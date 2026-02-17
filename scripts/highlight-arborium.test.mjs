import assert from 'node:assert/strict'
import test from 'node:test'

import { transformHtml } from './highlight-arborium.mjs'

function wrapBlock ({ preClass = 'highlight', codeClass = '', dataLang = null, codeHtml = '' } = {}) {
  const classAttr = codeClass ? ` class="${codeClass}"` : ''
  const dataLangAttr = dataLang ? ` data-lang="${dataLang}"` : ''
  return `<pre class="${preClass}"><code${classAttr}${dataLangAttr}>${codeHtml}</code></pre>`
}

test('replaces supported code blocks with arborium html', () => {
  const calls = []
  const input = wrapBlock({
    codeClass: 'language-javascript',
    dataLang: 'javascript',
    codeHtml: 'const value = &quot;ok&quot;;',
  })

  const transformed = transformHtml(input, {
    highlight: (language, source) => {
      calls.push({ language, source })
      return { ok: true, html: '<a-k>const</a-k> value <a-o>=</a-o> <a-s>&quot;ok&quot;</a-s>;' }
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].language, 'javascript')
  assert.equal(calls[0].source, 'const value = "ok";')
  assert.match(transformed.html, /<a-k>const<\/a-k>/)
  assert.equal(transformed.stats.highlighted, 1)
  assert.equal(transformed.stats.candidates, 1)
  assert.equal(transformed.stats.unsupported, 0)
})

test('normalizes shell alias to bash', () => {
  const calls = []
  const input = wrapBlock({
    codeClass: 'language-shell',
    dataLang: 'shell',
    codeHtml: '$ echo hi',
  })

  const transformed = transformHtml(input, {
    highlight: (language) => {
      calls.push(language)
      return { ok: true, html: '<a-o>$</a-o> <a-f>echo</a-f> hi' }
    },
  })

  assert.deepEqual(calls, ['bash'])
  assert.equal(transformed.stats.highlighted, 1)
})

test('leaves unsupported-language blocks unchanged', () => {
  const input = wrapBlock({
    codeClass: 'language-console',
    dataLang: 'console',
    codeHtml: '&gt; repl prompt',
  })

  const transformed = transformHtml(input, {
    highlight: () => ({ ok: false, kind: 'unsupported', message: 'unsupported language: console' }),
  })

  assert.equal(transformed.html, input)
  assert.equal(transformed.stats.highlighted, 0)
  assert.equal(transformed.stats.unsupported, 1)
  assert.equal(transformed.stats.candidates, 1)
})
