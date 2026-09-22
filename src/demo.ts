import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { run } from './launcher';
import { writeNew, UserError } from './core/io';
import { writeComparisonKey } from './core/privacy';
import { renderDiffHtml } from './report/html';
import { diffTraces } from './core/analyze';

export async function createDemo(destination?: string): Promise<string> {
  const root = destination ? path.resolve(destination) : path.resolve('.configtrace', `demo-${Date.now()}`);
  let dotenv: string;
  try { dotenv = createRequire(__filename).resolve('dotenv'); }
  catch { throw new UserError('The demo needs dotenv. Run npm install in the ConfigTrace source checkout first.'); }
  try { fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 }); fs.mkdirSync(root, { mode: 0o700 }); }
  catch { throw new UserError('The demo output must be a new writable directory.'); }
  writeNew(path.join(root, 'sample.env'), 'DATABASE_URL=postgres://demo:synthetic-only@localhost/new\n');
  writeNew(path.join(root, 'app.cjs'), `const dotenv = require(${JSON.stringify(dotenv)});\ndotenv.config({ path: require('node:path').join(__dirname, 'sample.env'), quiet: true });\nconst value = process.env.DATABASE_URL;\nconsole.log(value.endsWith('/old') ? 'Using the stale synthetic database.' : 'Using the intended synthetic database.');\n`);
  const keyFile = path.join(root, 'pair.key.json'); writeComparisonKey(keyFile);
  const baseEnv = { ...process.env };
  for (const name of Object.keys(baseEnv)) if (name.toUpperCase() === 'DATABASE_URL') delete baseEnv[name];
  const common = { command: [process.execPath, path.join(root, 'app.cjs')], cwd: root, watch: ['DATABASE_URL'], keyFile };
  const bad = await run({ ...common, env: { ...baseEnv, DATABASE_URL: 'postgres://demo:synthetic-only@localhost/old' }, out: path.join(root, 'bad.ct.json') });
  const good = await run({ ...common, env: baseEnv, out: path.join(root, 'good.ct.json') });
  writeNew(path.join(root, 'comparison.html'), renderDiffHtml(bad.trace, good.trace, diffTraces(bad.trace, good.trace)));
  return root;
}
