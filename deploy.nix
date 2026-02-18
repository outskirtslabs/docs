{
  self,
  inputs,
  system,
}:

let
  inherit (inputs) nixpkgs deploy-rs;

  deployHost = "james";
  deployUser = "docs.outskirtslabs.com";
  deployRoot = "/var/lib/static-web/outskirtslabs.com/docs";
  deployLink = "current";

  nixosModule =
    {
      config,
      lib,
      ...
    }:
    let
      inherit (lib)
        mkEnableOption
        mkIf
        mkOption
        types
        hasPrefix
        ;
      cfg = config.services.docs-site-deploy;
    in
    {
      options.services.docs-site-deploy = {
        enable = mkEnableOption "docs-site static deployment target";
        package = mkOption {
          type = types.package;
          default = self.packages.${system}.docs-site;
          description = "Static site package deployed to james.";
        };
        rootPath = mkOption {
          type = types.str;
          default = deployRoot;
          description = "Directory containing the active symlink.";
        };
        linkName = mkOption {
          type = types.str;
          default = deployLink;
          description = "Name of the active symlink inside rootPath.";
        };
      };

      config = mkIf cfg.enable {
        assertions = [
          {
            assertion = hasPrefix "/" cfg.rootPath;
            message = "services.docs-site-deploy.rootPath must be absolute.";
          }
        ];
      };
    };

  mkDeploymentProfile =
    pkgs:
    {
      branch ? "main",
    }:
    let
      nixosSystem = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          nixosModule
          {
            services.docs-site-deploy = {
              enable = true;
              package = self.packages.${system}.docs-site;
            };
          }
        ];
      };
      cfg = nixosSystem.config.services.docs-site-deploy;

      activate = pkgs.writeShellScriptBin "activate" ''
        set -euo pipefail

        root_path='${cfg.rootPath}'
        link_name='${cfg.linkName}'
        target='${cfg.package}'

        if [ ! -d "$target" ]; then
          echo "deployment target $target is missing"
          exit 1
        fi

        mkdir -p "$root_path"
        ln -sfn "$target" "$root_path/.next"
        mv -Tf "$root_path/.next" "$root_path/$link_name"
      '';

      deactivate = pkgs.writeShellScriptBin "deactivate" ''
        set -euo pipefail
        echo "deactivate: leaving ${cfg.rootPath}/${cfg.linkName} unchanged"
      '';
    in
    pkgs.buildEnv {
      name = "docs-site-${branch}-deploy-profile";
      paths = [
        activate
        deactivate
      ];
    };
in
{
  inherit nixosModule;

  outputs =
    { pkgsFor, ... }:
    let
      pkgs = pkgsFor.${system};
      mkNode =
        {
          hostname ? deployHost,
          script ? "activate",
          branch,
        }:
        {
          inherit hostname;
          sshUser = deployUser;
          user = deployUser;
          sshOpts = [
            "-o"
            "StrictHostKeyChecking=no"
          ];
          profiles = {
            "docs-site-${branch}".path = deploy-rs.lib.${system}.activate.custom (mkDeploymentProfile pkgs {
              inherit branch;
            }) "$PROFILE/bin/${script}";
          };
        };
    in
    {
      deploy.nodes.main = mkNode { branch = "main"; };
    };

  checks = pkgs: deploy-rs.lib.${pkgs.stdenv.hostPlatform.system}.deployChecks self.deploy;

  devShellCommands = [
    { package = deploy-rs.packages.${system}.deploy-rs; }
  ];
}
