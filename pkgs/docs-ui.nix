{
  buildNpmPackage,
  zip,
}:
let
  version = "0.0.1-prototype";
in
buildNpmPackage {
  pname = "docs-ui";
  inherit version;
  src = ../ui;
  npmDepsHash = "sha256-M2Yt3O3qcLoQ1Q7uc8muEngOKIgALnLadx1R2PFkRcE=";
  dontNpmBuild = true;

  nativeBuildInputs = [ zip ];

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
