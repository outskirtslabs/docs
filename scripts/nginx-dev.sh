#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR="$ROOT_DIR/build/site"
RUNTIME_DIR="$ROOT_DIR/build/.nginx-dev"
CONF_PATH="$RUNTIME_DIR/nginx.conf"
HTTP_CONF_PATH="$RUNTIME_DIR/http.conf"
SITE_CONF_PATH="$RUNTIME_DIR/site.conf"
HTTP_CONF_TEMPLATE="$ROOT_DIR/config/nginx-http.conf.in"
SITE_CONF_TEMPLATE="$ROOT_DIR/config/nginx-site.conf.in"
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
sed "s|@TEMP_DIR@|$RUNTIME_DIR/tmp|g" \
  "$HTTP_CONF_TEMPLATE" > "$HTTP_CONF_PATH"
sed \
  -e "s|@SITE_DIR@|$SITE_DIR|g" \
  -e "s|@REWRITE_CONF@|$REWRITE_CONF|g" \
  "$SITE_CONF_TEMPLATE" > "$SITE_CONF_PATH"

cat > "$CONF_PATH" <<EOF
worker_processes 1;
pid $PID_FILE;
error_log $LOG_FILE error;

events {
  worker_connections 1024;
}

http {
  include $HTTP_CONF_PATH;

  server {
    listen 127.0.0.1:$PORT;
    server_name localhost;
    include $SITE_CONF_PATH;
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
