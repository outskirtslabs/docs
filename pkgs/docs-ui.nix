{
  buildNpmPackage,
  esbuild,
  lightningcss,
  zip,
}:
let
  version = "0.0.1-prototype";
in
buildNpmPackage {
  pname = "docs-ui";
  inherit version;
  src = ../ui;
  npmDepsHash = "sha256-kwGrFIKjEdsk5HhasB5jOfE3fqL5s4w+03xlRlIf9xg=";
  dontNpmBuild = true;

  nativeBuildInputs = [
    esbuild
    lightningcss
    zip
  ];

  buildPhase = ''
    runHook preBuild

    export ANTORA_UI_VERSION="${version}"
    export SKIP_LINT=1

    node scripts/build-ui.mjs bundle

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp build/ui-bundle.zip "$out/ui-bundle.zip"
    runHook postInstall
  '';
}
