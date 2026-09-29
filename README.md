# ConfigProof

[![npm version](https://img.shields.io/npm/v/configproof.svg)](https://www.npmjs.com/package/configproof)
[![license](https://img.shields.io/npm/l/configproof.svg)](LICENSE)
[![Node.js validation](https://github.com/sonusharma26/configtrace/actions/workflows/validate.yml/badge.svg)](https://github.com/sonusharma26/configtrace/actions/workflows/validate.yml)

Understand where your Node.js configuration came from, where it was read, and why two runs behaved differently—without printing the underlying values.

ConfigProof is a local-first debugging tool for environment-based configuration. It records evidence for only the keys you select, then lets you explain a key, compare runs, diagnose differences, verify configuration rules, and create an offline report.

## Why ConfigProof?

Configuration bugs often look like application bugs:

- The same build works locally but fails in another environment.
- A `.env` file loads, but the application reads an older value.
- A required variable exists at startup and changes later.
- A Worker or child process sees different configuration.
- Two deployments appear identical, but read different settings.

ConfigProof helps answer:

- Was this key present when the application started?
- Was it loaded from a supported environment file?
- Where did the application read it?
- Did it change during the run?
- What differs between a failing run and a working run?

## Features

- **Focused tracing** — watch specific keys or patterns instead of dumping the environment.
- **Safe evidence** — captured artifacts and reports do not contain the selected raw values.
- **Source clues** — observe supported `dotenv` and Node.js environment-file loading.
- **Run comparison** — compare failing and working runs without exposing their values.
- **Guided diagnosis** — rank relevant configuration differences with supporting evidence.
- **Configuration checks** — verify required, forbidden, immutable, and source-related rules in CI.
- **Offline reports** — generate a self-contained HTML report with no hosted service or telemetry.
- **Process coverage** — optionally trace supported Node.js Workers and direct child processes.
- **Library and agent access** — use the JavaScript API or expose reviewed traces through a read-only MCP server.

## Requirements

- Node.js `22.14+` within the 22.x line, or Node.js 24.x
- A direct CommonJS or ESM Node.js entry point

ConfigProof launches Node directly. If your application normally starts with `npm start`, use the underlying command, such as `node server.js`, after `--`.

## Installation

Install ConfigProof as a development dependency:

```sh
npm install --save-dev configproof
```

Run it with `npx configproof`. You can also install it globally with `npm install --global configproof` and use `configproof` directly. The previous `configtrace` command remains available as a compatibility alias.

## Quick start

Capture how your application uses selected configuration keys:

```sh
npx configproof run --watch DATABASE_URL,API_URL --out .configtrace/run.ct.json -- node app.js
```

Explain one key:

```sh
npx configproof explain DATABASE_URL --from .configtrace/run.ct.json
```

Create an offline report:

```sh
npx configproof report .configtrace/run.ct.json --out .configtrace/report.html
```

ConfigProof creates new output files and will not overwrite existing ones. Add `.configtrace/` to your application's `.gitignore` and keep trace artifacts private unless you have reviewed them for sharing.

## Compare a failing run with a working run

Create a private comparison key once:

```sh
npx configproof keygen --out .configtrace/pair.key.json
```

Capture the failing run:

```sh
npx configproof run --watch DATABASE_URL,API_URL --key .configtrace/pair.key.json --out .configtrace/broken.ct.json -- node app.js
```

Correct the launch environment or configuration, then capture the working run with the same comparison key:

```sh
npx configproof run --watch DATABASE_URL,API_URL --key .configtrace/pair.key.json --out .configtrace/working.ct.json -- node app.js
```

Compare and diagnose the runs:

```sh
npx configproof diff .configtrace/broken.ct.json .configtrace/working.ct.json
npx configproof diagnose .configtrace/broken.ct.json .configtrace/working.ct.json
npx configproof report .configtrace/broken.ct.json .configtrace/working.ct.json --out .configtrace/comparison.html
```

Do not commit or share `pair.key.json`. ConfigProof needs the same private key to compare protected value identities across two runs.

## Watch patterns and process options

Use `*` and `?` to select groups of keys. Quote patterns so your shell does not expand them:

```sh
npx configproof run --watch "DB_*,API_URL" --workers --children --source-maps --out .configtrace/run.ct.json -- node app.js
```

Worker and child-process tracing are opt-in. ConfigProof reports incomplete coverage instead of pretending an unsupported process was observed.

## Verify configuration rules

Create a policy file such as `configtrace-policy.yaml`:

```yaml
version: 1
coverage:
  requireComplete: true
rules:
  DATABASE_URL:
    required: true
    read: required
    immutableAfterFirstRead: true
  LEGACY_API_KEY:
    missing: true
    read: forbidden
```

Run the check:

```sh
npx configproof verify .configtrace/run.ct.json --policy configtrace-policy.yaml
```

The command exits with `0` when checks pass, `2` for a verified violation, and `3` when the available evidence is incomplete or inconclusive. This makes it suitable for CI without treating missing evidence as a pass.

## Common commands

| Command | What it does |
|---|---|
| `run` | Capture selected configuration activity while a Node.js application runs. |
| `explain` | Show the available source and read evidence for one key. |
| `diff` | Compare configuration behavior across two captures. |
| `diagnose` | Rank differences that may be relevant to a failing run. |
| `verify` | Check a capture against a YAML configuration policy. |
| `report` | Create a private, offline HTML report. |
| `doctor` | Check capture completeness and observation boundaries. |
| `history` | Store and compare an explicitly ordered series of local captures. |
| `export` | Create a reduced artifact for review before sharing. |

Run `npx configproof --help` for every command and option.

## Use ConfigProof as a library

```js
const {
  readTrace,
  buildProvenance,
  diagnoseTraces,
  verifyTrace
} = require('configproof');

const broken = readTrace('.configtrace/broken.ct.json');
const working = readTrace('.configtrace/working.ct.json');

const graph = buildProvenance(broken, { key: 'DATABASE_URL' });
const diagnosis = diagnoseTraces(broken, working, { limit: 5 });
const verification = verifyTrace(broken, {
  rules: {
    DATABASE_URL: {
      required: true,
      immutableAfterFirstRead: true
    }
  }
});
```

TypeScript declarations are included with the package.

## Read-only MCP access

ConfigProof can expose explicitly selected trace files to compatible coding tools through a local, read-only MCP server:

```sh
npx configproof mcp --trace broken=/absolute/path/broken.ct.json --trace working=/absolute/path/working.ct.json
```

The server can explain and compare authorized traces. It cannot discover arbitrary files, run shell commands, launch applications, or return raw configuration values. See [the MCP example](examples/mcp/stdio-server.json) for a generic process definition.

## Privacy and safety

ConfigProof is local-first: it has no telemetry, upload service, or remote assets in generated reports.

Captured values are protected, but metadata can still be sensitive. Key names, paths, timestamps, source labels, and application output may reveal information about your system. ConfigProof does not sanitize your application's stdout or stderr. Review every artifact or export before sharing it.

ConfigProof provides evidence for debugging; it does not change your configuration or prove a single root cause automatically.

Read the [privacy model](docs/PRIVACY.md) and [architecture overview](docs/ARCHITECTURE.md) for deeper technical detail.

## Support and contributing

- Report bugs or request features through [GitHub Issues](https://github.com/sonusharma26/configtrace/issues).
- See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.
- Review [SECURITY.md](SECURITY.md) for security-reporting guidance.

## License

[MIT](LICENSE)
