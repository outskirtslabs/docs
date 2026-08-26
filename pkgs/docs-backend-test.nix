{
  pkgs,
  site,
  backend,
}:

pkgs.runCommand "docs-backend-test"
  {
    nativeBuildInputs = [ pkgs.curl ];
  }
  ''
    set -euo pipefail

    mkdir -p ${backend.runtimePath}/{client_body,proxy,fastcgi,uwsgi,scgi}
    ${pkgs.nginx}/bin/nginx -e stderr -t -c ${backend.nginxConfig}
    ${pkgs.nginx}/bin/nginx -e stderr -c ${backend.nginxConfig} &
    nginx_pid=$!
    trap 'kill "$nginx_pid" 2>/dev/null || true' EXIT

    for _ in $(seq 1 50); do
      if [ -S ${backend.socketPath} ]; then
        break
      fi
      sleep 0.1
    done
    test -S ${backend.socketPath}

    request() {
      local path="$1"
      ${pkgs.curl}/bin/curl --silent --show-error --unix-socket ${backend.socketPath} \
        --dump-header "$TMPDIR/headers" --output "$TMPDIR/body" "http://localhost$path"
    }

    assert_status() {
      grep -Eq "^HTTP/[0-9.]+ $1" "$TMPDIR/headers"
    }

    assert_location() {
      grep -Fqi "Location: $1" "$TMPDIR/headers"
    }

    request /clave
    assert_status 301
    assert_location /ol.clave/

    request /clave/
    assert_status 301
    assert_location /ol.clave/

    request /ol.clave
    assert_status 301
    assert_location /ol.clave/next/

    request /ol.dirs
    assert_status 301
    assert_location /ol.dirs/0.1/

    request /ol.clave/latest/changelog
    assert_status 302
    assert_location /ol.clave/next/changelog

    request /ol.dirs/0.1/changelog
    assert_status 200
    grep -Fqi 'Cache-Control: public, no-transform, max-age=1800, must-revalidate' "$TMPDIR/headers"

    request /ol.dirs/0.1/api/
    assert_status 200

    request /ol.dirs/0.1/changelog/
    assert_status 301
    assert_location /ol.dirs/0.1/changelog

    request /_/font/verbregular-webfont.woff2
    assert_status 200
    grep -Fqi 'Cache-Control: public, no-transform, max-age=2592000, must-revalidate' "$TMPDIR/headers"

    request /.etc/nginx/rewrite.conf
    assert_status 404

    request /missing-page
    assert_status 404
    grep -Fq 'Page Not Found' "$TMPDIR/body"

    ${pkgs.curl}/bin/curl --silent --show-error --head --unix-socket ${backend.socketPath} \
      --dump-header "$TMPDIR/headers" --output /dev/null http://localhost/clave
    assert_status 301
    assert_location /ol.clave/

    touch "$out"
  ''
