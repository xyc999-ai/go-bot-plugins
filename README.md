# Go Bot plugins

[English](README.md) · [简体中文](README.zh-CN.md)

Reviewed business plugins for [Go Bot](https://github.com/xyc999-ai/go-bot).
Plugin releases, display resources and the market catalog are published here,
independently of the Controller and Host images.

| Plugin | Capability |
| --- | --- |
| agent-browser | Browser automation and original upstream Skill |
| officecli | Word, PowerPoint and Excel workflows with upstream Skills |
| x | X tools through the official CLI/MCP integration |
| google-workspace | Gmail, Drive, Calendar and document workflows through gws |
| gemini-api | Google's native API CLI and its original agent instructions |

## Use

Open **Plugin market** in Go Bot. Install a plugin, enable it, and complete its
declared authorization flow if required. Users do not need a GitHub or npm token
for these public releases. Their account credentials stay in their own Host.

Go Bot reads [catalog.json](catalog.json), installs a selected release with pnpm,
and loads the installed package through its shared Cordis runtime. Existing
installations keep their selected versions; a new release offers an update.

## Develop

Requires Node.js 24.9+; release packaging also needs Docker.

```bash
npm --prefix plugins/x ci --ignore-scripts
npm --prefix plugins/gemini-api ci --ignore-scripts
npm test
npm run check
```

Each `plugins/<id>/` contains a standard `package.json`, a `plugin.json` display
manifest, business code, optional resources and an installation script. Use
`package.json` lifecycle scripts to install dependencies. Cordis activation only
checks prerequisites and registers capabilities; disabling never uninstalls CLIs.
Host services are documented in the main repository's
[plugin SDK](https://github.com/xyc999-ai/go-bot/tree/main/extensions/sdk).

Keep framework modules such as Cordis and the Host SDK out of production
dependencies. The Host provides them; TypeScript projects can use development
dependencies and optional peer declarations for types.

## Publish

1. Change the plugin and bump both manifest versions. Run the checks above.
2. In GitHub Actions, run **Publish plugins** on `main`, choosing a plugin or `all`.
3. The workflow prepares original upstream Skills in an isolated container,
   runs `npm pack`, and uploads a complete `<plugin>-v<version>` GitHub Release.
4. Only after the release assets exist does it update `catalog.json`, preserving
   older releases. Refresh the market to see the newly published version.

Do not modify executable packages or assets in an already published release.
Publish a new version. If upload succeeded but the catalog update failed, retry
the workflow; it checks the completed release before adding the catalog entry.

Local packaging preview (does not publish or modify the market):

```bash
docker buildx build -f build/Dockerfile.pack \
  --build-arg PLUGIN=all --output type=local,dest=out .
```

`out/<plugin>/` contains the standard tarball, icon/tutorial resources and a
generated `release.json`. Generated packages and upstream Skill copies are
ignored by Git. Display copy comes from `plugin.json`; do not maintain a second
handwritten market description.

## License

MIT. Each plugin includes upstream licenses and third-party notices. Original
upstream Skills and assets retain their respective notices.

A maintainer can also publish all packages by pushing an explicit batch-release tag, e.g. `git tag plugins-release-20261126 && git push origin plugins-release-20261126`. Ordinary commits do not publish packages.
