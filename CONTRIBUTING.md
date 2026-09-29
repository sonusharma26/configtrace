# Contributing

Keep ConfigProof local-first and evidence-driven. Existing runtime hooks must not be assumed transparent: new adapters and context support need independent fixtures and instrumented/uninstrumented behavior comparisons.

Use TypeScript in the existing module boundaries. Reuse the recorder's fingerprint boundary, never serialize raw values, and avoid logging parser/application exception payloads. Keep observed/derived/inferred/unknown distinctions. Do not infer source provenance merely from static file availability or matching timestamps.

Every new capability should include a bounded implementation, documented bypasses, focused synthetic test sources, and acceptance evidence when actually run. An adapter manifest is a declaration, not a compatibility certificate. Mark node-config/convict/NestJS support installed only after implementing the corresponding runtime observation paths.

Builds and tests are separate opt-in maintainer commands. This delivery ran none; do not turn generated test sources into passing claims. Follow docs/VALIDATION.md before claiming a fix or release. Do not upload comparison keys or raw application logs.

Preserve backward read compatibility deliberately when changing schemas. New capture uses configtrace/2; provenance/diagnosis/contracts/history APIs carry separate schema labels. For agent APIs, keep explicit artifact authorization and token-free projections; never add an implicit shell or environment dump tool.
