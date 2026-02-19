#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uiRoot = path.resolve(__dirname, '..')
const srcDir = path.join(uiRoot, 'src')
const stageDir = path.join(uiRoot, 'public', '_')
const buildDir = path.join(uiRoot, 'build')
const sourcemaps = process.env.SOURCEMAPS === 'true'

const tabsCssEntryName = '.asciidoctor-tabs.lightningcss-build.css'
const siteJsEntryName = '.site.esbuild-entry.js'

async function main() {
  const command = process.argv[2] ?? 'bundle'

  switch (command) {
    case 'clean':
      await clean()
      return
    case 'lint':
      await lint()
      return
    case 'format':
      await format()
      return
    case 'build':
      await build()
      return
    case 'pack':
      await pack()
      return
    case 'bundle':
      await bundle()
      return
    default:
      throw new Error(`Unknown command "${command}". Expected one of: clean, lint, format, build, pack, bundle.`)
  }
}

async function clean() {
  console.log('Cleaning UI build output...')
  await fs.rm(path.join(uiRoot, 'public'), { recursive: true, force: true })
  await fs.rm(buildDir, { recursive: true, force: true })
}

async function lint() {
  console.log('Linting UI source files...')
  const biomeBin = require.resolve('@biomejs/biome/bin/biome')
  const includePatterns = ['scripts', 'src/helpers', 'src/js', 'src/css']
  await runNodeScript(biomeBin, [
    'check',
    '--formatter-enabled=false',
    '--assist-enabled=false',
    '--files-ignore-unknown=true',
    '--no-errors-on-unmatched',
    '--reporter=summary',
    ...includePatterns,
  ])
}

async function format() {
  console.log('Formatting UI source files...')
  const biomeBin = require.resolve('@biomejs/biome/bin/biome')
  const includePatterns = ['scripts', 'src/helpers', 'src/js', 'src/css']
  await runNodeScript(biomeBin, [
    'check',
    '--write',
    '--unsafe',
    '--assist-enabled=false',
    '--files-ignore-unknown=true',
    '--no-errors-on-unmatched',
    ...includePatterns,
  ])
}

async function build() {
  console.log('Building UI assets...')
  await ensureBuildToolsAvailable()
  await fs.rm(stageDir, { recursive: true, force: true })
  await fs.mkdir(stageDir, { recursive: true })

  const uiVersion = await resolveUiVersion()
  await copyStaticAssets(uiVersion)
  await buildCss()
  await buildJs()
}

async function bundle() {
  await clean()
  if (shouldSkipLint()) {
    console.log('Skipping lint (SKIP_LINT enabled).')
  } else {
    await lint()
  }
  await build()
  await pack()
}

async function pack() {
  console.log('Packing Antora UI bundle...')
  await fs.mkdir(buildDir, { recursive: true })
  const bundlePath = path.join(buildDir, 'ui-bundle.zip')
  await fs.rm(bundlePath, { force: true })
  await runCommand('zip', ['-q', '-r', bundlePath, '.'], { cwd: stageDir })
  if (!process.env.CI) {
    console.log(`Antora option: --ui-bundle-url=${bundlePath}`)
  }
}

async function copyStaticAssets(uiVersion) {
  await copyDirectory(path.join(srcDir, 'font'), path.join(stageDir, 'font'))
  await copyDirectory(path.join(srcDir, 'img'), path.join(stageDir, 'img'))
  await copyDirectory(path.join(srcDir, 'helpers'), path.join(stageDir, 'helpers'))
  await copyDirectory(path.join(srcDir, 'layouts'), path.join(stageDir, 'layouts'))

  const partialSrcDir = path.join(srcDir, 'partials')
  const partialDestDir = path.join(stageDir, 'partials')
  await fs.mkdir(partialDestDir, { recursive: true })
  const partialNames = await readSortedFiles(partialSrcDir, '.hbs')
  for (const fileName of partialNames) {
    const srcPath = path.join(partialSrcDir, fileName)
    const destPath = path.join(partialDestDir, fileName)
    const text = await fs.readFile(srcPath, 'utf8')
    const replaced = text.replaceAll('@@antora-ui-version', uiVersion)
    await fs.writeFile(destPath, replaced)
  }
}

async function buildCss() {
  const cssDir = path.join(srcDir, 'css')
  const vendorCssDir = path.join(cssDir, 'vendor')
  const vendorCssFiles = await readSortedFiles(vendorCssDir, '.css')
  const cssEntries = [path.join(cssDir, 'site.css'), ...vendorCssFiles.map((name) => path.join(vendorCssDir, name))]
  const tabsCssPath = require.resolve('@asciidoctor/tabs/dist/css/tabs.css')
  const tabsCssImportPath = normalizePathForCssImport(tabsCssPath)
  const tabsCssEntryPath = path.join(cssDir, tabsCssEntryName)

  try {
    await fs.writeFile(tabsCssEntryPath, `@import "${tabsCssImportPath}";\n`)

    for (const sourcePath of cssEntries) {
      const relPath = path.relative(cssDir, sourcePath).split(path.sep).join('/')
      const outputPath = path.join(stageDir, 'css', relPath)
      await fs.mkdir(path.dirname(outputPath), { recursive: true })

      const entryPath = relPath === 'vendor/asciidoctor-tabs.css' ? tabsCssEntryPath : sourcePath

      const args = [entryPath, '--bundle', '--minify', '--browserslist', '--output-file', outputPath]
      if (sourcemaps) {
        args.push('--sourcemap')
      }

      await runCommand('lightningcss', args, { cwd: cssDir })
    }
  } finally {
    await fs.rm(tabsCssEntryPath, { force: true })
  }
}

async function buildJs() {
  const jsDir = path.join(srcDir, 'js')
  const vendorDir = path.join(jsDir, 'vendor')
  const stageJsDir = path.join(stageDir, 'js')
  const stageVendorDir = path.join(stageJsDir, 'vendor')

  await fs.mkdir(stageVendorDir, { recursive: true })

  const siteEntryNames = (await readSortedFiles(jsDir, '.js')).filter((name) => /^\d+-.*\.js$/.test(name))
  const siteEntryPath = path.join(jsDir, siteJsEntryName)

  try {
    const siteEntrySource = `${siteEntryNames.map((name) => `import './${name}'`).join('\n')}\n`
    await fs.writeFile(siteEntryPath, siteEntrySource)

    const siteArgs = [
      siteEntryPath,
      '--bundle',
      '--minify',
      '--format=iife',
      '--target=es2018',
      '--legal-comments=inline',
      `--outfile=${path.join(stageJsDir, 'site.js')}`,
    ]
    if (sourcemaps) {
      siteArgs.push('--sourcemap=external')
    }
    await runCommand('esbuild', siteArgs, { cwd: jsDir })

    await fs.copyFile(path.join(jsDir, 'flask.js'), path.join(stageJsDir, 'flask.js'))

    const vendorNames = await readSortedFiles(vendorDir, '.js')
    for (const name of vendorNames) {
      const srcPath = path.join(vendorDir, name)

      if (name.endsWith('.bundle.js')) {
        const outName = name.replace(/\.bundle\.js$/, '.js')
        const args = [
          srcPath,
          '--bundle',
          '--minify',
          '--format=iife',
          '--target=es2018',
          '--legal-comments=inline',
          `--outfile=${path.join(stageVendorDir, outName)}`,
        ]
        if (sourcemaps) {
          args.push('--sourcemap=external')
        }
        await runCommand('esbuild', args, { cwd: vendorDir })
        continue
      }

      if (name.endsWith('.min.js')) {
        const outName = name.replace(/\.min\.js$/, '.js')
        await fs.copyFile(srcPath, path.join(stageVendorDir, outName))
        continue
      }

      const args = [
        srcPath,
        '--minify',
        '--target=es2018',
        '--legal-comments=inline',
        `--outfile=${path.join(stageVendorDir, name)}`,
      ]
      if (sourcemaps) {
        args.push('--sourcemap=external')
      }
      await runCommand('esbuild', args, { cwd: vendorDir })
    }
  } finally {
    await fs.rm(siteEntryPath, { force: true })
  }
}

async function ensureBuildToolsAvailable() {
  await assertCommandAvailable('lightningcss', ['--version'])
  await assertCommandAvailable('esbuild', ['--version'])
}

async function assertCommandAvailable(command, args) {
  try {
    await runCommandCapture(command, args, { cwd: uiRoot })
  } catch (_error) {
    throw new Error(`Required binary "${command}" is not on PATH. Run via \`nix develop --command ...\`.`)
  }
}

async function resolveUiVersion() {
  if (process.env.ANTORA_UI_VERSION) {
    return process.env.ANTORA_UI_VERSION
  }
  try {
    const raw = await runCommandCapture('git', ['describe', '--tags', '--dirty', '--always'], { cwd: uiRoot })
    const version = raw.trim()
    if (version) {
      return version
    }
  } catch (_error) {
    // fallback handled below
  }
  return 'unknown'
}

function normalizePathForCssImport(filePath) {
  return filePath.split(path.sep).join('/')
}

async function copyDirectory(from, to) {
  await fs.cp(from, to, { recursive: true })
}

async function readSortedFiles(dir, extension) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function runNodeScript(scriptPath, args) {
  return runCommand(process.execPath, [scriptPath, ...args], { cwd: uiRoot })
}

function shouldSkipLint() {
  const value = process.env.SKIP_LINT
  return value === '1' || value === 'true'
}

function runCommandCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(`Command failed (${command} ${args.join(' ')}): ${stderr || stdout}`))
    })
  })
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: 'inherit',
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Command failed with status ${code}: ${command} ${args.join(' ')}`))
    })
  })
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
