#!/bin/sh
cd "$(dirname "$0")"
node -e "process.exit(+process.versions.node.split('.')[0] >= 24 ? 0 : 1)" 2>/dev/null || {
  echo "Handled needs Node 24 or newer. Install it from https://nodejs.org and run this again."
  exit 1
}
[ -d node_modules ] || npm install
[ -d desktop/node_modules ] || npm install --prefix desktop
[ -f .env ] || cp .env.example .env
unset ELECTRON_RUN_AS_NODE
exec npm start --prefix desktop
