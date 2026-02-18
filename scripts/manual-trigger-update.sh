#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-https://docs.outskirtslabs.com}"
hook_id="${HOOK_ID:-update-docs}"
endpoint="${ENDPOINT:-${base_url}/_deploy/${hook_id}}"
repo="${REPO:-outskirtslabs/client-ip}"
ref="${REF:-refs/heads/main}"
event="${EVENT:-push}"
body="${BODY:-{\"ref\":\"${ref}\",\"repository\":{\"full_name\":\"${repo}\"}}}"

headers=(
  -H "X-GitHub-Event: ${event}"
  -H "Content-Type: application/json"
)

if [ -n "${WEBHOOK_SECRET:-}" ]; then
  sig="sha1=$(printf '%s' "${body}" | openssl dgst -sha1 -hmac "${WEBHOOK_SECRET}" -binary | xxd -p -c 256)"
  headers+=( -H "X-Hub-Signature: ${sig}" )
  echo "sending signed webhook to ${endpoint} for ${repo} at ${ref}"
else
  echo "WEBHOOK_SECRET is unset; sending unsigned webhook request"
fi

resp_file="$(mktemp)"
trap 'rm -f "${resp_file}"' EXIT

http_code="$(
  curl -sS -o "${resp_file}" -w '%{http_code}' \
    "${headers[@]}" \
    --data "${body}" \
    "${endpoint}"
)"

echo "HTTP ${http_code}"
cat "${resp_file}"
