#!/bin/zsh
# usage: one.sh <dbgPort> <httpPort> <tag> <scen>   (fresh load, sets up z0, runs the scenario)
P=$1; H=$2; TAG=$3; s=$4
CDP=$(dirname $0)/../cdp.mjs
export BENCH_DBG_PORT=$P
timeout 20 node $CDP goto "http://localhost:$H/?bench&playtest${Q:-}" >/dev/null
sleep 3
for i in {1..90}; do
  timeout 8 node $CDP eval "!!(window.__bench && window.setState && window.__boot && window.__boot.total)" 2>/dev/null | grep -q true && break; sleep 1
done
timeout 60 node $CDP eval "__bench.setup('z0').then(r => gameState)" >/dev/null
SHOTS=${SHOTS:+$SHOTS-$TAG-$s} timeout 200 node $(dirname $0)/drive.mjs $P $s $TAG-$s.json
