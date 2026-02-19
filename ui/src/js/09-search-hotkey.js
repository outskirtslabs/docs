/* global MutationObserver, Event */
'use strict'

function nextActiveResultIndex(currentIndex, itemCount, step) {
  if (!itemCount || itemCount < 1) return -1
  if (step > 0) {
    if (currentIndex < 0 || currentIndex >= itemCount) return 0
    return (currentIndex + 1) % itemCount
  }
  if (step < 0) {
    if (currentIndex < 0 || currentIndex >= itemCount) return itemCount - 1
    return (currentIndex - 1 + itemCount) % itemCount
  }
  return currentIndex >= 0 && currentIndex < itemCount ? currentIndex : -1
}

function isNewTabEnter(e) {
  return Boolean(e && e.key === 'Enter' && (e.ctrlKey || e.metaKey))
}

function isEditableTarget(target) {
  var tag = ((target && target.tagName) || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target && target.isContentEditable)
}

function initSearchHotkey(options) {
  var opts = options || {}
  var doc = opts.document || (typeof document !== 'undefined' ? document : null)
  var win = opts.window || (typeof window !== 'undefined' ? window : null)
  var MutationObserverCtor = opts.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null)
  var EventCtor = opts.Event || (typeof Event !== 'undefined' ? Event : null)

  if (!doc || !win) return

  var modal = doc.getElementById('search-modal')
  var triggers = [].slice.call(doc.querySelectorAll('.search-trigger'))
  var closeButtons = [].slice.call(doc.querySelectorAll('.search-modal-close'))
  var modalHeader = doc.getElementById('search-modal-header')
  var modalBody = doc.getElementById('search-modal-body')
  var modalCount = doc.getElementById('search-modal-count')
  var modalPlaceholder = doc.getElementById('search-modal-placeholder')
  var modalPlaceholderTitle = doc.getElementById('search-modal-placeholder-title')
  var modalPlaceholderHint = doc.getElementById('search-modal-placeholder-hint')
  var searchInput = doc.getElementById('search-input')
  var activeResultClass = 'search-result-document-hit--active'
  var activeResultIndex = -1

  if (!modal || !modalBody || !searchInput || !triggers.length) return

  // Move modal to document.body to escape sidebar stacking context
  doc.body.appendChild(modal)

  function getDropdown(dropdown) {
    return dropdown || modalBody.querySelector('.search-result-dropdown-menu')
  }

  function getResultHitElements(dropdown) {
    var currentDropdown = getDropdown(dropdown)
    if (!currentDropdown) return []
    var hits = [].slice.call(currentDropdown.querySelectorAll('.search-result-document-hit'))
    if (hits.length) return hits
    return [].slice.call(currentDropdown.querySelectorAll('li'))
  }

  function clearActiveResultClass(dropdown) {
    var currentDropdown = getDropdown(dropdown)
    if (!currentDropdown) return

    var activeHits = [].slice.call(currentDropdown.querySelectorAll('.' + activeResultClass))
    activeHits.forEach(function (hit) {
      hit.classList.remove(activeResultClass)
      if (typeof hit.removeAttribute === 'function') {
        hit.removeAttribute('aria-selected')
      }
    })
  }

  function resetActiveResult(dropdown) {
    activeResultIndex = -1
    clearActiveResultClass(dropdown)
  }

  function setActiveResult(index, dropdown, shouldScroll) {
    var hits = getResultHitElements(dropdown)
    clearActiveResultClass(dropdown)
    if (index < 0 || index >= hits.length) {
      activeResultIndex = -1
      return null
    }

    var hit = hits[index]
    var link = hit.querySelector('a[href]')
    activeResultIndex = index
    hit.classList.add(activeResultClass)
    if (typeof hit.setAttribute === 'function') {
      hit.setAttribute('aria-selected', 'true')
    }

    if (shouldScroll !== false && link && typeof link.scrollIntoView === 'function') {
      link.scrollIntoView({ block: 'nearest' })
    }
    return link
  }

  function reconcileActiveResult(dropdown) {
    var hits = getResultHitElements(dropdown)
    if (!hits.length || activeResultIndex < 0 || activeResultIndex >= hits.length) {
      resetActiveResult(dropdown)
      return
    }
    setActiveResult(activeResultIndex, dropdown, false)
  }

  function getActiveResultLink() {
    var hits = getResultHitElements()
    if (activeResultIndex < 0 || activeResultIndex >= hits.length) return null
    return hits[activeResultIndex].querySelector('a[href]')
  }

  function moveActiveResult(step) {
    var hits = getResultHitElements()
    var nextIndex = nextActiveResultIndex(activeResultIndex, hits.length, step)
    if (nextIndex === -1) return
    setActiveResult(nextIndex, null, true)
  }

  function activateSelectedResult(openInNewTab) {
    var activeLink = getActiveResultLink()
    if (!activeLink || !activeLink.href) return false

    if (openInNewTab) {
      if (typeof win.open === 'function') {
        win.open(activeLink.href, '_blank', 'noopener')
      }
      return true
    }

    if (win.location && typeof win.location.assign === 'function') {
      win.location.assign(activeLink.href)
    } else if (win.location) {
      win.location.href = activeLink.href
    }
    return true
  }

  function openModal() {
    if (searchInput.disabled) return
    modal.classList.remove('hidden')
    doc.documentElement.classList.add('is-clipped--search')
    resetActiveResult()
    updateResultCount()
    updatePlaceholder()
    searchInput.focus()
  }

  function closeModal() {
    modal.classList.add('hidden')
    doc.documentElement.classList.remove('is-clipped--search')
    resetActiveResult()
    if (searchInput) {
      searchInput.value = ''
      if (EventCtor) {
        searchInput.dispatchEvent(new EventCtor('keydown'))
      }
      searchInput.blur()
    }
    if (modalCount) modalCount.textContent = ''
    updatePlaceholder()
  }

  // Trigger button opens modal
  triggers.forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      openModal()
    })
  })

  // Modal close button
  closeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      closeModal()
    })
  })

  searchInput.addEventListener('input', function () {
    resetActiveResult()
    updateResultCount()
    updatePlaceholder()
  })

  searchInput.addEventListener('keydown', function (e) {
    if (modal.classList.contains('hidden')) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopImmediatePropagation()
      moveActiveResult(1)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopImmediatePropagation()
      moveActiveResult(-1)
      return
    }

    if (e.key === 'Enter') {
      if (activateSelectedResult(isNewTabEnter(e))) {
        e.preventDefault()
      }
    }
  })

  // "/" hotkey opens modal (not when in an input/textarea)
  doc.addEventListener('keydown', function (e) {
    if (!(e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey)) return
    if (isEditableTarget(e.target)) return
    e.preventDefault()
    openModal()
  })

  // Escape closes modal
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal()
    }
  })

  // Backdrop click closes modal (click on .search-modal itself, not the dialog)
  modal.addEventListener('click', function (e) {
    if (e.target === modal) {
      closeModal()
    }
  })

  // Prevent clicks inside the dialog from propagating to document.documentElement
  // (Lunr's extension adds a click handler there to clear results)
  var dialog = modal.querySelector('.search-modal-dialog')
  if (dialog) {
    dialog.addEventListener('click', function (e) {
      e.stopPropagation()
    })
  }

  // MutationObserver: when Lunr appends .search-result-dropdown-menu to
  // modal-header (the parentNode of #search-input), move it to modal-body
  if (modalHeader && MutationObserverCtor) {
    var headerObserver = new MutationObserverCtor(function () {
      var dropdown = modalHeader.querySelector('.search-result-dropdown-menu')
      if (dropdown) {
        modalBody.appendChild(dropdown)
        updateResultCount(dropdown)
        updatePlaceholder(dropdown)
        reconcileActiveResult(dropdown)
      }
    })
    headerObserver.observe(modalHeader, { childList: true })

    var bodyObserver = new MutationObserverCtor(function () {
      var dropdown = modalBody.querySelector('.search-result-dropdown-menu')
      updateResultCount(dropdown)
      updatePlaceholder(dropdown)
      reconcileActiveResult(dropdown)
    })
    bodyObserver.observe(modalBody, { childList: true, subtree: true })
  }

  function updateResultCount(dropdown) {
    if (!modalCount) return
    var query = searchInput.value.trim()
    if (!query) {
      modalCount.textContent = ''
      return
    }

    var currentDropdown = getDropdown(dropdown)
    var hits = 0
    if (currentDropdown) {
      hits = currentDropdown.querySelectorAll('.search-result-document-hit').length
      if (!hits) hits = currentDropdown.querySelectorAll('li').length
    }
    modalCount.textContent = `${hits} results`
  }

  function updatePlaceholder(dropdown) {
    if (!modalPlaceholder) return

    var query = searchInput.value.trim()
    var currentDropdown = getDropdown(dropdown)
    var hits = 0
    if (currentDropdown) {
      hits = currentDropdown.querySelectorAll('.search-result-document-hit').length
      if (!hits) hits = currentDropdown.querySelectorAll('li').length
    }

    if (!query) {
      modalPlaceholder.classList.remove('hidden')
      setPlaceholderText('Start typing to search docs', 'Results appear as you type.')
      return
    }

    if (hits > 0) {
      modalPlaceholder.classList.add('hidden')
      return
    }

    modalPlaceholder.classList.remove('hidden')
    setPlaceholderText(`No results for "${query}"`, 'Try another keyword.')
  }

  function setPlaceholderText(title, hint) {
    if (modalPlaceholderTitle && modalPlaceholderTitle.textContent !== title) {
      modalPlaceholderTitle.textContent = title
    }
    if (modalPlaceholderHint && modalPlaceholderHint.textContent !== hint) {
      modalPlaceholderHint.textContent = hint
    }
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initSearchHotkey()
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initSearchHotkey: initSearchHotkey,
    isNewTabEnter: isNewTabEnter,
    nextActiveResultIndex: nextActiveResultIndex,
  }
}
