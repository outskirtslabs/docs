{
  description = "dev env";
  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1"; # tracks nixpkgs unstable branch
    devshell.url = "github:numtide/devshell";
    devenv.url = "https://flakehub.com/f/ramblurr/nix-devenv/*";
    deploy-rs.url = "github:serokell/deploy-rs";
    deploy-rs.inputs.nixpkgs.follows = "nixpkgs";
  };
  outputs =
    inputs@{
      self,
      devenv,
      devshell,
      deploy-rs,
      ...
    }:
    let
      system = "x86_64-linux";
      deploy = import ./deploy.nix {
        inherit self inputs system;
      };
    in
    devenv.lib.mkFlake ./. {
      inherit inputs;
      systems = [ system ];
      withOverlays = [
        devshell.overlays.default
        devenv.overlays.default
      ];
      packages = {
        arborium = pkgs: pkgs.callPackage (import ./pkgs/arborium.nix) { };
        docs-ui = pkgs: pkgs.callPackage (import ./pkgs/docs-ui.nix) { };
        docs-site =
          pkgs:
          pkgs.callPackage (import ./pkgs/docs-site.nix) {
            docsUi = pkgs.callPackage (import ./pkgs/docs-ui.nix) { };
            versionDate = if self ? lastModifiedDate then self.lastModifiedDate else "19700101000000";
          };
      };
      nixosModules.default = deploy.nixosModule;
      outputs = deploy.outputs;
      checks = deploy.checks;
      devShell =
        pkgs:
        pkgs.devshell.mkShell {
          imports = [
            devenv.capsules.base
          ];
          # https://numtide.github.io/devshell
          commands = [
            { package = pkgs.antora; }
            { package = pkgs.arborium; }
            { package = pkgs.babashka; }
          ];
          env = [
            {
              name = "SHARP_IGNORE_GLOBAL_LIBVIPS";
              value = "1";
            }
          ];
          packages = [
            deploy-rs.packages.${system}.deploy-rs
            pkgs.asciidoctor
            pkgs.nodejs_24
            pkgs.playwright
            pkgs.playwright-test
            pkgs.playwright-mcp
          ];
        };
    };
}
