"""Build a versioned source ZIP from exactly the clean Git commit."""
import hashlib, json, re, subprocess, sys, zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])

def build(destination):
    package = json.loads((root / 'package.json').read_text())
    version = package['version']
    assert re.fullmatch(r'\d+\.\d+\.\d+', version)
    assert not git('status', '--porcelain'), 'Commit or remove working tree changes before packaging'
    destination = Path(destination).resolve()
    assert not destination.exists(), 'Release destination must be fresh'
    destination.mkdir(parents=True)
    commit = git('rev-parse', 'HEAD').decode().strip()
    tree = git('rev-parse', 'HEAD^{tree}').decode().strip()
    entries = []
    for line in git('ls-tree', '-rz', 'HEAD').split(b'\0'):
        if not line: continue
        meta, raw_name = line.split(b'\t', 1)
        mode, kind, blob = meta.decode().split()
        name = raw_name.decode('utf-8')
        assert kind == 'blob' and mode in ['100644', '100755']
        assert not name.startswith('/') and '..' not in name.split('/') and '\\' not in name
        data = git('cat-file', 'blob', blob)
        entries.append((name, mode, data))
    manifest = {'name':'Market', 'version':version, 'delivery':'source', 'sourceCommit':commit,
                'sourceTree':tree, 'files':[{'path':n,'mode':m,'size':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,m,b in entries]}
    manifest_bytes = (json.dumps(manifest, indent=2) + '\n').encode()
    prefix = 'Market-' + version + '/'
    archive = destination / ('Market-' + version + '-source.zip')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
        for name, mode, data in [*entries, ('RELEASE.json', '100644', manifest_bytes)]:
            info = zipfile.ZipInfo(prefix + name, (2026,1,1,0,0,0))
            info.create_system = 3
            info.external_attr = (int(mode, 8) << 16)
            info.compress_type = zipfile.ZIP_DEFLATED
            zipped.writestr(info, data)
    (destination / 'release.json').write_bytes(manifest_bytes)
    lines = []
    for name in [archive.name, 'release.json']:
        line = hashlib.sha256((destination / name).read_bytes()).hexdigest() + '  ' + name + '\n'
        (destination / (name + '.sha256')).write_text(line, encoding='ascii')
        lines.append(line)
    (destination / 'SHA256SUMS').write_text(''.join(lines), encoding='ascii')
    print(json.dumps({'version':version,'sourceCommit':commit,'sourceTree':tree,'files':len(entries),'archive':str(archive)}))

if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv)>1 else root / 'dist-release')
