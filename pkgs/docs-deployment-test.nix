{
  pkgs,
  site,
}:

let
  rootPath = "/tmp/docs-deployment-test";
  socketPath = "${rootPath}/.run/nginx.sock";
  commandLog = "${rootPath}/commands.log";
  fakeSystemctl = pkgs.writeShellScript "systemctl" ''
    echo "systemctl $*" >> ${commandLog}
    if [ -e ${rootPath}/fail-next-restart ] && [[ "$*" == *" restart "* ]]; then
      rm ${rootPath}/fail-next-restart
      exit 1
    fi
  '';
  fakeNginx = pkgs.writeShellScript "nginx" ''
    echo "nginx $*" >> ${commandLog}
  '';
  fakeCurl = pkgs.writeShellScript "curl" ''
    echo "curl $*" >> ${commandLog}
    if [ -f ${rootPath}/health-failures ]; then
      remaining="$(${pkgs.coreutils}/bin/cat ${rootPath}/health-failures)"
      if [ "$remaining" -gt 0 ]; then
        printf '%s\n' "$((remaining - 1))" > ${rootPath}/health-failures
        exit 1
      fi
    fi
  '';
  deployment = import ./docs-deployment.nix {
    inherit
      pkgs
      site
      rootPath
      socketPath
      ;
    branch = "test";
    confirmTimeoutSeconds = 1;
    rollbackGuardGraceSeconds = 1;
    healthAttempts = 3;
    healthPollSeconds = 0.01;
    curlCommand = fakeCurl;
    nginxCommand = fakeNginx;
    systemctlCommand = fakeSystemctl;
  };
  previousDeployment = import ./docs-deployment.nix {
    inherit
      pkgs
      rootPath
      socketPath
      ;
    site = previousSite;
    branch = "test";
    confirmTimeoutSeconds = 1;
    rollbackGuardGraceSeconds = 1;
    healthAttempts = 3;
    healthPollSeconds = 0.01;
    curlCommand = fakeCurl;
    nginxCommand = fakeNginx;
    systemctlCommand = fakeSystemctl;
  };
  previousSite = pkgs.runCommand "previous-docs-site" { } ''
    mkdir -p "$out/.etc/nginx"
    touch "$out/index.html" "$out/.etc/nginx/rewrite.conf"
  '';
  previousUnit = pkgs.writeText "previous-docs-site.service" "previous unit";
in
pkgs.runCommand "docs-deployment-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
  set -euo pipefail

  home=/tmp/docs-deployment-home
  unit_dir="$home/.config/systemd/user"
  unit_path="$unit_dir/docs-site-test.service"
  wants_dir="$unit_dir/default.target.wants"

  profile_rollback=/tmp/docs-deployment-profile-rollback
  profile_unrelated=/tmp/docs-deployment-profile-unrelated
  profile_timeout=/tmp/docs-deployment-profile-timeout
  profile_managed=/tmp/docs-deployment-profile-managed
  rm -rf ${rootPath} "$home"
  mkdir -p ${rootPath} "$wants_dir"

  prepare_transition() {
    local profile="$1"

    rm -f "$profile" "$profile".next "$profile"-*-link
    ln -s ${previousSite} "$profile-1-link"
    ln -s ${deployment.profile} "$profile-2-link"
    ln -s "$profile-2-link" "$profile"

    rm -f ${rootPath}/current "$unit_path" "$wants_dir/docs-site-test.service"
    ln -s ${previousSite} ${rootPath}/current
  }
  ln -s ${previousSite} ${rootPath}/current
  ln -s ${previousUnit} "$unit_path"
  ln -s "$unit_path" "$wants_dir/docs-site-test.service"

  printf '2\n' > ${rootPath}/health-failures
  HOME="$home" ${deployment.profile}/bin/activate
  test "$(cat ${rootPath}/health-failures)" = 0

  test "$(readlink ${rootPath}/current)" = ${site}
  test "$(readlink "$unit_path")" = ${deployment.backend.serviceUnit}
  grep -Fq 'nginx -e stderr -t -c' ${commandLog}
  grep -Fq 'systemctl --user daemon-reload' ${commandLog}
  grep -Fq 'systemctl --user restart docs-site-test' ${commandLog}
  grep -Fq 'curl --fail --silent --show-error --unix-socket ${socketPath}' ${commandLog}

  HOME="$home" ${deployment.profile}/bin/deactivate

  test "$(readlink ${rootPath}/current)" = ${previousSite}
  test "$(readlink "$unit_path")" = ${previousUnit}
  test "$(readlink "$wants_dir/docs-site-test.service")" = "$unit_path"

  touch ${rootPath}/fail-next-restart
  if HOME="$home" ${deployment.profile}/bin/activate; then
    echo "activation unexpectedly succeeded" >&2
    exit 1
  fi
  test "$(readlink ${rootPath}/current)" = ${previousSite}
  test "$(readlink "$unit_path")" = ${previousUnit}

  printf '3\n' > ${rootPath}/health-failures
  if HOME="$home" ${deployment.profile}/bin/activate; then
    echo "unhealthy activation unexpectedly succeeded" >&2
    exit 1
  fi
  test "$(cat ${rootPath}/health-failures)" = 0
  test "$(readlink ${rootPath}/current)" = ${previousSite}
  test "$(readlink "$unit_path")" = ${previousUnit}
  rm -f "$profile_managed" "$profile_managed".next "$profile_managed"-*-link
  ln -s ${previousDeployment.profile} "$profile_managed-1-link"
  ln -s ${deployment.profile} "$profile_managed-2-link"
  ln -s "$profile_managed-1-link" "$profile_managed"
  rm -f ${rootPath}/current "$unit_path" "$wants_dir/docs-site-test.service"
  HOME="$home" ${previousDeployment.profile}/bin/activate

  ln -s "$profile_managed-2-link" "$profile_managed.next"
  mv -Tf "$profile_managed.next" "$profile_managed"
  PROFILE="$profile_managed" HOME="$home" ${deployment.profile}/bin/activate

  ln -s "$profile_managed-1-link" "$profile_managed.next"
  mv -Tf "$profile_managed.next" "$profile_managed"
  PROFILE="$profile_managed" HOME="$home" ${previousDeployment.profile}/bin/activate
  test "$(readlink ${rootPath}/current)" = ${previousSite}
  test "$(readlink "$unit_path")" = ${previousDeployment.backend.serviceUnit}
  prepare_transition "$profile_rollback"
  PROFILE="$profile_rollback" HOME="$home" ${deployment.profile}/bin/activate
  ln -s "$profile_rollback-1-link" "$profile_rollback.next"
  mv -Tf "$profile_rollback.next" "$profile_rollback"
  for _ in $(seq 1 30); do
    if [ "$(readlink ${rootPath}/current)" = ${previousSite} ] && [ ! -L "$unit_path" ]; then
      break
    fi
    sleep 0.1
  done
  test "$(readlink ${rootPath}/current)" = ${previousSite}
  test ! -L "$unit_path"
  test ! -L "$wants_dir/docs-site-test.service"

  prepare_transition "$profile_unrelated"
  PROFILE="$profile_unrelated" HOME="$home" ${deployment.profile}/bin/activate
  ln -s ${site} "$profile_unrelated-3-link"
  ln -s "$profile_unrelated-3-link" "$profile_unrelated.next"
  mv -Tf "$profile_unrelated.next" "$profile_unrelated"
  sleep 2
  test "$(readlink ${rootPath}/current)" = ${site}
  test "$(readlink "$unit_path")" = ${deployment.backend.serviceUnit}

  prepare_transition "$profile_timeout"
  PROFILE="$profile_timeout" HOME="$home" ${deployment.profile}/bin/activate
  sleep 2
  test "$(readlink ${rootPath}/current)" = ${site}
  test "$(readlink "$unit_path")" = ${deployment.backend.serviceUnit}
  grep -Fq 'UMask=0007' ${deployment.backend.serviceUnit}
  grep -Fq 'ExecStartPost=${deployment.backend.socketReady}' ${deployment.backend.serviceUnit}
  grep -Fq '${pkgs.coreutils}/bin/chgrp --reference=${builtins.dirOf socketPath} ${socketPath}' ${deployment.backend.socketReady}
  grep -Fq '${pkgs.coreutils}/bin/chmod 0660 ${socketPath}' ${deployment.backend.socketReady}
  grep -Fq 'test -S ${socketPath}' ${deployment.backend.socketReady}
  grep -Fq '${socketPath}' ${deployment.backend.serviceUnit}

  rm -f ${socketPath}
  python3 -c 'import socket, sys, time; time.sleep(0.2); sock = socket.socket(socket.AF_UNIX); sock.bind(sys.argv[1]); time.sleep(1)' ${socketPath} &
  socket_pid=$!
  ${deployment.backend.socketReady}
  test "$(stat -c %a ${socketPath})" = 660
  wait "$socket_pid"

  touch "$out"
''
