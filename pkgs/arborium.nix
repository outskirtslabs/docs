{
  lib,
  stdenv,
  fetchgit,
  rustPlatform,
  cacert,
  git,
  tree-sitter,
  cargo,
  clang,
  nodejs ? null,
  nodejs_24 ? null,
}:
let
  rev = "v2.18.0";
  version = lib.removePrefix "v" rev;
  # fetchFromGitHub uses git-archive which respects export-ignore attributes;
  # the gitattributes language sample (.gitattributes) excludes itself that way.
  # fetchgit does a real clone so all tracked files are present.
  arboriumSrc = fetchgit {
    url = "https://github.com/bearcove/arborium";
    inherit rev;
    hash = "sha256-/h+FIMHf0q6B+/bo4GWXeoGjLzHFpR4C4TH4SB0lT2M=";
  };
  nodejsForArborium =
    if nodejs_24 != null then nodejs_24 else nodejs;

  arborium-xtask = rustPlatform.buildRustPackage {
    pname = "arborium-xtask";
    inherit version;
    src = arboriumSrc;
    sourceRoot = "arborium/xtask";
    cargoHash = "sha256-vgiI0wTqikd2KHW2njmJaB8nMQBs2LYXowHOsAC83xk=";
    doCheck = false;
    meta.mainProgram = "xtask";
  };

  arborium-lock = stdenv.mkDerivation {
    pname = "arborium-lock";
    inherit version;
    src = arboriumSrc;

    outputHash = "sha256-cMT6TMuIAyNAH11DDLbCTT6K0+MzirCQyaph3ZSsU/A=";
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
  cargoHash = "sha256-igdr/DhTFAs961kNwBWznOXY8GuN1TJlDdN5QHHKMqY=";
  doCheck = false;
  # Upstream uses clang; the tree-sitter grammar scanners have const
  # violations that clang suppresses with -w but GCC 15 rejects as errors.
  nativeBuildInputs = [ clang ];
  CC = "clang";
}
