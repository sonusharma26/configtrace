import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createComparisonKey, readComparisonKey, parseWatch } from './core/privacy';
import { readTrace, uniqueId, UserError, writeNew, writeTrace } from './core/io';
import { collectTrace, coverageFor } from './core/collect';
import { SCHEMA_VERSION, TOOL_VERSION, type Trace, type Notice } from './core/schema';
import type { RuntimeConfig } from './runtime/api';

export interface RunOptions {
  command: string[];
  watch: string[];
  out: string;
  cwd?: string;
  keyFile?: string;
  compareWith?: string;
  children?: boolean;
  sourceMaps?: boolean;
  dotenv?: boolean;
  maxEvents?: number;
  childDrainMs?: number;
  adapters?: string[];
  /** SDK/demo only: values remain in the launched process environment, never in metadata. */
  env?: NodeJS.ProcessEnv;
}
export interface RunResult { trace: Trace; exitCode: number | null; signal: NodeJS.Signals | null; artifactWritten: boolean }

export async function run(options: RunOptions): Promise<RunResult> {
  const watch = parseWatch(options.watch);
  const root = path.resolve(options.cwd || process.cwd());
  const out = path.resolve(options.out);
  const [command, ...args] = options.command;
  if (!command || !(command === process.execPath || /^(node|node\.exe)$/i.test(command))) {
    throw new UserError('Run a direct Node command after --, for example: -- node app.mjs. Shell and npm wrappers are not supported.');
  }
  if (fs.existsSync(out)) throw new UserError('Output already exists. Choose a new --out path.', 74);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UserError('The working directory does not exist.');
  const maxEvents = options.maxEvents ?? 5000;
  const drain = options.childDrainMs ?? 500;
  if (!Number.isInteger(maxEvents) || maxEvents < 10 || maxEvents > 100000) throw new UserError('--max-events must be an integer between 10 and 100000.');
  if (!Number.isInteger(drain) || drain < 0 || drain > 5000) throw new UserError('--child-drain-ms must be an integer between 0 and 5000.');
  if ((options.adapters || []).length > 8) throw new UserError('At most eight trusted local adapters may be selected.');
  const key = options.keyFile ? readComparisonKey(path.resolve(options.keyFile)) : createComparisonKey();
  if (options.compareWith) {
    if (!options.keyFile) throw new UserError('--compare-with requires the original --key file; the artifact cannot recover its secret.');
    const previous = readTrace(options.compareWith);
    if (previous.comparison.mode !== 'hmac-sha256' || previous.comparison.domainId !== key.domainId) throw new UserError('Comparison key does not match the earlier run.', 65);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'configtrace-'));
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  const config: RuntimeConfig = {
    runId: uniqueId('r'), directory, root, rootId: uniqueId('p'), watch, comparison: key,
    maxEvents, maxBytes: 8 * 1024 * 1024, children: !!options.children,
    maxDepth: 4, maxChildren: 16, sourceMaps: !!options.sourceMaps,
    dotenv: options.dotenv !== false, adapters: (options.adapters || []).map(p => path.resolve(p)),
    preloadPath: path.resolve(__dirname, 'runtime/preload.js'), configPath: path.join(directory, 'session.json'),
  };
  try {
    writeNew(config.configPath, JSON.stringify(config));
    const env: NodeJS.ProcessEnv = { ...(options.env || process.env) };
    for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('__CONFIGTRACE_')) delete env[key];
    env.__CONFIGTRACE_CONFIG = config.configPath;
    env.__CONFIGTRACE_INSTANCE = config.rootId;
    env.__CONFIGTRACE_DEPTH = '0';
    const launchArgs = ['--require', config.preloadPath, ...(config.sourceMaps ? ['--enable-source-maps'] : []), ...args];
    const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(command, launchArgs, { cwd: root, env, stdio: 'inherit', shell: false });
      const forwarders = new Map<NodeJS.Signals, () => void>();
      const clear = () => { for (const [signal, fn] of forwarders) process.removeListener(signal, fn); };
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        const fn = () => { if (child.exitCode === null && child.signalCode === null) { try { child.kill(signal); } catch { /* process already ended */ } } };
        forwarders.set(signal, fn); process.on(signal, fn);
      }
      child.once('error', () => { clear(); reject(new UserError('Unable to launch Node. Check the executable and permissions.', 126)); });
      child.once('close', (exitCode, signal) => { clear(); resolve({ exitCode, signal }); });
    });
    // Bounded drain, not an indefinite wait for children or daemon processes.
    if (config.children && drain) await new Promise(resolve => setTimeout(resolve, drain));
    let trace: Trace;
    try { trace = collectTrace(config, result); }
    catch {
      // An internal collection failure must not overwrite a completed application's outcome.
      const notices: Notice[] = ['capture_unverified', 'recorder_failed'];
      trace = {
        schemaVersion: SCHEMA_VERSION, toolVersion: TOOL_VERSION, id: config.runId,
        comparison: { domainId: config.comparison.domainId, mode: 'hmac-sha256' },
        capture: { status: 'failed', watch, caseMode: process.platform === 'win32' ? 'insensitive' : 'sensitive',
          maxEventsPerProcess: maxEvents, notices },
        result, processes: [], events: [], coverage: coverageFor(notices), exported: false,
      };
    }
    let artifactWritten = true;
    try { writeTrace(out, trace); }
    catch {
      artifactWritten = false; trace.capture.status = 'failed';
      trace.capture.notices = [...new Set([...trace.capture.notices, 'recorder_failed' as const])];
    }
    return { trace, ...result, artifactWritten };
  } finally {
    // Includes the ephemeral session secret. User-supplied pair-key files are never deleted.
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* restrictive temp directory; OS cleanup may be needed */ }
  }
}
