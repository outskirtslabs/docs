/* global MutationObserver, Event */
;(function () {
  'use strict'

  var modal = document.getElementById('search-modal')
  var triggers = [].slice.call(document.querySelectorAll('.search-trigger'))
  var closeButtons = [].slice.call(document.querySelectorAll('.search-modal-close'))
  var modalHeader = document.getElementById('search-modal-header')
  var modalBody = document.getElementById('search-modal-body')
  var modalCount = document.getElementById('search-modal-count')
  var modalPlaceholder = document.getElementById('search-modal-placeholder')
  var modalPlaceholderTitle = document.getElementById('search-modal-placeholder-title')
  var modalPlaceholderHint = document.getElementById('search-modal-placeholder-hint')
  var searchInput = document.getElementById('search-input')

  if (!modal || !searchInput || !triggers.length) return

  // Move modal to document.body to escape sidebar stacking context
  document.body.appendChild(modal)

  function openModal() {
    if (searchInput.disabled) return
    modal.classList.remove('hidden')
    document.documentElement.classList.add('is-clipped--search')
    updateResultCount()
    updatePlaceholder()
    searchInput.focus()
  }

  function closeModal() {
    modal.classList.add('hidden')
    document.documentElement.classList.remove('is-clipped--search')
    if (searchInput) {
      searchInput.value = ''
      searchInput.dispatchEvent(new Event('keydown'))
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
    updateResultCount()
    updatePlaceholder()
  })

  // "/" hotkey opens modal (not when in an input/textarea)
  document.addEventListener('keydown', function (e) {
    if (!(e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey)) return

    var tag = (e.target.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return

    e.preventDefault()
    openModal()
  })

  // Escape closes modal
  document.addEventListener('keydown', function (e) {
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
  if (modalHeader && modalBody) {
    var headerObserver = new MutationObserver(function () {
      var dropdown = modalHeader.querySelector('.search-result-dropdown-menu')
      if (dropdown) {
        modalBody.appendChild(dropdown)
        updateResultCount(dropdown)
        updatePlaceholder(dropdown)
      }
    })
    headerObserver.observe(modalHeader, { childList: true })

    var bodyObserver = new MutationObserver(function () {
      var dropdown = modalBody.querySelector('.search-result-dropdown-menu')
      updateResultCount(dropdown)
      updatePlaceholder(dropdown)
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

    var currentDropdown = dropdown || modalBody.querySelector('.search-result-dropdown-menu')
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
    var currentDropdown = dropdown || modalBody.querySelector('.search-result-dropdown-menu')
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
})()
