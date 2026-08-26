{
  pkgs,
  site,
  runtimePath,
  socketPath,
  serviceName ? "docs-site-main",
}:

let
  siteConfig = pkgs.writeText "${serviceName}-site.conf" (
    builtins.replaceStrings
      [ "@SITE_DIR@" "@REWRITE_CONF@" ]
      [ (toString site) "${site}/.etc/nginx/rewrite.conf" ]
      (builtins.readFile ../config/nginx-site.conf.in)
  );
  httpConfig = pkgs.writeText "${serviceName}-http.conf" (
    builtins.replaceStrings
      [ "@TEMP_DIR@" ]
      [ runtimePath ]
      (builtins.readFile ../config/nginx-http.conf.in)
  );
  nginxConfig = pkgs.writeText "${serviceName}-nginx.conf" ''
    worker_processes 1;
    daemon off;
    pid ${runtimePath}/nginx.pid;
    error_log stderr warn;

    events {
      worker_connections 1024;
    }

    http {
      include ${httpConfig};

      server {
        listen unix:${socketPath};
        server_name _;
        include ${siteConfig};
      }
    }
  '';
  socketReady = pkgs.writeShellScript "${serviceName}-socket-ready" ''
    set -euo pipefail

    for _ in $(${pkgs.coreutils}/bin/seq 1 50); do
      if test -S ${socketPath}; then
        ${pkgs.coreutils}/bin/chgrp --reference=${builtins.dirOf socketPath} ${socketPath}
        ${pkgs.coreutils}/bin/chmod 0660 ${socketPath}
        exit
      fi
      ${pkgs.coreutils}/bin/sleep 0.1
    done

    echo "timed out waiting for nginx socket ${socketPath}" >&2
    exit 1
  '';
  serviceUnit = pkgs.writeText "${serviceName}.service" ''
    [Unit]
    Description=Outskirts Labs docs nginx backend
    After=network.target

    [Service]
    Type=simple
    UMask=0007
    ExecStartPre=${pkgs.coreutils}/bin/mkdir -p ${runtimePath}/client_body ${runtimePath}/proxy ${runtimePath}/fastcgi ${runtimePath}/uwsgi ${runtimePath}/scgi
    ExecStartPre=${pkgs.coreutils}/bin/rm -f ${socketPath} ${runtimePath}/nginx.pid
    ExecStartPre=${pkgs.nginx}/bin/nginx -e stderr -t -c ${nginxConfig}
    ExecStart=${pkgs.nginx}/bin/nginx -e stderr -c ${nginxConfig}
    ExecStartPost=${socketReady}
    ExecStopPost=${pkgs.coreutils}/bin/rm -f ${socketPath} ${runtimePath}/nginx.pid
    Restart=on-failure
    RestartSec=2s
    TimeoutStartSec=30s
    TimeoutStopSec=30s

    [Install]
    WantedBy=default.target
  '';
in
{
  inherit
    httpConfig
    nginxConfig
    runtimePath
    serviceName
    serviceUnit
    socketReady
    site
    siteConfig
    socketPath
    ;
}
