# ConfigTrace

Find out why a Node.js application is using the wrong environment configuration - without printing secret values.

ConfigTrace runs alongside your application and records how selected environment keys are used. It can explain where a value was first observed, show whether a `.env` candidate was applied or skipped, and compare a failing run with a working run.

It runs locally, has no telemetry, and does not send your configuration anywhere.

## What is this package for?

Configuration problems are often difficult to diagnose because the value an application uses may not be the value you expect. A shell, process manager, deployment platform, `.env` file, test runner, or startup script may have supplied or replaced it earlier.

ConfigTrace helps answer questions such as:

- Why is my application connecting to the old database?
- Did `dotenv` load the value I expected, or skip it because one already existed?
- Is a key missing, empty, deleted, or overwritten at runtime?
- What changed between a working run and a failing run?
- Which configuration keys did this Node.js process actually read?
- Can I share useful diagnostic evidence without sharing the raw values?

## Common use cases

- Debug differences between local, CI, staging, and production-like environments.
- Investigate stale variables inherited from a terminal, IDE, service, or process manager.
- Compare two executions after a deployment or configuration change.
- Produce an offline HTML report for a teammate or support ticket.
- Add focused configuration diagnostics to a Node.js troubleshooting workflow.

ConfigTrace is a debugging aid. It is not a secrets manager, sandbox, compliance audit log, or universal tracer.

## Requirements

- Node.js `22.14+` within Node 22, or Node 24.
- A Node.js application started with the `node` executable.

## Install

Install it in a project:

```sh
npm install --save-dev configtrace
```

Then run it with `npx configtrace`. You can also install it globally:

```sh
npm install --global configtrace
```

## Try the safe demo

The demo uses synthetic values and creates a failing run, a corrected run, and an offline comparison report:

```sh
npx configtrace demo stale-env --out configtrace-demo
```

Open `configtrace-demo/comparison.html` in a browser. Do not share the entire demo directory because it also contains a private comparison key.

## Trace an application

Choose only the keys you need to investigate:

```sh
npx configtrace run \
  --watch DATABASE_URL,API_URL \
  --out run.ct.json \
  -- node app.js
```

ConfigTrace launches the application normally. Application output and exit behavior remain visible. The trace records masked evidence for the watched keys; it does not intentionally store their raw values.

Explain one key:

```sh
npx configtrace explain DATABASE_URL --from run.ct.json
```

Create an offline report:

```sh
npx configtrace report run.ct.json --out report.html
```

Output files are never overwritten. Choose a new filename for each run.

## Compare a broken run with a working run

Create a private comparison key once for the pair:

```sh
npx configtrace keygen --out pair.key.json
```

Capture both runs with that key:

```sh
npx configtrace run --watch DATABASE_URL --key pair.key.json --out broken.ct.json -- node app.js
npx configtrace run --watch DATABASE_URL --key pair.key.json --out working.ct.json -- node app.js
```

Compare them:

```sh
npx configtrace diff broken.ct.json working.ct.json
```

Keep `pair.key.json` private. Do not commit it or attach it to an issue.

## Main commands

| Command | Purpose |
| --- | --- |
| `run` | Launch a Node.js application and record selected configuration evidence. |
| `explain` | Explain the observed history of one key. |
| `diff` | Compare a failing and working trace. |
| `report` | Create a self-contained offline HTML report. |
| `export` | Create a reduced copy for review or sharing. |
| `doctor` | Summarize what the capture could and could not observe. |
| `demo stale-env` | Run the included synthetic example. |

Run `npx configtrace --help` for all options.

## Use it as a library

ConfigTrace also exposes its launcher, trace reader, comparison helpers, report renderer, and export helpers:

```js
const { run } = require('configtrace');

async function capture() {
  const result = await run({
    command: [process.execPath, 'app.js'],
    watch: ['DATABASE_URL'],
    out: 'run.ct.json'
  });

  console.log(result.trace.capture.status);
}

capture().catch(console.error);
```

See the generated TypeScript declarations for the full API.

## Privacy and safety

- Watched values are masked before trace events are written.
- ConfigTrace has no runtime telemetry or hosted service.
- Application stdout and stderr are not sanitized. Your application can still print secrets.
- Trace metadata such as key names, filenames, timing, and process structure may still be sensitive.
- Native code, earlier startup hooks, worker threads, and saved references can be outside the captured view.
- A complete trace means the recorded streams completed; it does not mean every possible access was observed.

Review every artifact before sharing it. For the detailed trust model, see [Privacy](docs/PRIVACY.md) and [Security](SECURITY.md).

## More documentation

- [Compatibility and known boundaries](docs/COMPATIBILITY.md)
- [Validation guide](docs/VALIDATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)

## Project status

Version `0.2.0` has passed local dependency, type-check, build, focused test, CLI workflow, package-content, and source-map checks on Windows with Node 24.19.0. Node 22, cross-platform, browser, performance, and broader real-world validation remain pending.

## License

MIT
