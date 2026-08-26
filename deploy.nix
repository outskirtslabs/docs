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
  deploySocket = "${deployRoot}/.run/docs-site.sock";
  deployConfirmTimeout = 30;
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
        enable = mkEnableOption "docs-site nginx deployment backend";
        package = mkOption {
          type = types.package;
          default = self.packages.${system}.docs-site;
          description = "Generated docs site served by the deployment backend.";
        };
        rootPath = mkOption {
          type = types.str;
          default = deployRoot;
          description = "Directory containing the active symlink.";
        };
        socketPath = mkOption {
          type = types.str;
          default = deploySocket;
          description = "Unix socket exposed by the docs nginx backend.";
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
          {
            assertion = hasPrefix "/" cfg.socketPath;
            message = "services.docs-site-deploy.socketPath must be absolute.";
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

      deployment = import ./pkgs/docs-deployment.nix {
        inherit pkgs branch;
        site = cfg.package;
        confirmTimeoutSeconds = deployConfirmTimeout;
        inherit (cfg) linkName rootPath socketPath;
      };
    in
    deployment.profile;
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
          confirmTimeout = deployConfirmTimeout;
          # remote build only in github actions, not locally
          #remoteBuild = true;
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
}
