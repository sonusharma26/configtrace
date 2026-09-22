# Publishing ConfigTrace

ConfigTrace publishes to the public npm registry from GitHub Actions using npm trusted publishing. The release workflow uses short-lived OpenID Connect (OIDC) credentials, so the repository does not need a long-lived npm write token.

## One-time first publication

The `configtrace` name currently appears unused, but npm names are only reserved by a successful publication. npm requires a package to exist before a trusted publisher can be attached to it.

For version `0.2.0`, a maintainer with npm two-factor authentication must therefore perform the first publication from a clean checkout. Authenticate interactively with `npm login`, then run:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm publish --access public
```

Review the output of `npm pack --dry-run --ignore-scripts` immediately before publishing. Do not place an npm token in this repository or commit an `.npmrc` containing credentials.

## Connect npm to GitHub

After the first version exists on npm:

1. Open the `configtrace` package settings on npmjs.com.
2. Add a GitHub Actions trusted publisher.
3. Set the GitHub user or organization to `sonusharma26`.
4. Set the repository to `configtrace`.
5. Set the workflow filename to `publish.yml`.
6. Allow direct `npm publish` for this workflow.
7. Require two-factor authentication and disallow traditional write tokens after the trusted publisher is verified.

The trusted publisher values must match exactly. The workflow is at `.github/workflows/publish.yml`, uses a GitHub-hosted runner, and grants only `contents: read` and `id-token: write`.

## Publish later versions

1. Update `version` in `package.json` and `package-lock.json`.
2. Update `CHANGELOG.md`.
3. Run the local validation suite.
4. Commit and push the release changes.
5. Create a GitHub release whose tag exactly matches `v` plus the package version, such as `v0.2.1`.

Publishing the GitHub release triggers `publish.yml`. The workflow refuses to publish when the release tag and package version differ, installs only the locked dependencies with lifecycle scripts disabled, and runs type checking, build, and tests before `npm publish`.

Do not reuse an npm version. If publication fails after the version has been accepted by npm, increment the version before trying again.
