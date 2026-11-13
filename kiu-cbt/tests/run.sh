#!/bin/bash
# Tests against the real Cloudflare runtime (workerd, via wrangler dev), each on a fresh empty database.
#   tests/run.sh PORT node tests/<test>.js http://127.0.0.1:PORT [extra args]
# Needs: cd cloudflare && npm install && node tools/build.mjs; Playwright for the browser tests (rvbrowser, e2e).
# Extra args used by the tests: cfcourse.js, e2e.js → the R2 folder: .test-state/PORT/v3/r2; rvbrowser.js, e2e.js → a folder for screenshots.
here=$(cd "$(dirname "$0")" && pwd); CF=$here/../cloudflare; STATE=$here/../.test-state; port=$1; shift
stop() { pkill -f -- "--port $port " ; pkill -f -- "socket-addr=entry=127.0.0.1:$port " ; sleep 1; }
stop; rm -rf "$STATE/$port"; mkdir -p "$STATE"
(cd "$CF" && nohup npx wrangler dev --port $port --ip 127.0.0.1 --persist-to "$STATE/$port" --show-interactive-dev-session=false > "$STATE/$port.log" 2>&1 < /dev/null &)
for i in $(seq 1 90); do curl -s -m 2 http://127.0.0.1:$port/api >/dev/null 2>&1 && break; sleep 1; done
"$@" 2>&1 | grep -E "^PASS|^FAIL|passed|ERROR"
stop; rm -rf "$STATE/$port"
