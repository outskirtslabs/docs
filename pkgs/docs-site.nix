{
  lib,
  buildNpmPackage,
  fetchgit,
  babashka,
  git,
  yq-go,
  curl,
  arborium,
  docsUi,
  versionDate ? "19700101000000",
}:
let
  dateStamp =
    if builtins.stringLength versionDate >= 8 then
      builtins.substring 0 8 versionDate
    else
      "19700101";
  version =
    "${builtins.substring 0 4 dateStamp}-${builtins.substring 4 2 dateStamp}-${builtins.substring 6 2 dateStamp}";
  projects = import ./projects.nix;

  fetchedProjects = lib.mapAttrs (
    _projectName:
    { url, rev, hash, ... }:
    fetchgit {
      inherit url rev hash;
      leaveDotGit = true;
      deepClone = true;
      fetchTags = true;
      postFetch = ''
        cd "$out"
        git remote add origin ${url}
        git fetch origin '+refs/heads/*:refs/heads/*'
      '';
    }
  ) projects;

  projectSources = lib.mapAttrsToList (
    projectName:
    project:
    {
      url = fetchedProjects.${projectName};
      branches = project.branches or [
        "HEAD"
        "v{0..9}*"
      ];
      start_path = project.start_path or "doc";
    }
  ) projects;

  playbookJson = builtins.toJSON {
    site = {
      title = "Outskirts Labs Docs";
      url = "https://docs.outskirtslabs.com";
      start_page = "ROOT::index.adoc";
    };
    urls.html_extension_style = "drop";
    content.sources = [
      {
        url = ".";
        branches = "HEAD";
        start_path = "components/home";
      }
    ] ++ projectSources;
    ui.bundle.url = "${docsUi}/ui-bundle.zip";
    asciidoc = {
      attributes = {
        idprefix = "";
        source-highlighter = "none";
      };
      extensions = [ "@asciidoctor/tabs" ];
    };
    antora.extensions = [
      { require = "./lunr-tokenizer"; }
      {
        require = "@antora/lunr-extension";
        index_latest_only = false;
      }
    ];
  };
in
assert docsUi != null;
buildNpmPackage {
  pname = "docs-site";
  inherit version;
  src = ../.;
  npmDepsHash = "sha256-75I9iVRLVKvAT3PxUBBmRD72ZPF0DWSQFK8D3ZlhmyM=";
  dontNpmBuild = true;

  nativeBuildInputs = [
    babashka
    git
    yq-go
    curl
    arborium
  ];

  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    git config --global user.email "nix-builder@example.invalid"
    git config --global user.name "nix builder"
    git config --global --add safe.directory "*"

    # Antora local sources must be git repositories.
    git init -q
    git add components/home
    git commit -q -m "home component"

    cat > playbook.generated.yml <<'JSON'
${playbookJson}
JSON
    cp playbook.generated.yml playbook.yml

    bb scripts/gen_home.clj
    npx antora --stacktrace --to-dir build/site playbook.generated.yml
    chmod -R u+w build/site
    node scripts/highlight-arborium.mjs --site-dir build/site

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r build/site/. "$out/"
    runHook postInstall
  '';
}
