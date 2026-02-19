'use strict'

const autoprefixer = require('autoprefixer')
const browserify = require('browserify')
const concat = require('gulp-concat')
const cssnano = require('cssnano')
const fs = require('fs')
const { promises: fsp } = fs
const merge = require('merge-stream')
const ospath = require('path')
const path = ospath.posix
const sharp = require('sharp')
const postcss = require('gulp-postcss')
const postcssImport = require('postcss-import')
const postcssUrl = require('postcss-url')
const postcssVar = require('postcss-custom-properties')
const { optimize: optimizeSvg } = require('svgo')
const { Transform } = require('stream')
const map = (transform) => new Transform({ objectMode: true, transform })
const replace = require('gulp-replace')
const uglify = require('gulp-uglify')
const vfs = require('vinyl-fs')
const git = require('git-rev-sync')

module.exports = (src, dest) => () => {
  const opts = { base: src, cwd: src }
  const sourcemaps = process.env.SOURCEMAPS === 'true'
  const postcssPlugins = [
    postcssImport,
    (_css, { messages, opts: { file } }) =>
      Promise.all(
        messages
          .reduce((accum, { file: depPath, type }) => (type === 'dependency' ? accum.concat(depPath) : accum), [])
          .map((importedPath) => fsp.stat(importedPath).then(({ mtime }) => mtime))
      ).then((mtimes) => {
        const newestMtime = mtimes.reduce((max, curr) => (!max || curr > max ? curr : max), file.stat.mtime)
        if (newestMtime > file.stat.mtime) file.stat.mtimeMs = +(file.stat.mtime = newestMtime)
      }),
    postcssUrl([
      {
        filter: new RegExp('^src/css/[~][^/]*(?:font|face)[^/]*/.*/files/.+[.](?:ttf|woff2?)$'),
        url: (asset) => {
          const relpath = asset.pathname.substr(1)
          const abspath = require.resolve(relpath)
          const basename = ospath.basename(abspath)
          const destpath = ospath.join(dest, 'font', basename)
          if (!fs.existsSync(destpath)) fs.cpSync(abspath, destpath, { recursive: true })
          return path.join('..', 'font', basename)
        },
      },
    ]),
    // NOTE importFrom is for supplemental CSS files
    postcssVar({ disableDeprecationNotice: true, importFrom: path.join(src, 'css', 'vars.css'), preserve: true }),
    autoprefixer,
    (css, result) =>
      cssnano()
        .process(css, result.opts)
        .then(() => postcssPseudoElementFixer(css, result)),
  ]

  return merge(
    vfs
      .src('js/+([0-9])-*.js', { ...opts, read: false, sourcemaps })
      .pipe(bundle(opts))
      .pipe(uglify({ output: { comments: /^! / } }))
      // NOTE concat already uses stat from newest combined file
      .pipe(concat('js/site.js')),
    // Keep standalone ES modules (such as flask animation) as-is.
    vfs.src('js/flask.js', opts),
    vfs
      .src('js/vendor/*([^.])?(.bundle).js', { ...opts, read: false })
      .pipe(bundle(opts))
      .pipe(uglify({ output: { comments: /^! / } })),
    vfs
      .src('js/vendor/*.min.js', opts)
      .pipe(map((file, _enc, next) => next(null, Object.assign(file, { extname: '' }, { extname: '.js' })))),
    // NOTE use the next line to bundle a JavaScript library that cannot be browserified, like jQuery
    //vfs.src(require.resolve('<package-name-or-require-path>'), opts).pipe(concat('js/vendor/<library-name>.js')),
    vfs
      .src(['css/site.css', 'css/vendor/*.css'], { ...opts, sourcemaps })
      .pipe(postcss((file) => ({ plugins: postcssPlugins, options: { file } }))),
    vfs.src('font/*.{ttf,woff*(2)}', opts),
    vfs.src('img/**/*.{gif,ico,jpg,png,svg}', opts).pipe(optimizeImages()),
    vfs.src('helpers/*.js', opts),
    vfs.src('layouts/*.hbs', opts),
    vfs.src('partials/*.hbs', opts).pipe(replace('@@antora-ui-version', git.isTagDirty() ? git.long() : git.tag()))
  ).pipe(vfs.dest(dest, { sourcemaps: sourcemaps && '.' }))
}

function bundle({ base: basedir, ext: bundleExt = '.bundle.js' }) {
  return map((file, _enc, next) => {
    if (bundleExt && file.relative.endsWith(bundleExt)) {
      const mtimePromises = []
      const bundlePath = file.path
      browserify(file.relative, { basedir, detectGlobals: false })
        .plugin('browser-pack-flat/plugin')
        .on('file', (bundledPath) => {
          if (bundledPath !== bundlePath) mtimePromises.push(fsp.stat(bundledPath).then(({ mtime }) => mtime))
        })
        .bundle((bundleError, bundleBuffer) =>
          Promise.all(mtimePromises).then((mtimes) => {
            const newestMtime = mtimes.reduce((max, curr) => (curr > max ? curr : max), file.stat.mtime)
            if (newestMtime > file.stat.mtime) file.stat.mtimeMs = +(file.stat.mtime = newestMtime)
            if (bundleBuffer !== undefined) file.contents = bundleBuffer
            next(bundleError, Object.assign(file, { path: file.path.slice(0, file.path.length - 10) + '.js' }))
          })
        )
      return
    }
    fsp.readFile(file.path, 'UTF-8').then((contents) => {
      next(null, Object.assign(file, { contents: Buffer.from(contents) }))
    })
  })
}

function postcssPseudoElementFixer(css, _result) {
  css.walkRules(/(?:^|[^:]):(?:before|after)/, (rule) => {
    rule.selector = rule.selectors.map((it) => it.replace(/(^|[^:]):(before|after)$/, '$1::$2')).join(',')
  })
}

function optimizeImages() {
  return map((file, _enc, next) => {
    if (!file.contents || file.isNull()) {
      next(null, file)
      return
    }

    const ext = ospath.extname(file.path).toLowerCase()

    const finish = (err, contents) => {
      if (err) {
        next(err)
        return
      }
      file.contents = contents
      next(null, file)
    }

    if (ext === '.png') {
      sharp(file.contents, { failOn: 'none' })
        .png({
          adaptiveFiltering: true,
          compressionLevel: 9,
          effort: 10,
        })
        .toBuffer()
        .then((buffer) => finish(null, buffer))
        .catch((err) => finish(err))
      return
    }

    if (ext === '.svg') {
      try {
        const optimized = optimizeSvg(file.contents.toString('utf8'), {
          multipass: true,
          plugins: [
            { name: 'cleanupIds', params: { preservePrefixes: ['icon-', 'view-'] } },
            { name: 'removeViewBox', active: false },
            { name: 'removeDesc', active: false },
          ],
        })

        if (optimized.error) {
          finish(new Error(optimized.error))
          return
        }

        finish(null, Buffer.from(optimized.data))
      } catch (err) {
        finish(err)
      }
      return
    }

    // GIF/ICO/JPG pass through unchanged.
    finish(null, file.contents)
  })
}
