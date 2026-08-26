{
  pkgs,
  site,
  branch,
  confirmTimeoutSeconds ? 30,
  rollbackGuardGraceSeconds ? 5,
  healthAttempts ? 50,
  healthPollSeconds ? 0.2,
  linkName ? "current",
  rootPath,
  socketPath,
  curlCommand ? "${pkgs.curl}/bin/curl",
  nginxCommand ? "${pkgs.nginx}/bin/nginx",
  systemctlCommand ? "${pkgs.systemd}/bin/systemctl",
}:

let
  runtimePath = "${rootPath}/.run/nginx-${branch}";
  serviceName = "docs-site-${branch}";
  backend = import ./docs-backend.nix {
    inherit
      pkgs
      runtimePath
      serviceName
      site
      socketPath
      ;
  };
  unitName = "${serviceName}.service";
  rollback = pkgs.writeShellScript "${serviceName}-rollback" ''
    set -euo pipefail

    root_path=${pkgs.lib.escapeShellArg rootPath}
    link_name=${pkgs.lib.escapeShellArg linkName}
    active_root="$root_path/$link_name"
    service_name=${pkgs.lib.escapeShellArg serviceName}
    unit_dir="$HOME/.config/systemd/user"
    unit_path="$unit_dir/${unitName}"
    wants_path="$unit_dir/default.target.wants/${unitName}"
    previous_root="$root_path/.previous-current"
    previous_unit="$root_path/.previous-${unitName}"
    had_root="$root_path/.previous-current.exists"
    had_unit="$root_path/.previous-${unitName}.exists"

    if [ -e "$had_root" ] && [ -L "$previous_root" ]; then
      ${pkgs.coreutils}/bin/ln -sfn "$(${pkgs.coreutils}/bin/readlink "$previous_root")" "$root_path/.rollback-current"
      ${pkgs.coreutils}/bin/mv -Tf "$root_path/.rollback-current" "$active_root"
    else
      ${pkgs.coreutils}/bin/rm -f "$active_root"
    fi

    if [ -e "$had_unit" ] && [ -L "$previous_unit" ]; then
      ${pkgs.coreutils}/bin/ln -sfn "$(${pkgs.coreutils}/bin/readlink "$previous_unit")" "$unit_path.rollback"
      ${pkgs.coreutils}/bin/mv -Tf "$unit_path.rollback" "$unit_path"
      ${pkgs.coreutils}/bin/ln -sfn "$unit_path" "$wants_path"
    else
      ${pkgs.coreutils}/bin/rm -f "$unit_path" "$wants_path"
    fi

    ${systemctlCommand} --user daemon-reload
    if [ -L "$unit_path" ]; then
      ${systemctlCommand} --user restart "$service_name"
    else
      ${systemctlCommand} --user stop "$service_name" 2>/dev/null || true
      ${systemctlCommand} --user reset-failed "$service_name" 2>/dev/null || true
    fi
  '';
  rollbackGuard = pkgs.writeShellScript "${serviceName}-rollback-guard" ''
    set -euo pipefail

    profile_path="$1"
    candidate_profile="$2"
    previous_profile="$3"
    attempts=$(((${toString confirmTimeoutSeconds} + ${toString rollbackGuardGraceSeconds}) * 5))

    for _ in $(${pkgs.coreutils}/bin/seq 1 "$attempts"); do
      current_profile="$(${pkgs.coreutils}/bin/readlink -f "$profile_path" 2>/dev/null || true)"
      if [ "$current_profile" = "$previous_profile" ]; then
        ${rollback}
        exit
      fi
      if [ "$current_profile" != "$candidate_profile" ]; then
        exit
      fi
      ${pkgs.coreutils}/bin/sleep 0.2
    done
  '';
  activate = pkgs.writeShellScriptBin "activate" ''
    set -euo pipefail

    export XDG_RUNTIME_DIR="/run/user/$UID"
    root_path=${pkgs.lib.escapeShellArg rootPath}
    link_name=${pkgs.lib.escapeShellArg linkName}
    active_root="$root_path/$link_name"
    service_name=${pkgs.lib.escapeShellArg serviceName}
    unit_dir="$HOME/.config/systemd/user"
    unit_path="$unit_dir/${unitName}"
    wants_dir="$unit_dir/default.target.wants"
    wants_path="$wants_dir/${unitName}"
    previous_root="$root_path/.previous-current"
    previous_unit="$root_path/.previous-${unitName}"
    had_root="$root_path/.previous-current.exists"
    had_unit="$root_path/.previous-${unitName}.exists"

    ${pkgs.coreutils}/bin/mkdir -p "$root_path/.run" ${pkgs.lib.escapeShellArg runtimePath} "$wants_dir"
    ${pkgs.coreutils}/bin/test -f ${site}/index.html
    ${pkgs.coreutils}/bin/test -f ${site}/.etc/nginx/rewrite.conf
    ${pkgs.coreutils}/bin/mkdir -p \
      ${pkgs.lib.escapeShellArg runtimePath}/client_body \
      ${pkgs.lib.escapeShellArg runtimePath}/proxy \
      ${pkgs.lib.escapeShellArg runtimePath}/fastcgi \
      ${pkgs.lib.escapeShellArg runtimePath}/uwsgi \
      ${pkgs.lib.escapeShellArg runtimePath}/scgi
    ${nginxCommand} -e stderr -t -c ${backend.nginxConfig}

    ${pkgs.coreutils}/bin/rm -f "$previous_root" "$previous_unit" "$had_root" "$had_unit"
    if [ -L "$active_root" ]; then
      ${pkgs.coreutils}/bin/ln -s "$(${pkgs.coreutils}/bin/readlink "$active_root")" "$previous_root"
      ${pkgs.coreutils}/bin/touch "$had_root"
    fi
    if [ -L "$unit_path" ]; then
      ${pkgs.coreutils}/bin/ln -s "$(${pkgs.coreutils}/bin/readlink "$unit_path")" "$previous_unit"
      ${pkgs.coreutils}/bin/touch "$had_unit"
    fi

    rollback_on_error() {
      ${rollback} || true
    }
    trap rollback_on_error ERR

    ${pkgs.coreutils}/bin/ln -sfn ${site} "$root_path/.next"
    ${pkgs.coreutils}/bin/mv -Tf "$root_path/.next" "$active_root"
    ${pkgs.coreutils}/bin/ln -sfn ${backend.serviceUnit} "$unit_path.next"
    ${pkgs.coreutils}/bin/mv -Tf "$unit_path.next" "$unit_path"
    ${pkgs.coreutils}/bin/ln -sfn "$unit_path" "$wants_path"

    ${systemctlCommand} --user daemon-reload
    ${systemctlCommand} --user restart "$service_name"

    healthy=
    for _ in $(${pkgs.coreutils}/bin/seq 1 ${toString healthAttempts}); do
      if ${systemctlCommand} --user is-active --quiet "$service_name" \
        && ${curlCommand} --fail --silent --show-error \
          --unix-socket ${pkgs.lib.escapeShellArg socketPath} http://localhost/ >/dev/null; then
        healthy=1
        break
      fi
      ${pkgs.coreutils}/bin/sleep ${toString healthPollSeconds}
    done
    ${pkgs.coreutils}/bin/test "$healthy" = 1

    trap - ERR
    if [ -n "''${PROFILE:-}" ] && [ -L "$PROFILE" ] && [ ! -e "$had_unit" ]; then
      candidate_profile="$(${pkgs.coreutils}/bin/readlink -f "$PROFILE")"
      previous_profile=
      while IFS= read -r generation; do
        [ -L "$generation" ] || continue
        generation_target="$(${pkgs.coreutils}/bin/readlink -f "$generation")"
        if [ "$generation_target" != "$candidate_profile" ]; then
          previous_profile="$generation_target"
        fi
      done < <(printf '%s\n' "$PROFILE"-*-link | ${pkgs.coreutils}/bin/sort -V)

      if [ -n "$previous_profile" ]; then
        ${pkgs.coreutils}/bin/nohup ${rollbackGuard} \
          "$PROFILE" "$candidate_profile" "$previous_profile" \
          >"$root_path/.run/${serviceName}-rollback-guard.log" 2>&1 &
      fi
    fi
  '';
  deactivate = pkgs.writeShellScriptBin "deactivate" ''
    set -euo pipefail
    export XDG_RUNTIME_DIR="/run/user/$UID"
    ${rollback}
  '';
  profile = pkgs.buildEnv {
    name = "${serviceName}-deploy-profile";
    paths = [
      activate
      deactivate
    ];
  };
in
{
  inherit backend profile;
}
