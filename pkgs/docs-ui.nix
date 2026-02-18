{
  buildNpmPackage,
  gitMinimal,
}:
let
  version = "0.0.1-prototype";
in
buildNpmPackage {
  pname = "docs-ui";
  inherit version;
  src = ../ui;
  npmDepsHash = "sha256-Q8v31QVJqU00TnnKvyudX3z/D8JofCkAphkpggxQDZo=";
  dontNpmBuild = true;

  nativeBuildInputs = [ gitMinimal ];

  SHARP_IGNORE_GLOBAL_LIBVIPS = "1";

  buildPhase = ''
    runHook preBuild

    # git-rev-sync requires a repository to exist during gulp bundle.
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    ${gitMinimal}/bin/git config --global user.email "nix-builder@example.invalid"
    ${gitMinimal}/bin/git config --global user.name "nix builder"
    ${gitMinimal}/bin/git init -q
    ${gitMinimal}/bin/git add .
    ${gitMinimal}/bin/git commit -q -m "ui bundle build"

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
