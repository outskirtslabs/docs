{
  lib,
  buildNpmPackage,
  fetchgit,
  babashka,
  gitMinimal,
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
        ${gitMinimal}/bin/git remote add origin ${url}
        ${gitMinimal}/bin/git fetch origin '+refs/heads/*:refs/heads/*'
        # Normalize volatile .git metadata so fixed-output hashes stay deterministic.
        rm -f .git/FETCH_HEAD
        ${gitMinimal}/bin/git reflog expire --expire=all --all || true
        ${gitMinimal}/bin/git repack -a -d -f --depth=50 --window=250
        ${gitMinimal}/bin/git prune-packed
        find .git/objects -type f -name '*.keep' -delete
        find .git/objects -type f -name '*.bitmap' -delete
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
    urls = {
      html_extension_style = "drop";
      redirect_facility = "nginx";
      latest_version_segment = "latest";
      latest_version_segment_strategy = "redirect:from";
    };
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
      { require = "./extensions/lunr-tokenizer"; }
      { require = "./extensions/alias-component-to-latest-version"; }
      {
        require = "./extensions/antora-llm-generator";
        skippaths = [
          "**/api"
          "**/api/index"
          "**/api.html"
          "**/api/index.html"
        ];
      }
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
  npmDepsHash = "sha256-MeDCT3+M5vu+oZaaJBSjD8kRVW7FLfaNohlf+6suubw=";
  dontNpmBuild = true;

  nativeBuildInputs = [
    babashka
    gitMinimal
    curl
    arborium
  ];

  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    ${gitMinimal}/bin/git config --global user.email "nix-builder@example.invalid"
    ${gitMinimal}/bin/git config --global user.name "nix builder"
    ${gitMinimal}/bin/git config --global --add safe.directory "*"

    # Antora local sources must be git repositories.
    ${gitMinimal}/bin/git init -q
    ${gitMinimal}/bin/git add components/home
    ${gitMinimal}/bin/git commit -q -m "home component"

    cat > playbook.generated.yml <<'JSON'
${playbookJson}
JSON
    cp playbook.generated.yml playbook.yml

    # Avoid loading repo bb.edn in the sandbox; it may include networked Maven deps.
    bb --config /dev/null scripts/gen_home.clj
    npx antora --stacktrace --to-dir build/site playbook.generated.yml
    mkdir -p build/site/.etc/nginx
    if [ ! -f build/site/.etc/nginx/rewrite.conf ]; then
      cat > build/site/.etc/nginx/rewrite.conf <<'EOF'
# No Antora redirects generated for this build.
EOF
    fi
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
