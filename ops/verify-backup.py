import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

script = "const fs=require('fs');const p='/data/backups/';const f=fs.readdirSync(p).filter(n=>n.endsWith('.zip.json')).sort().at(-1);if(!f)process.exit(1);console.log(fs.readFileSync(p+f,'utf8'));"
audit = json.loads(subprocess.check_output(['docker','compose','exec','-T','planner','node','-e',script], text=True))
assert '/' not in audit['file'] and audit['file'].endswith('.zip')
with tempfile.TemporaryDirectory(prefix='actual-backup-check-') as directory:
    destination = Path(directory) / 'snapshot.zip'
    subprocess.run(['docker','compose','cp','planner:/data/backups/' + audit['file'],str(destination)], check=True, capture_output=True)
    data = destination.read_bytes()
    assert len(data) == audit['bytes']
    assert hashlib.sha256(data).hexdigest() == audit['sha256']
    with zipfile.ZipFile(destination) as z:
        assert z.testzip() is None
        assert any(n.endswith('db.sqlite') for n in z.namelist())
print('PASS: exported backup size, SHA256, ZIP CRCs and budget database entry; no restore performed')
