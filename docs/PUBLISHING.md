# npm publishing

Tag pushes (`vX.Y.Z`) run build, unit tests, packing, and the isolated real-n8n smoke test. Only a successful test job permits npm publication. The publish job downloads that exact tested archive and publishes it with provenance. A GitHub Release is created only after npm publication succeeds. Branch and pull request builds never publish.

## One-time setup

The package must exist on npm before a trusted publisher can be configured. An npm package owner must sign in locally with `npm login`, complete any requested account verification, and publish the first tested archive once:

```sh
npm publish ./n8n-nodes-tiktok-gateway-0.1.2.tgz --access public --ignore-scripts
```

Then configure the trusted publisher in the package settings on npmjs.com:

- Provider: GitHub Actions
- Organization: `TikTok-Gateway`
- Repository: `n8n-nodes-tiktok-gateway`
- Workflow filename: `ci.yml`
- Environment: leave empty (the workflow does not use one)
- Allow direct `npm publish`

With npm 11.15+ and account 2FA enabled, the equivalent CLI command is:

```sh
npm trust github n8n-nodes-tiktok-gateway \
  --repo TikTok-Gateway/n8n-nodes-tiktok-gateway \
  --file ci.yml --allow-publish --yes
```

Complete any npm account verification in your own session. Do not commit `.npmrc` or tokens. The GitHub job uses OIDC (`id-token: write`) on a GitHub-hosted runner and npm 11.19.0; it does not use `NPM_TOKEN` or `NODE_AUTH_TOKEN`.

## Subsequent releases

Update the changelog and version/lockfile, commit, then push a matching tag. Use a new version after the initial local bootstrap publication; npm cannot overwrite an existing version.

```sh
npm version patch --no-git-tag-version
# Update CHANGELOG.md and commit the changes.
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

If publishing fails, inspect the npm publish job and verify the publisher configuration and tag/version match. Never disable tests or overwrite a published version to recover. A failed job before publication can be rerun; if the version is already published, verify it and release the next version instead.

References: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
