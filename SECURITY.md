# Security policy

ConfigTrace 0.2.0 has passed its local Node 24 build, focused tests, synthetic CLI workflow, package-content check, and dependency audit. It has not received an independent security audit or broad production validation. Start with synthetic values and do not deploy it as an always-on production agent without validating it for your environment.

## Report a vulnerability

Use the repository's private [GitHub Security Advisory form](https://github.com/sonusharma26/configtrace/security/advisories/new) when private vulnerability reporting is available. If that form is unavailable, contact the maintainer privately through their GitHub profile before sending sensitive details. Do not open a public issue containing an undisclosed vulnerability or secret-bearing artifact.

Do not post real traces, key files, environment values or exploit reproductions containing secrets in a public issue. Use a minimal synthetic reproduction. Rotate any accidentally disclosed credentials through their actual provider.

For a private report, include the exact Node/OS/package versions, the affected component, a synthetic reproduction, expected versus actual behavior, and whether the issue affects confidentiality, application semantics, artifact integrity or resource bounds.

## Trust boundaries

The recorder is designed to mask values before persistence. The launched application and explicit local adapters run with the user's privileges and can access secrets or alter instrumentation. ConfigTrace is not a sandbox or tamper-proof audit log.

Application stdout/stderr, dotenv debug logs, memory dumps, shell history and operating-system process information are not sanitized. Temporary session files contain a comparison secret under restricted file permissions and can survive abnormal termination. Export policies reduce metadata rather than guarantee anonymity.

Treat received JSON artifacts as untrusted inputs and their observations as claims. Use the supplied strict-reader APIs, keep dependencies current after review, and never load adapters named by a trace. HTML reports have no intended network dependencies but have not undergone browser/security validation in this delivery.

See [privacy model](docs/PRIVACY.md), [compatibility boundaries](docs/COMPATIBILITY.md) and [pending validation](docs/VALIDATION.md).

## Priority security regressions

A raw value or comparison key in recorder artifacts is a blocker. So are misleading complete/provenance claims, script injection, unbounded parsing, silent overwriting of private files, application behavior changes caused by a hook, and undocumented bypass paths presented as covered. Preserve failing synthetic cases as regression fixtures.
