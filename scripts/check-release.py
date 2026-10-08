"""Check the exact source file set, ZIP modes, version and public checksums."""
import hashlib, json, re, subprocess, sys, zipfile
from pathlib import Path, PurePosixPath

def verify(destination, source=None):
    destination = Path(destination).resolve()
    manifest = json.loads((destination / 'release.json').read_text())
    version = manifest['version']
    assert manifest['name']=='Market' and manifest['delivery']=='source'
    assert re.fullmatch(r'\d+\.\d+\.\d+',version)
    for key in ['sourceCommit','sourceTree']: assert re.fullmatch(r'[0-9a-f]{40}',manifest[key])
    archive = 'Market-'+version+'-source.zip'
    expected = {archive,archive+'.sha256','release.json','release.json.sha256','SHA256SUMS'}
    assert {p.name for p in destination.iterdir()} == expected, 'Unexpected release payload set'
    lines = []
    for name in [archive,'release.json']:
        line = hashlib.sha256((destination/name).read_bytes()).hexdigest()+'  '+name+'\n'
        assert (destination/(name+'.sha256')).read_text() == line
        lines.append(line)
    assert (destination/'SHA256SUMS').read_text() == ''.join(lines)
    names = [f['path'] for f in manifest['files']]
    assert 0<len(names)<1000 and len(names)==len(set(names))==len({n.casefold() for n in names}), 'Duplicate source path'
    for name in names:
        assert '\\' not in name and not name.startswith('/') and '..' not in name.split('/')
        assert str(PurePosixPath(name))==name and ':' not in name and name!='RELEASE.json'
    prefix='Market-'+version+'/'
    with zipfile.ZipFile(destination/archive) as zipped:
        infos=zipped.infolist()
        assert len(infos)==len({i.filename for i in infos}), 'Duplicate ZIP member'
        assert {i.filename for i in infos} == {prefix+n for n in names}|{prefix+'RELEASE.json'}
        assert zipped.read(prefix+'RELEASE.json')==(destination/'release.json').read_bytes()
        for entry in manifest['files']:
            data=zipped.read(prefix+entry['path'])
            assert len(data)==entry['size'] and hashlib.sha256(data).hexdigest()==entry['sha256']
            assert entry['mode'] in ['100644','100755'] and zipped.getinfo(prefix+entry['path']).external_attr>>16==int(entry['mode'],8)
        package=json.loads(zipped.read(prefix+'package.json'))
        assert package['version']==version and package['license']=='MIT'
        assert zipped.read(prefix+'LICENSE').startswith(b'MIT License\n')
        if source is not None:
            source=Path(source).resolve()
            def git(*args): return subprocess.check_output(['git','-C',str(source),*args])
            assert git('rev-parse','HEAD').decode().strip()==manifest['sourceCommit'], 'Checkout commit differs'
            assert git('rev-parse','HEAD^{tree}').decode().strip()==manifest['sourceTree'], 'Checkout tree differs'
            tracked={}
            for line in git('ls-tree','-rz','HEAD').split(b'\0'):
                if not line: continue
                meta,name=line.split(b'\t',1)
                mode,kind,blob=meta.decode().split()
                assert kind=='blob'
                tracked[name.decode('utf-8')]=(mode,blob)
            assert set(tracked)==set(names), 'Source file set differs from checkout'
            for entry in manifest['files']:
                mode,blob=tracked[entry['path']]
                assert entry['mode']==mode
                assert zipped.read(prefix+entry['path'])==git('cat-file','blob',blob), 'Source bytes differ from checkout'
    print(json.dumps({'result':'passed','version':version,'sourceCommit':manifest['sourceCommit'],'sourceTree':manifest['sourceTree'],'sourceFiles':len(names)}))

if __name__=='__main__':
    args=sys.argv[1:]
    source=None
    if '--source' in args:
        index=args.index('--source');source=args[index+1];del args[index:index+2]
    verify(args[0] if args else Path(__file__).resolve().parent.parent/'dist-release',source)
