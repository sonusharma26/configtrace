# Security policy

ConfigTrace 0.2.0 in this archive is an **unbuilt, untested source implementation**, not an audited release. Do not begin validation with production credentials or deploy it as an always-on production agent.

## Report a vulnerability

A public repository and maintainer security contact have not yet been configured. Before publishing, the maintainer must enable an appropriate private vulnerability-reporting channel and replace this section with real contact details. No invented email address or unconfigured GitHub security URL is supplied.

Do not post real traces, key files, environment values or exploit reproductions containing secrets in a public issue. Use a minimal synthetic reproduction. Rotate any accidentally disclosed credentials through their actual provider.

For a private report, include the exact Node/OS/package versions, the affected component, a synthetic reproduction, expected versus actual behavior, and whether the issue affects confidentiality, application semantics, artifact integrity or resource bounds.

## Trust boundaries

The recorder is designed to mask values before persistence. The launched application and explicit local adapters run with the user's privileges and can access secrets or alter instrumentation. ConfigTrace is not a sandbox or tamper-proof audit log.

Application stdout/stderr, dotenv debug logs, memory dumps, shell history and operating-system process information are not sanitized. Temporary session files contain a comparison secret under restricted file permissions and can survive abnormal termination. Export policies reduce metadata rather than guarantee anonymity.

Treat received JSON artifacts as untrusted inputs and their observations as claims. Use the supplied strict-reader APIs, keep dependencies current after review, and never load adapters named by a trace. HTML reports have no intended network dependencies but have not undergone browser/security validation in this delivery.

See [privacy model](docs/PRIVACY.md), [compatibility boundaries](docs/COMPATIBILITY.md) and [pending validation](docs/VALIDATION.md).

## Priority security regressions

A raw value or comparison key in recorder artifacts is a blocker. So are misleading complete/provenance claims, script injection, unbounded parsing, silent overwriting of private files, application behavior changes caused by a hook, and undocumented bypass paths presented as covered. Preserve failing synthetic cases as regression fixtures.
