"""Install, test and build the checked ZIP in a fresh temporary directory."""
import json, os, subprocess, sys, tempfile, zipfile
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('market_release_checker',Path(__file__).with_name('check-release.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def run():
    payload=Path(sys.argv[1]).resolve()
    module.verify(payload)
    manifest=json.loads((payload/'release.json').read_text())
    with tempfile.TemporaryDirectory(prefix='market-release-consumer-') as fresh:
        fresh=Path(fresh)
        with zipfile.ZipFile(payload/('Market-'+manifest['version']+'-source.zip')) as zipped:
            zipped.extractall(fresh)
        root=fresh/('Market-'+manifest['version'])
        assert not (root/'node_modules').exists() and not (root/'data').exists()
        command=['cmd.exe','/d','/c','pnpm','--version'] if os.name=='nt' else ['pnpm','--version']
        assert subprocess.check_output(command,cwd=root,text=True).strip()=='11.25.0', 'Use pnpm 11.25.0'
        version=subprocess.check_output(['node','--version'],cwd=root,text=True).strip()
        assert version=='v24.19.0', 'Use the tested Node 24.19.0 release toolchain'
        for args in [['install','--frozen-lockfile'],['test'],['build']]:
            command=['cmd.exe','/d','/c','pnpm',*args] if os.name=='nt' else ['pnpm',*args]
            subprocess.run(command,cwd=root,check=True,timeout=300)
        assert (root/'dist/index.html').is_file()
        assert not (root/'data').exists(), 'Tests must not create operator data'
        print(json.dumps({'result':'passed','version':manifest['version'],'sourceCommit':manifest['sourceCommit'],'sourceTree':manifest['sourceTree'],'freshInstallTestBuild':True}))

if __name__=='__main__': run()
