#!/usr/bin/env bash
# Set up / update the Y2027 Eligibility Portal on Cloudflare.
#   ./deploy.sh                      publish (creates the database the first time)
#   ./deploy.sh path/to/backup.json  ...and load a portal backup
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Install the LTS version from https://nodejs.org and try again."; exit 1; }
echo "Installing tools (first run only takes a minute)..."
npm install --no-audit --no-fund
if [ -n "$1" ]; then node scripts/deploy.mjs --backup "$1"; else node scripts/deploy.mjs; fi
