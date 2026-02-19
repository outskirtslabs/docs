#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR="$ROOT_DIR/build/site"
RUNTIME_DIR="$ROOT_DIR/build/.nginx-dev"
CONF_PATH="$RUNTIME_DIR/nginx.conf"
PID_FILE="$RUNTIME_DIR/nginx.pid"
LOG_FILE="$RUNTIME_DIR/error.log"

COMMAND="${1:-}"
PORT="${2:-${DEV_PORT:-8084}}"

if [ -z "$COMMAND" ]; then
  echo "Usage: $0 <start|stop|reload|foreground|test> [port]"
  exit 2
fi

mkdir -p \
  "$RUNTIME_DIR/tmp/client_body" \
  "$RUNTIME_DIR/tmp/proxy" \
  "$RUNTIME_DIR/tmp/fastcgi" \
  "$RUNTIME_DIR/tmp/uwsgi" \
  "$RUNTIME_DIR/tmp/scgi" \
  "$SITE_DIR/.etc/nginx"

REWRITE_CONF="$SITE_DIR/.etc/nginx/rewrite.conf"
if [ ! -f "$REWRITE_CONF" ]; then
  cat > "$REWRITE_CONF" <<'EOF'
# No Antora redirects generated for this build.
EOF
fi

cat > "$CONF_PATH" <<EOF
worker_processes 1;
pid $PID_FILE;
error_log $LOG_FILE error;

events {
  worker_connections 1024;
}

http {
  types {
    text/html html htm shtml;
    text/css css;
    application/javascript js mjs;
    application/json json map;
    image/svg+xml svg svgz;
    image/png png;
    image/jpeg jpeg jpg;
    image/webp webp;
    image/x-icon ico;
    font/woff woff;
    font/woff2 woff2;
    font/ttf ttf;
    text/plain txt md;
    application/xml xml;
  }
  default_type application/octet-stream;
  sendfile on;
  keepalive_timeout 65;
  access_log off;

  client_body_temp_path $RUNTIME_DIR/tmp/client_body;
  proxy_temp_path $RUNTIME_DIR/tmp/proxy;
  fastcgi_temp_path $RUNTIME_DIR/tmp/fastcgi;
  uwsgi_temp_path $RUNTIME_DIR/tmp/uwsgi;
  scgi_temp_path $RUNTIME_DIR/tmp/scgi;

  server {
    listen 127.0.0.1:$PORT;
    server_name localhost;
    root $SITE_DIR;
    etag on;
    if_modified_since exact;
    error_page 404 /404.html;

    include $REWRITE_CONF;

    location = /.etc/nginx/rewrite.conf {
      deny all;
      return 404;
    }

    location / {
      rewrite ^(.+)/$ \$1 break;
      try_files \$uri \$uri.html \$uri/index.html \$uri/ =404;
    }
  }
}
EOF

nginx_cmd_raw() {
  local args="${1:-}"
  nix-shell -p nginx --run "nginx -e stderr -p '$RUNTIME_DIR/' -c '$CONF_PATH' $args"
}

nginx_test_quiet() {
  local output=""
  if ! output="$(nginx_cmd_raw "-t" 2>&1)"; then
    printf '%s\n' "$output" >&2
    return 1
  fi
}

start_server() {
  nginx_test_quiet
  nginx_cmd_raw "-s stop" >/dev/null 2>&1 || true
  nginx_cmd_raw "" >/dev/null 2>&1
}

stop_server() {
  if [ -f "$PID_FILE" ]; then
    nginx_cmd_raw "-s stop" >/dev/null 2>&1 || true
  fi
}

reload_server() {
  nginx_test_quiet
  if [ -f "$PID_FILE" ]; then
    nginx_cmd_raw "-s reload" >/dev/null 2>&1
  else
    nginx_cmd_raw "" >/dev/null 2>&1
  fi
}

foreground_server() {
  nginx_test_quiet
  nix-shell -p nginx --run "nginx -e stderr -p '$RUNTIME_DIR/' -c '$CONF_PATH' -g 'daemon off; error_log stderr error;'"
}

case "$COMMAND" in
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  reload)
    reload_server
    ;;
  foreground)
    foreground_server
    ;;
  test)
    nginx_test_quiet
    ;;
  *)
    echo "Unknown command: $COMMAND"
    echo "Usage: $0 <start|stop|reload|foreground|test> [port]"
    exit 2
    ;;
esac
