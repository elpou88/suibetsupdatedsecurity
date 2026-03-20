#!/bin/bash
rm -f .git/index.lock .git/refs/remotes/origin/main.lock .git/refs/remotes/origin/fresh-main.lock
git add -A
git commit -m "Fix server crash - resilient static file serving and error handling"
git push origin fresh-main:main
echo ""
echo "=== DONE - Check Railway for new deployment ==="
