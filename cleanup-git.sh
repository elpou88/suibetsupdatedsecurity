#!/bin/bash
echo "Cleaning up platform config and dev tooling files..."
git rm -r --cached .agents .replit_integration_files attached_assets .replit replit.nix .replitignore cleanup-git.sh security-research/ 2>/dev/null || true
git rm -r --cached artifacts/api-server/.replit-artifact artifacts/mockup-sandbox/.replit-artifact artifacts/suibets-explainer/.replit-artifact artifacts/suibets/.replit-artifact 2>/dev/null || true
git rm --cached contracts/flux_engine/deployed.env contracts/p2p_betting/deployed.env contracts/pulse_engine/deployed.env 2>/dev/null || true
git add .gitignore
git commit -m "chore: clean up platform config and dev tooling files"
git push
echo "Done! All platform config files removed from GitHub."
