# Performance validation

ConfigProof includes reproducible benchmark helpers for analysis, capture, and package size. Results are workload- and machine-specific; they are not universal performance guarantees.

## Release sanity sample

The 0.4.0 release candidate was built and measured on Windows x64 with Node.js 24.19.0. Each analysis scenario used one warm-up and five measured calls in isolated processes. The legacy and optimized implementations returned identical diagnosis hashes for every measured call.

| Events per trace | Keys | Legacy median | Optimized median | Observed ratio |
|---:|---:|---:|---:|---:|
| 1,000 | 8 | 4.52 ms | 3.13 ms | 1.44x |
| 10,000 | 16 | 43.31 ms | 31.12 ms | 1.39x |
| 50,000 | 32 | 284.00 ms | 188.78 ms | 1.50x |

In the same synthetic fixtures, compact JSON was approximately 31% smaller. Bounded HTML reports were approximately 85% smaller. Report size comparisons use the existing display limits and do not imply that every event is rendered in large reports.

A separate three-sample direct-Node capture check performed 1,000 reads across eight selected keys. Each traced run produced all 1,008 expected observations, reported complete capture, and contained no synthetic raw values. The check establishes basic completeness for that fixture, not general application overhead.

The npm dry run contained 104 files: 126,703 compressed bytes and 631,107 unpacked bytes, excluding installed dependencies.

## Reproducing the checks

Build first, then run a bounded analysis comparison:

```sh
npm run build
node bench/run.cjs --events 1000,10000,50000 --samples 5
```

Run a small synthetic capture comparison:

```sh
node bench/capture.cjs --reads 1000 --keys 8 --samples 3
```

Measure the npm allowlist:

```sh
npm run bench:package
```

The benchmark scripts use synthetic values. Keep generated results under `bench/results/`; that directory is ignored and is not published.

## Interpretation limits

- Analysis timings exclude fixture construction and CLI startup.
- Five analysis samples and three capture samples are release sanity checks, not statistical certification.
- Capture overhead depends heavily on application behavior, call-site collection, storage, and selected-key volume.
- HTML measurements apply to the bounded offline presentation, not a complete large-trace viewer.
- Memory readings include the Node.js process and fixture allocation.
- Results from different machines or Node.js versions should not be compared as if they were controlled experiments.
