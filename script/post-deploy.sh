#!/usr/bin/env bash
set -euo pipefail

# Usage: bash script/post-deploy.sh <AgentRegistry> <TaskRegistry> <BountyEscrow> <ValidatorPool> <ABBCore>

if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <AgentRegistry> <TaskRegistry> <BountyEscrow> <ValidatorPool> <ABBCore>"
  echo "Example: $0 0xAA.. 0xBB.. 0xCC.. 0xDD.. 0xEE.."
  exit 1
fi

AGENT_REGISTRY="$1"
TASK_REGISTRY="$2"
BOUNTY_ESCROW="$3"
VALIDATOR_POOL="$4"
ABBCORE="$5"

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_ENV="$BASE_DIR/api/.env"
FRONTEND_ENV="$BASE_DIR/frontend/.env.local"

echo "=== Updating contract addresses ==="
echo "AgentRegistry:  $AGENT_REGISTRY"
echo "TaskRegistry:   $TASK_REGISTRY"
echo "BountyEscrow:   $BOUNTY_ESCROW"
echo "ValidatorPool:  $VALIDATOR_POOL"
echo "ABBCore:        $ABBCORE"

# --- Update api/.env ---
echo ""
echo ">>> Updating $API_ENV"
sed -i "s|^ABBCORE_ADDRESS=.*|ABBCORE_ADDRESS=$ABBCORE|" "$API_ENV"
sed -i "s|^AGENT_REGISTRY_ADDRESS=.*|AGENT_REGISTRY_ADDRESS=$AGENT_REGISTRY|" "$API_ENV"
sed -i "s|^TASK_REGISTRY_ADDRESS=.*|TASK_REGISTRY_ADDRESS=$TASK_REGISTRY|" "$API_ENV"
sed -i "s|^BOUNTY_ESCROW_ADDRESS=.*|BOUNTY_ESCROW_ADDRESS=$BOUNTY_ESCROW|" "$API_ENV"
sed -i "s|^VALIDATOR_POOL_ADDRESS=.*|VALIDATOR_POOL_ADDRESS=$VALIDATOR_POOL|" "$API_ENV"
echo "✅ api/.env updated"

# --- Update frontend/.env.local ---
echo ""
echo ">>> Updating $FRONTEND_ENV"
sed -i "s|^NEXT_PUBLIC_ABBCORE_ADDRESS=.*|NEXT_PUBLIC_ABBCORE_ADDRESS=$ABBCORE|" "$FRONTEND_ENV"
sed -i "s|^NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS=.*|NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS=$AGENT_REGISTRY|" "$FRONTEND_ENV"
sed -i "s|^NEXT_PUBLIC_TASK_REGISTRY_ADDRESS=.*|NEXT_PUBLIC_TASK_REGISTRY_ADDRESS=$TASK_REGISTRY|" "$FRONTEND_ENV"
sed -i "s|^NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS=.*|NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS=$BOUNTY_ESCROW|" "$FRONTEND_ENV"
sed -i "s|^NEXT_PUBLIC_VALIDATOR_POOL_ADDRESS=.*|NEXT_PUBLIC_VALIDATOR_POOL_ADDRESS=$VALIDATOR_POOL|" "$FRONTEND_ENV"
echo "✅ frontend/.env.local updated"

# --- Rebuild frontend ---
echo ""
echo ">>> Rebuilding frontend..."
cd "$BASE_DIR/frontend"
npx next build
echo "✅ Frontend rebuilt"

# --- Restart services ---
echo ""
echo ">>> Restarting services..."
sudo systemctl restart agentecon-api
sudo systemctl restart agentecon-frontend
sleep 3
echo "✅ Services restarted"

# --- Health checks ---
echo ""
echo ">>> Health checks..."

API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/health 2>/dev/null || echo "000")
if [ "$API_STATUS" = "200" ]; then
  echo "✅ API healthy (HTTP $API_STATUS)"
else
  echo "⚠️  API returned HTTP $API_STATUS — check: sudo journalctl -u agentecon-api -f"
fi

FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null || echo "000")
if [ "$FRONTEND_STATUS" = "200" ]; then
  echo "✅ Frontend healthy (HTTP $FRONTEND_STATUS)"
else
  echo "⚠️  Frontend returned HTTP $FRONTEND_STATUS — check: sudo journalctl -u agentecon-frontend -f"
fi

echo ""
echo "=== Redeploy complete ==="
echo "Verify on-chain:"
echo "  cast call $AGENT_REGISTRY 'authorizedCallers(address)(bool)' $ABBCORE --rpc-url https://sepolia.base.org"
