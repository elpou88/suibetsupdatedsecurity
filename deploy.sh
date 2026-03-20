#!/bin/bash
rm -f .git/index.lock .git/refs/remotes/origin/main.lock
git add -A
git commit -m "Fix server startup and on-chain betting detection"
git push origin fresh-main:main
echo ""
echo "=== PUSHED TO GITHUB ==="
echo "Railway will auto-deploy. If not, click Redeploy in Railway dashboard."
