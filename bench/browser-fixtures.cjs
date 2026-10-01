'use strict';
// Synthetic report fixtures only. No application is launched and no build is emitted.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { values } = parseArgs({ options: { dir: { type: 'string' } }, strict: true });
if (!values.dir) throw new Error('Usage: node bench/browser-fixtures.cjs --dir NEW_DIRECTORY');
require('../scripts/register-source.cjs');
const { makeTrace } = require('./fixtures.cjs');
const { renderTraceHtml, renderDiffHtml } = require('../src/report/html.ts');
const a = makeTrace(10000, 16, 0);
a.events[0].site = { file: '</script><script>window.INJECTED=1</script>', line: 1, mapping: 'generated' };
const left = makeTrace(640, 16, 0), right = makeTrace(640, 16, 1);
const directory = path.resolve(values.dir);
fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
fs.writeFileSync(path.join(directory, 'single.html'), renderTraceHtml(a), { flag: 'wx', mode: 0o600 });
fs.writeFileSync(path.join(directory, 'pair.html'), renderDiffHtml(left, right), { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ directory, singleEvents: 2000, pairEvents: 1280 }) + '\n');
