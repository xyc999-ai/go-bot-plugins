import { readFile, writeFile, mkdir, copyFile, readdir, stat } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const repository = 'xyc999-ai/got-bot-plugins'
export const pluginIds = ['agent-browser', 'officecli', 'x', 'google-workspace', 'gemini-api']
export const readJSON = async path => JSON.parse(await readFile(path, 'utf8'))

export async function metadata(id, directory = join(root, 'plugins', id)) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Invalid plugin ID')
  const pkg = await readJSON(join(directory, 'package.json')), display = await readJSON(join(directory, 'plugin.json'))
  if (pkg.name !== '@go-bot/plugin-' + id || display.version !== pkg.version || display.license !== pkg.license || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error(id + ': inconsistent package identity/version/license')
  if (!display.name || !display.description?.en || !display.description?.['zh-CN'] || !display.maintainer || pkg.goBot?.api !== '1') throw new Error(id + ': missing display or API metadata')
  for (const framework of ['@deepseek-ai/cordis', '@go-bot/plugin-sdk']) if (pkg.dependencies?.[framework]) throw new Error(id + ': framework modules must be optional peers, not production dependencies')
  const resources = [display.icon, ...(display.tutorials ?? []).flatMap(t => [t.video, ...(t.poster ? [t.poster] : [])])]
  const prefix = '/assets/plugins/' + id + '/'
  for (const resource of resources) {
    if (!resource.startsWith(prefix) || !/^[\w.-]+$/.test(resource.slice(prefix.length))) throw new Error(id + ': invalid asset path')
    if (!(await stat(join(directory, 'assets', resource.slice(prefix.length)))).isFile()) throw new Error(id + ': missing resource')
  }
  for (const name of ['LICENSE', 'UPSTREAM_LICENSE', 'THIRD_PARTY_NOTICES.md']) await stat(join(directory, name))
  const base = `https://github.com/${repository}/releases/download/${id}-v${pkg.version}/`
  const archive = pkg.name.replace(/^@/, '').replace('/', '-') + '-' + pkg.version + '.tgz'
  return {
    pluginId: id, package: pkg.name, ...display,
    source: { type: 'tarball', spec: base + archive }, assetBase: base,
    builds: [pkg.name], ...(['agent-browser', 'officecli'].includes(id) ? { defaultEnabled: true } : {}),
  }
}

export function mergeCatalog(previous, entries) {
  const result = structuredClone(previous)
  for (const entry of entries) {
    const existing = result.find(row => row.pluginId === entry.pluginId && row.version === entry.version)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(entry)) throw new Error('Published release metadata is immutable: ' + entry.pluginId + '@' + entry.version)
    } else result.push(entry)
  }
  return result
}

export async function pack(id, out = join(root, 'out')) {
  const entry = await metadata(id), directory = join(root, 'plugins', id)
  if (['agent-browser', 'officecli', 'google-workspace'].includes(id)) {
    const skill = { 'agent-browser': 'agent-browser', officecli: 'officecli', 'google-workspace': 'gws-shared' }[id]
    await stat(join(directory, 'skills', skill, 'SKILL.md'))
  }
  const destination = join(out, id)
  await mkdir(destination, { recursive: true })
  const output = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: directory, encoding: 'utf8', maxBuffer: 4 << 20 }))
  if (output.length !== 1 || output[0].filename !== basename(entry.source.spec)) throw new Error('Unexpected package archive')
  for (const name of await readdir(join(directory, 'assets'))) if ((await stat(join(directory, 'assets', name))).isFile()) await copyFile(join(directory, 'assets', name), join(destination, name))
  await writeFile(join(destination, 'release.json'), JSON.stringify(entry, null, 2) + '\n')
  return entry
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'check', id = 'all', out] = process.argv.slice(2)
  const ids = id === 'all' ? pluginIds : [id]
  if (ids.some(value => !pluginIds.includes(value))) throw new Error('Unknown plugin')
  if (command === 'check') {
    const releases = await Promise.all(ids.map(value => metadata(value)))
    mergeCatalog(await readJSON(join(root, 'catalog.json')), releases)
    console.log('Plugin manifests, assets, licenses and release identities: OK')
  } else if (command === 'pack') {
    for (const value of ids) await pack(value, out ? resolve(out) : undefined)
  } else throw new Error('Usage: node scripts/catalog.mjs check|pack [all|plugin-id] [output-directory]')
}
