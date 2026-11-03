"""Live acceptance checks. Reads secret files locally; prints no credentials or balances."""
import json
from pathlib import Path
import urllib.request
import urllib.error
import subprocess

base = 'http://10.10.10.40'
basic = None
bearer = 'Bearer ' + Path('secrets/mcp_token').read_text().strip()

def request(port, path, auth=None, payload=None, extra=None):
    headers = dict(extra or {})
    if auth: headers['Authorization'] = auth
    if payload is not None: headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + ':' + str(port) + path, headers=headers, data=None if payload is None else json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.headers, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.headers, e.read().decode()

assert request(3016, '/')[0] == 200
assert request(3017, '/')[0] == 200
assert request(3018, '/mcp')[0] == 401
assert request(3016, '/', basic)[0] == 200
assert request(3017, '/', basic)[0] == 200
print('PASS: planner and Bench load without login; MCP still requires its service token')
status, _, text = request(3016, '/api/actual/state?year=2027', basic)
assert status == 200, 'Actual state request failed: ' + str(status)
state = json.loads(text)
assert len(state['accounts']) > 0 and len(state['categories']) > 0
assert state['budgetName'] == 'My Finances', 'Budget name could not be verified'
print('PASS: My Finances live read,', len(state['accounts']), 'accounts,', len(state['categories']), 'categories;', sum(x['status']=='read' for x in state['budgets']), 'readable months')
assert bearer[7:] not in text
for path in ['/api/actual/apply', '/api/actual/bank-sync', '/api/actual/reconcile']:
    assert request(3016, path, basic, {})[0] == (403 if path.endswith('/apply') else 404)
print('PASS: Actual write routes unavailable; service credentials absent from state response')
scenario = {'name':'Deployment verification','savings':{'startMonth':'2027-04','balanceCents':100021,'monthlyContributionCents':125000,'targetCents':20000000,'years':15,'annualIncreasePct':2.5,'annualReturnPct':4,'inflationPct':2.5,'escalation':'january'},'debt':{'balanceCents':100000,'monthlyPaymentCents':51000,'aprPct':12}}
status, _, text = request(3016, '/api/calculate', basic, scenario)
assert status == 200 and json.loads(text)['debt']['totalInterestCents'] == 1500
status, _, text = request(3016, '/api/scenarios', basic, scenario)
assert status == 201
saved = json.loads(text)
assert request(3016, '/api/scenarios/' + saved['id'], basic)[0] == 200
assert request(3016, '/api/calculate', basic, scenario, {'Origin':'https://untrusted.example'})[0] == 403
assert request(3016, '/api/calculate', basic, scenario, {'Origin':'malformed'})[0] == 403
print('PASS: calculation, scenario save/load and cross-origin request rejection')

def rpc(payload, session=None):
    headers = {'Accept':'application/json, text/event-stream'}
    if session: headers['Mcp-Session-Id'] = session
    status, response_headers, text = request(3018, '/mcp', bearer, payload, headers)
    assert status == 200, 'MCP request failed: ' + str(status)
    if text.startswith('event:') or text.startswith('data:'):
        messages = [json.loads(line[5:].strip()) for line in text.splitlines() if line.startswith('data:')]
        data = next(x for x in messages if x.get('id') == payload['id'])
    else: data = json.loads(text)
    assert 'error' not in data, 'MCP returned JSON-RPC error'
    return response_headers, data

headers, _ = rpc({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'deployment-verification','version':'1.0'}}})
session = headers.get('Mcp-Session-Id')
_, result = rpc({'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}}, session)
names = [t['name'] for t in result['result']['tools']]
assert 'get-accounts' in names
blocked = ['create-', 'update-', 'delete-', 'merge-', 'set-', 'add-', 'remove-', 'organize-', 'rename-', 'import-', 'run-bank']
assert not any(n.startswith(tuple(blocked)) for n in names), 'Unexpected MCP write tool'
_, result = rpc({'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'get-accounts','arguments':{}}}, session)
assert not result['result'].get('isError'), 'MCP Actual read failed'
print('PASS: MCP authenticated handshake,', len(names), 'read-only tools, live account retrieval')
logs = subprocess.check_output(['docker','compose','logs','--no-color','planner','mcp'], text=True, stderr=subprocess.DEVNULL)
secrets = [bearer[7:], Path('/home/pchrisoc/actual-api/.password').read_text().strip()]
assert all(secret not in logs for secret in secrets), 'A service log contains a credential'
print('PASS: mounted credentials absent from planner and MCP logs')
