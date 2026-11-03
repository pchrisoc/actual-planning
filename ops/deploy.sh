#!/bin/sh
set -eu
cd /home/pchrisoc/financial-planner
umask 077
mkdir -p secrets
if [ ! -f .env ]; then cp .env.example .env; fi
test -r /home/pchrisoc/actual-api/.password
if [ ! -s secrets/mcp_token ]; then openssl rand -hex 32 > secrets/mcp_token; fi
if [ ! -s secrets/bridge_api_key ]; then openssl rand -hex 32 > secrets/bridge_api_key; fi
chmod 600 secrets/mcp_token secrets/bridge_api_key
chmod 644 ops/bench-nginx.conf
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
docker compose config --quiet
docker compose pull bench mcp gateway bridge
python3 - <<'PY'
import json, subprocess
from pathlib import Path
p = Path('.env')
settings = dict(line.split('=', 1) for line in p.read_text().splitlines() if '=' in line and not line.startswith('#'))
defaults = {'BENCH_IMAGE':'xrous/actual-bench:latest','MCP_IMAGE':'sstefanov/actual-mcp:latest','BRIDGE_IMAGE':'jhonderson/actual-http-api:26.10.0'}
for key, default in defaults.items():
    image = settings.get(key, default)
    result = json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]
    if result.get('RepoDigests'): settings[key] = result['RepoDigests'][0]
p.write_text(''.join(f'{k}={v}\n' for k,v in settings.items()))
PY
docker compose build planner
docker volume create actual-planning_mcp-data > /dev/null
docker volume create actual-planning_bridge-data > /dev/null
for volume in actual-planning_planner-data actual-planning_mcp-data actual-planning_bridge-data; do
  docker run --rm --network none --user 0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER -v "$volume:/data" --entrypoint sh actual-planning-companion:0.1.0 -c 'chown 1000:1000 /data && chmod 700 /data'
done
docker compose up -d planner bench gateway mcp bridge
docker compose ps
printf 'DEPLOY_FINISHED\n'
