{
  buildNpmPackage,
  git,
}:
let
  version = "0.0.1-prototype";
in
buildNpmPackage {
  pname = "docs-ui";
  inherit version;
  src = ../ui;
  npmDepsHash = "sha256-wH8nGvg4SWV0uXxtkgz7I2vPygdylraJxEx2tJtvj3M=";
  npmRebuildFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;

  nativeBuildInputs = [ git ];

  buildPhase = ''
    runHook preBuild

    # git-rev-sync requires a repository to exist during gulp bundle.
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    git config --global user.email "nix-builder@example.invalid"
    git config --global user.name "nix builder"
    git init -q
    git add .
    git commit -q -m "ui bundle build"

    # Avoid imagemin's binary toolchain in the Nix build sandbox.
    sed -i "/const imagemin = require/d" gulp.d/tasks/build.js
    sed -i "/vfs.src('img\\/\\*\\*\\/\\*\\.{gif,ico,jpg,png,svg}', opts).pipe(/,/^    ),$/c\\    vfs.src('img/**/*.{gif,ico,jpg,png,svg}', opts)," gulp.d/tasks/build.js

    npx gulp bundle

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp build/ui-bundle.zip "$out/ui-bundle.zip"
    runHook postInstall
  '';
}
