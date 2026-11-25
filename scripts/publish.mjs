import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { root, repository, pluginIds, readJSON, mergeCatalog } from './catalog.mjs'

const [selected = 'all', output = join(root, 'out')] = process.argv.slice(2)
const ids = selected === 'all' ? pluginIds : [selected]
if (ids.some(id => !pluginIds.includes(id))) throw new Error('Unknown plugin')
const releases = await Promise.all(ids.map(id => readJSON(join(output, id, 'release.json'))))
const previous = await readJSON(join(root, 'catalog.json'))
const next = mergeCatalog(previous, releases)
for (const entry of releases) {
  const tag = entry.pluginId + '-v' + entry.version
  // Release files are completed before the public catalog is changed. Existing
  // releases are never edited; matching completed releases allow a failed
  // catalog publication to be retried without replacing executable packages.
  let existing
  try { existing = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'assets'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch {}
  const files = (await readdir(join(output, entry.pluginId))).map(name => join(output, entry.pluginId, name))
  if (existing) {
    const asset = existing.assets.find(value => value.name === 'release.json')
    if (!asset) throw new Error(tag + ': incomplete existing release; inspect it before retrying')
    const remote = await fetch(entry.assetBase + 'release.json')
    if (!remote.ok || JSON.stringify(await remote.json()) !== JSON.stringify(entry)) throw new Error(tag + ': existing release differs; bump the plugin version')
    if (files.some(file => !existing.assets.some(asset => asset.name === file.split('/').at(-1)))) throw new Error(tag + ': existing release is missing assets')
    continue
  }
  execFileSync('gh', ['release', 'create', tag, '--repo', repository, '--target', process.env.GITHUB_SHA ?? 'main', '--title', entry.name + ' ' + entry.version, '--notes', 'Reviewed Go Bot plugin package and display resources.', ...files], { stdio: 'inherit' })
}
await writeFile(join(root, 'catalog.json'), JSON.stringify(next, null, 2) + '\n')
console.log('Release assets published; catalog.json is ready to commit.')
