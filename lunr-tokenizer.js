// The tokenization used by lunr by default doesn't work well with code.
// We extend the set of characters considered separators to include
// parentheses and commas.

const path = require('path');
const fs = require('fs');

module.exports.register = () => {
  const lunr = require('lunr');
  lunr.tokenizer.separator = /[\s\-(),/]+/;
  lunr.QueryLexer.termSeparator = lunr.tokenizer.separator;

  // The lunr source code is vendored into the UI, and tokenization for search results
  // is done client side, so we have to patch this file to fix tokenization too.
  const patch = `(function () { globalThis.lunr.tokenizer.separator = ${lunr.tokenizer.separator.toString()}; })();`

  const searchUiPath = path.join(
    path.dirname(require.resolve('@antora/lunr-extension/package.json')),
    'data/js/search-ui.js',
  );

  let searchUi = fs.readFileSync(searchUiPath, 'utf8');

  if (!searchUi.includes(patch)) {
    searchUi = searchUi + patch;
  }

  // Patch: sort search results to prioritize the current component.
  // Reads data-current-component from #search-modal (set by nav-search.hbs).
  // Uses a stable sort so Lunr's relevance ordering is preserved within each group.
  const sortMarker = '/* patched: component-priority-sort */';
  const sortFind = 'const result = search(index, store.documents, text);';
  const sortReplace = [
    'const result = search(index, store.documents, text);',
    '    ' + sortMarker,
    '    const _ccEl = document.getElementById(\'search-modal\');',
    '    const _cc = _ccEl && _ccEl.dataset.currentComponent || \'\';',
    '    if (_cc) {',
    '      result.sort(function (a, b) {',
    '        const _ad = store.documents[a.ref.split(\'-\')[0]];',
    '        const _bd = store.documents[b.ref.split(\'-\')[0]];',
    '        return (_ad && _ad.component === _cc ? 0 : 1) - (_bd && _bd.component === _cc ? 0 : 1);',
    '      });',
    '    }',
  ].join('\n');

  if (!searchUi.includes(sortMarker)) {
    searchUi = searchUi.replace(sortFind, sortReplace);
  }

  // Patch: filter search results to exclude other versions of the current component.
  // When viewing ol.client-ip v0.1, results from ol.client-ip "next" are hidden,
  // but results from other components (any version) are kept.
  // Wraps the filter() function in search-ui.js which is called for all three
  // search passes (exact, begins-with, contains).
  const versionMarker = '/* patched: version-filter */';
  const versionFind = 'function filter (result, documents) {';
  const versionReplace = [
    'function filter (result, documents) {',
    '    ' + versionMarker,
    '    const _vfEl = document.getElementById(\'search-modal\');',
    '    const _vfComp = _vfEl && _vfEl.dataset.currentComponent || \'\';',
    '    const _vfVer = _vfEl && _vfEl.dataset.currentVersion || \'\';',
  ].join('\n');

  if (!searchUi.includes(versionMarker)) {
    searchUi = searchUi.replace(versionFind, versionReplace);
  }

  const versionReturnFind = '    return result\n  }';
  const versionReturnReplace = [
    '    if (_vfComp && _vfVer) {',
    '      result = result.filter(function (item) {',
    '        var _doc = documents[item.ref.split(\'-\')[0]];',
    '        if (!_doc) return true;',
    '        if (_doc.component !== _vfComp) return true;',
    '        return _doc.version === _vfVer;',
    '      });',
    '    }',
    '    return result',
    '  }',
  ].join('\n');

  const versionReturnMarker = '/* patched: version-filter-return */';
  if (!searchUi.includes(versionReturnMarker)) {
    searchUi = searchUi.replace(versionReturnFind, versionReturnMarker + '\n' + versionReturnReplace);
  }

  fs.writeFileSync(searchUiPath, searchUi);
};
