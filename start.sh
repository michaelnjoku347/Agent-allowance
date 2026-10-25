#!/usr/bin/env bash
# Same as npm start. From the repo root: ./start.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Agent Allowance needs Node.js 22. Node is not installed. Install it from https://nodejs.org and try again."
  exit 1
fi

if ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(!(major>22||(major===22&&minor>=13))){console.log("Agent Allowance needs Node.js 22.13 or newer. You have Node "+process.versions.node+". Install Node 22 from https://nodejs.org and try again."); process.exit(1)}'; then
  exit 1
fi

exec node scripts/start.js
