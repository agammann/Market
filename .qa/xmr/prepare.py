"""Prepare disposable runner-only configuration; never starts a service."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent

def prepare():
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'Linux'
    root = Path(os.environ['QA_RUNTIME']).resolve()
    assert root.parent == Path(os.environ['RUNNER_TEMP']).resolve()
    assert root.name.startswith('market-xmr-') and not root.exists()
    root.mkdir(mode=0o700)
    for name in ['pg-init', 'monero', 'buyer', 'seller', 'bitcoin', 'plugins', 'tor', 'app']:
        (root / name).mkdir(mode=0o700)
    credentials = {'providerEmail': 'verification@example.invalid',
                   'providerPassword': secrets.token_urlsafe(32) + 'aA1!',
                   'marketPassword': secrets.token_urlsafe(32) + 'aA1!',
                   'rpcPassword': secrets.token_hex(32)}
    (root / 'credentials.json').write_text(json.dumps(credentials), encoding='utf-8')
    (root / 'pg-init/01.sql').write_text('CREATE DATABASE nbxplorer;\nCREATE DATABASE btcpay;\n')
    (root / 'pg-init').chmod(0o755)
    (root / 'pg-init/01.sql').chmod(0o644)
    plugin = 'BTCPayServer.Plugins.Monero'
    url = 'https://btcpaypluginbuilder.blob.core.windows.net/artifacts/monero-plugin/17/' + plugin + '.btcpay'
    raw = urllib.request.urlopen(url, timeout=60).read(2 * 1024 * 1024)
    expected = 'd83074f45a05e595ef41b981ebab367f4e70d3406ed7fb724102a315bdb4a736'
    assert hashlib.sha256(raw).hexdigest() == expected, 'Plugin checksum mismatch'
    archive = root / 'plugin.btcpay'
    archive.write_bytes(raw)
    dest = root / 'plugins' / plugin
    with zipfile.ZipFile(archive) as zipped:
        assert all('/' not in name and '\\' not in name and name not in ['.', '..'] for name in zipped.namelist())
        zipped.extractall(dest)
    manifest = json.loads((dest / (plugin + '.json')).read_text())
    assert manifest['Version'] == '1.3.5' and manifest['Identifier'] == plugin
    images = json.loads((HERE / 'registry-metadata.json').read_text())
    def image(ref):
        return ref + '@' + images[ref]['linuxAmd64']
    def service(ref, **kwargs):
        return {'image': image(ref), 'network_mode': 'host', 'restart': 'no',
                'mem_limit': '1g', 'cpus': 1, **kwargs}
    mounts = lambda name, target: [str(root / name) + ':' + target]
    services = {}
    services['postgres'] = service('library/postgres:18.4',
        environment={'POSTGRES_HOST_AUTH_METHOD': 'trust'},
        command=['postgres', '-c', 'listen_addresses=127.0.0.1', '-p', '43883'],
        volumes=['pg:/var/lib/postgresql', str(root / 'pg-init') + ':/docker-entrypoint-initdb.d:ro'])
    services['bitcoin'] = service('btcpayserver/bitcoin:31.1-1', entrypoint=['bitcoind'],
        command=['-datadir=/data', '-regtest', '-server', '-rpcuser=verification',
                 '-rpcpassword=' + credentials['rpcPassword'], '-rpcbind=127.0.0.1',
                 '-rpcallowip=127.0.0.1', '-rpcport=43881', '-bind=127.0.0.1:43882',
                 '-port=43882', '-connect=0', '-dnsseed=0', '-discover=0', '-listenonion=0'],
        volumes=mounts('bitcoin', '/data'))
    services['nbxplorer'] = service('nicolasdorier/nbxplorer:2.6.10', environment={
        'NBXPLORER_NETWORK': 'regtest', 'NBXPLORER_CHAINS': 'BTC',
        'NBXPLORER_BIND': '127.0.0.1:43891', 'NBXPLORER_BTCRPCURL': 'http://127.0.0.1:43881/',
        'NBXPLORER_BTCNODEENDPOINT': '127.0.0.1:43882', 'NBXPLORER_BTCRPCUSER': 'verification',
        'NBXPLORER_BTCRPCPASSWORD': credentials['rpcPassword'],
        'NBXPLORER_POSTGRES': 'User ID=postgres;Host=127.0.0.1;Port=43883;Database=nbxplorer',
        'NBXPLORER_NOAUTH': '1'}, depends_on=['postgres', 'bitcoin'])
    services['monero'] = service('btcpayserver/monero:0.18.4.3', entrypoint=['monerod'],
        command=['--regtest', '--offline', '--keep-fakechain', '--fixed-difficulty=1',
                 '--rpc-bind-ip=127.0.0.1', '--rpc-bind-port=43884',
                 '--p2p-bind-ip=127.0.0.1', '--p2p-bind-port=43885',
                 '--zmq-rpc-bind-ip=127.0.0.1', '--zmq-rpc-bind-port=43886',
                 '--no-igd', '--hide-my-port', '--non-interactive', '--data-dir=/data'],
        volumes=mounts('monero', '/data'))
    for who, port in [('seller', 43887), ('buyer', 43888)]:
        services[who + '-wallet'] = service('btcpayserver/monero:0.18.4.3',
            entrypoint=['monero-wallet-rpc'], command=['--allow-mismatched-daemon-version',
            '--rpc-bind-ip=127.0.0.1', '--rpc-bind-port=' + str(port), '--disable-rpc-login',
            '--trusted-daemon', '--daemon-address=127.0.0.1:43884', '--wallet-dir=/wallet',
            '--non-interactive'], volumes=mounts(who, '/wallet'), depends_on=['monero'])
    services['btcpay'] = service('btcpayserver/btcpayserver:2.4.4', mem_limit='2g', environment={
        'BTCPAY_NETWORK': 'regtest', 'BTCPAY_CHAINS': 'BTC', 'BTCPAY_BIND': '127.0.0.1:49393',
        'BTCPAY_POSTGRES': 'User ID=postgres;Host=127.0.0.1;Port=43883;Database=btcpay',
        'BTCPAY_BTCEXPLORERURL': 'http://127.0.0.1:43891/', 'BTCPAY_BTCEXPLORERNOAUTH': '1',
        'BTCPAY_PLUGINDIR': '/plugins', 'BTCPAY_DOCKERDEPLOYMENT': 'false',
        'BTCPAY_XMR_DAEMON_URI': 'http://127.0.0.1:43884',
        'BTCPAY_XMR_WALLET_DAEMON_URI': 'http://127.0.0.1:43887',
        'BTCPAY_XMR_WALLET_DAEMON_WALLETDIR': '/wallet'},
        volumes=['btcpay:/datadir', str(root / 'plugins') + ':/plugins', str(root / 'seller') + ':/wallet'],
        depends_on=['postgres', 'nbxplorer', 'seller-wallet'])
    torrc = '\n'.join(['DataDirectory /state/data', 'SocksPort 127.0.0.1:43889',
        'Log notice stdout', 'HiddenServiceDir /state/app', 'HiddenServiceVersion 3',
        'HiddenServicePort 80 127.0.0.1:43890', 'HiddenServiceDir /state/provider',
        'HiddenServiceVersion 3', 'HiddenServicePort 80 127.0.0.1:49393', ''])
    (root / 'tor/torrc').write_text(torrc)
    services['tor'] = service('btcpayserver/tor:0.4.9.13', entrypoint=['tor'],
        command=['-f', '/state/torrc'], volumes=mounts('tor', '/state'), mem_limit='512m',
        user=f'{os.getuid()}:{os.getgid()}')
    (root / 'compose.json').write_text(json.dumps({'services': services, 'volumes': {'pg': {}, 'btcpay': {}}}, indent=2))
    (root / 'pins.json').write_text(json.dumps({'images': {v['image'].split('@')[0]: v['image'].split('@')[1] for v in services.values()},
        'pluginSha256': expected, 'pluginSource': '7824ff4481c75d171499b7bf69c532f9362dcd1e'}, indent=2))

if __name__ == '__main__':
    prepare()
