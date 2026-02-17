/* global MutationObserver, Event */
;(function () {
  'use strict'

  var modal = document.getElementById('search-modal')
  var trigger = document.getElementById('search-trigger')
  var modalHeader = document.getElementById('search-modal-header')
  var modalBody = document.getElementById('search-modal-body')
  var searchInput = document.getElementById('search-input')

  if (!modal || !trigger || !searchInput) return

  // Move modal to document.body to escape sidebar stacking context
  document.body.appendChild(modal)

  function openModal () {
    if (searchInput.disabled) return
    modal.classList.remove('hidden')
    document.documentElement.classList.add('is-clipped--search')
    searchInput.focus()
  }

  function closeModal () {
    modal.classList.add('hidden')
    document.documentElement.classList.remove('is-clipped--search')
    if (searchInput) {
      searchInput.value = ''
      searchInput.dispatchEvent(new Event('keydown'))
      searchInput.blur()
    }
  }

  // Trigger button opens modal
  trigger.addEventListener('click', function () {
    openModal()
  })

  // "/" hotkey opens modal (not when in an input/textarea)
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
      e.preventDefault()
      openModal()
    }
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
      }
    })
    headerObserver.observe(modalHeader, { childList: true })
  }
})()
