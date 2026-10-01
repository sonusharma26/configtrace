"""Optional Chromium DOM smoke check. Requires separately installed Playwright/Chromium.
Loads HTML into an in-memory page: this is NOT a file:// compatibility test.
"""
from argparse import ArgumentParser
from pathlib import Path
import json
import platform
from playwright.sync_api import sync_playwright

parser = ArgumentParser(description=__doc__)
parser.add_argument('--dir', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--executable', help='Existing Chromium executable; omit to use Playwright\'s existing browser')
args = parser.parse_args()
results, errors, requests = [], [], []
with sync_playwright() as playwright:
    options = {'headless': True}
    if args.executable:
        options['executable_path'] = args.executable
    browser = playwright.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1400, 'height': 950})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    for kind, expected in [('single', 2000), ('pair', 1280)]:
        page.set_content((args.dir / f'{kind}.html').read_text(encoding='utf-8'), wait_until='load')
        assert page.locator('.event').count() == expected, (kind, page.locator('.event').count(), expected)
        assert page.evaluate('window.INJECTED === undefined')
        page.locator('#search').fill('CONFIG_0')
        page.locator('#operation').select_option('read')
        visible = page.locator('.event:not([hidden])').count()
        assert visible > 0
        assert page.locator('.event:not([hidden])').evaluate_all(
            "nodes => nodes.every(n => n.dataset.op === 'read' && n.dataset.search.includes('config_0'))")
        page.locator('#search').fill('')
        page.locator('#operation').select_option('')
        if kind == 'single':
            page.locator('a[data-jump="provenance"]').first.click()
            assert page.locator('[data-panel="provenance"]').is_visible()
            page.locator('a[data-jump="timeline"]').first.click()
            assert page.locator('[data-panel="timeline"]').is_visible()
            assert '#event-' in page.url
        results.append({'report': kind, 'hydratedEvents': expected, 'filteredReadEvents': visible,
                        'scriptInjection': False, 'filters': 'pass',
                        'navigation': 'pass' if kind == 'single' else 'not-applicable'})
    assert not errors, errors
    external = [url for url in requests if url.startswith(('http://', 'https://'))]
    assert not external, external
    result = {'browser': browser.version, 'engine': 'Chromium', 'platform': platform.system(),
              'results': results, 'pageErrors': errors, 'externalRequests': external,
              'scope': 'Chromium in-memory document smoke check. Local-file loading, other browsers, accessibility and release packaging were not validated.'}
    browser.close()
with args.out.open('x', encoding='utf-8') as output:
    json.dump(result, output, indent=2)
    output.write('\n')
print(json.dumps(result, indent=2))
