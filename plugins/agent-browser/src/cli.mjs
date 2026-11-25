import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
export async function run(binary, args, options = {}) {
  return exec(binary, args, { encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 2 << 20, ...options })
}
export async function ensureCLI(command, packageName, version, force = false) {
  let present
  try { present = (await run(command, ['--version'])).stdout.trim() }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!force && present !== undefined && new RegExp('(^|[^0-9])' + version.replaceAll('.', '\\.') + '([^0-9]|$)').test(present)) return
  // This function runs only during explicit package installation/reinstallation.
  // Reinstall the locked dependency when an external update changed its version.
  await run('npm', ['install', '-g', '--no-audit', '--no-fund', `${packageName}@${version}`])
  const actual = (await run(command, ['--version'])).stdout.trim()
  if (!actual.includes(version)) throw new Error(`${command} did not install the required version ${version}: ${actual}`)
}

export async function verifyCLI(command, version) {
  try {
    const value = (await run(command, ['--version'])).stdout.trim()
    if (!new RegExp('(^|[^0-9])' + version.replaceAll('.', '\\.') + '([^0-9]|$)').test(value)) throw new Error(`Expected ${command} ${version}, got ${value}`)
  } catch (error) {
    throw new Error(`${command} is not ready. Reinstall the plugin to prepare its dependencies. ${error.message}`)
  }
}
