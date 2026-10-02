"""Retain only predeclared diagnostics; never upload raw runtime data."""
import json
import os
from pathlib import Path
import re

root = Path(os.environ['QA_RUNTIME'])
report_path = Path(os.environ['QA_REPORT'])
report = json.loads(report_path.read_text())
report['processExit'] = int(os.environ['QA_EXIT'])
report['cleanupCompleted'] = os.environ.get('QA_CLEANED') == 'true'
if report['result'] == 'passed' and report['processExit'] != 0:
    report['result'] = 'cleanup_failed'
elif report['result'] == 'not_started' and report['processExit'] != 0:
    report['result'] = 'setup_failed'
# Bounded error classification, without forwarding URLs, tokens, addresses or request payloads.
patterns = {'disk_full': r'No space left on device', 'image_unavailable': r'manifest unknown|not found: manifest',
            'network_fetch': r'Could not resolve|ENOTFOUND|ECONNRESET|TLS handshake timeout',
            'address_in_use': r'address already in use|EADDRINUSE', 'timeout': r'TimeoutError|timed out',
            'assertion_failed': r'AssertionError', 'plugin_error': r'Could not load.*Monero'}
report['diagnosticCategories'] = sorted({name for file in root.glob('*.log')
    for name, pattern in patterns.items() if re.search(pattern, file.read_text(errors='replace')[-200000:])})
report_path.write_text(json.dumps(report, indent=2))
