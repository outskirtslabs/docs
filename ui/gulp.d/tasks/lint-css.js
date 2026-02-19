'use strict'

const { spawn } = require('child_process')

const biomeBin = require.resolve('@biomejs/biome/bin/biome')

module.exports = (files) => () => {
  const patterns = Array.isArray(files) ? files : [files]
  const includePatterns = patterns.filter((pattern) => !pattern.startsWith('!'))
  return runBiome([
    'check',
    '--formatter-enabled=false',
    '--assist-enabled=false',
    '--files-ignore-unknown=true',
    '--no-errors-on-unmatched',
    '--reporter=summary',
    ...includePatterns,
  ])
}

function runBiome(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [biomeBin, ...args], { stdio: 'inherit' })

    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Biome exited with status ${code}.`))
    })
  })
}
