;(function () {
  'use strict'

  var THEME_KEY = 'theme'
  var VALID = ['light', 'dark', 'system']
  var posMap = { light: '0', dark: '1', system: '2' }
  var mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  var currentSetting

  function getStoredTheme () {
    var stored = window.localStorage && window.localStorage.getItem(THEME_KEY)
    return VALID.indexOf(stored) !== -1 ? stored : 'system'
  }

  function saveTheme (value) {
    window.localStorage && window.localStorage.setItem(THEME_KEY, value)
  }

  function applyEffectiveTheme (dark) {
    document.documentElement.classList.toggle('dark-theme', dark)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }

  function updateToggleUI (setting) {
    var containers = document.querySelectorAll('.theme-toggle')
    for (var c = 0; c < containers.length; c++) {
      var buttons = containers[c].querySelectorAll('.theme-toggle-btn')
      var pill = containers[c].querySelector('.theme-toggle-pill')
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].getAttribute('data-theme-value') === setting) {
          buttons[i].classList.add('active')
        } else {
          buttons[i].classList.remove('active')
        }
      }
      if (pill) {
        pill.setAttribute('data-pos', posMap[setting] || '2')
      }
    }
  }

  function onSystemChange (e) {
    if (currentSetting === 'system') {
      applyEffectiveTheme(e.matches)
    }
  }

  function applyTheme (setting) {
    currentSetting = setting
    if (setting === 'system') {
      applyEffectiveTheme(mediaQuery.matches)
    } else {
      applyEffectiveTheme(setting === 'dark')
    }
    updateToggleUI(setting)
  }

  // Listen for OS preference changes
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', onSystemChange)
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(onSystemChange)
  }

  // Initialize
  var initial = getStoredTheme()
  applyTheme(initial)

  // Bind click handlers on all toggle instances
  var containers = document.querySelectorAll('.theme-toggle')
  for (var c = 0; c < containers.length; c++) {
    var buttons = containers[c].querySelectorAll('.theme-toggle-btn')
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var value = this.getAttribute('data-theme-value')
        saveTheme(value)
        applyTheme(value)
      })
    }
  }
})()
