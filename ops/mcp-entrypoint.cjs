const fs = require('node:fs');
const { spawn } = require('node:child_process');
process.env.ACTUAL_PASSWORD = fs.readFileSync('/run/secrets/actual_password', 'utf8').trim();
process.env.BEARER_TOKEN = fs.readFileSync('/run/secrets/mcp_token', 'utf8').trim();
const child = spawn(process.execPath, ['build/index.js', ...process.argv.slice(2)], {stdio:'inherit', env:process.env});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
