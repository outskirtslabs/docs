{
  lib,
  stdenv,
  fetchFromGitHub,
  rustPlatform,
  cacert,
  git,
  tree-sitter,
  cargo,
  nodejs ? null,
  nodejs_24 ? null,
}:
let
  rev = "v2.12.4";
  version = lib.removePrefix "v" rev;
  arboriumSrc = fetchFromGitHub {
    owner = "bearcove";
    repo = "arborium";
    inherit rev;
    hash = "sha256-xLOT+Y2w+r4ejEQclPk5/27CaCy8LAp7kdi0mPXRzRk=";
  };
  nodejsForArborium =
    if nodejs_24 != null then nodejs_24 else nodejs;

  arborium-xtask = rustPlatform.buildRustPackage {
    pname = "arborium-xtask";
    inherit version;
    src = arboriumSrc;
    sourceRoot = "source/xtask";
    cargoHash = "sha256-vgiI0wTqikd2KHW2njmJaB8nMQBs2LYXowHOsAC83xk=";
    doCheck = false;
    meta.mainProgram = "xtask";
  };

  arborium-lock = stdenv.mkDerivation {
    pname = "arborium-lock";
    inherit version;
    src = arboriumSrc;

    outputHash = "sha256-VpCcWPlp4KaXI9XmN8FwOiK+2E4CM8ZvBStajdJBRFA=";
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";

    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

    nativeBuildInputs = [
      arborium-xtask
      cacert
      cargo
      git
      tree-sitter
    ] ++ lib.optional (nodejsForArborium != null) nodejsForArborium;

    installPhase = ''
      runHook preInstall

      git init
      xtask gen
      pushd ./crates/arborium-cli
      cargo generate-lockfile
      popd

      mkdir -p $out
      cp -r ./* $out

      runHook postInstall
    '';

    dontFixup = true;
    impureEnvVars = lib.fetchers.proxyImpureEnvVars;
  };
in
rustPlatform.buildRustPackage {
  pname = "arborium";
  inherit version;
  src = arborium-lock;
  sourceRoot = "${arborium-lock.name}/crates/arborium-cli";
  cargoHash = "sha256-SdlxIfXv0r1wPAOXUKaWaH/Lf9sm81pfmxol9jjI9Uo=";
  doCheck = false;
}
