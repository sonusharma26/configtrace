# Security and responsible use

This is an unvalidated source implementation, not a security-reviewed release. Do not use it to justify posting environment dumps or granting agents unrestricted filesystem access.

## Intended boundary

ConfigProof fingerprints selected raw values before its own evidence persistence. Exports transform tokens/metadata for deliberate sharing. HTML and MCP avoid exposing value fingerprints, and MCP accepts only startup-authorized trace aliases. The MCP tool catalog has no launcher, shell, arbitrary file discovery, key-reading or write capability.

## Explicit non-guarantees

It does not sanitize application stdout/stderr, isolate secrets from application-privileged code, authenticate evidence producers, securely erase JavaScript strings, fully intercept native/earlier references, serialize shared Worker mutations, or prove that arbitrary metadata is nonsensitive. A local adapter has the application's privileges and can bypass all intended recording boundaries. Do not load untrusted adapters.

Input regular-file/size/schema checks, output exclusive creation, bounded capture, CSP and metadata escaping are defense-in-depth, not a sandbox or proof of safety. Same-user filesystem races and hostile applications remain outside the protection claim. Do not expose the stdio server through an unauthenticated bridge. Review even explicitly authorized artifacts for sensitive metadata and prompt-injection text. Tool annotations do not substitute for authorization.

Artifacts are unsigned. Package integrity metadata does not provide authorship authentication or tamper-proof runtime evidence.

## Reporting concerns

No public maintainer address has been configured in this private source package. Use the repository owner's private security channel once one is established. Do not post real values, comparison keys, raw session configuration, or application log dumps in a public issue. Start with a synthetic minimal reproduction and reviewed exports.

Before deployment, follow the checks in docs/VALIDATION.md and review docs/PRIVACY.md. Local type-checking, compilation, and automated tests have passed; a broader security audit, canary run, and cross-platform validation remain pending.
