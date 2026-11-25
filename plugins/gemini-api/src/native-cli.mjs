import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, lstat, readFile, open, rename, rm, chmod } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { parse, stringify } from 'yaml'

const exec = promisify(execFile)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export function configFile() {
  return path.join(process.env.HOME || '/root', '.config', 'gemini-api', 'config.yaml')
}
export async function readConfig(file = configFile()) {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.size > 1 << 20) throw new Error()
    const value = parse(await readFile(file, 'utf8'), { maxAliasCount: 50 })
    if (!isObject(value) || (value.security !== undefined && !isObject(value.security))) throw new Error()
    return value
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error('Could not read the Gemini API CLI configuration. Repair config.yaml and try again.')
  }
}
export async function writeConfig(value, file = configFile()) {
  const directory = path.dirname(file)
  const temporary = path.join(directory, '.config-' + randomUUID())
  let handle
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(stringify(value))
    await handle.close(); handle = undefined
    await rename(temporary, file)
  } catch {
    throw new Error('Could not save the Gemini API CLI configuration. Check the Host filesystem and try again.')
  } finally {
    await handle?.close()
    await rm(temporary, { force: true })
  }
}
export async function verifyCLI(signal) {
  try {
    const { stdout } = await exec('gemini-api', ['--version'], { signal, timeout: 15_000, maxBuffer: 128 << 10 })
    if (!stdout.trim()) throw new Error()
  } catch {
    signal?.throwIfAborted()
    throw new Error('Gemini API CLI is not ready. Reinstall the plugin to prepare the official CLI.')
  }
}
function failure(error) {
  const diagnostic = String(error.stderr || '') + '\n' + String(error.stdout || '')
  if (/\b429\b|RESOURCE_EXHAUSTED|rate.limit/i.test(diagnostic)) return 'Google rate limited the request. Wait and try again.'
  if (/\b403\b|PERMISSION_DENIED|SERVICE_DISABLED/i.test(diagnostic)) return 'Google denied access. Check your Gemini project, API key permissions and regional availability.'
  if (/\b401\b|UNAUTHENTICATED|API_KEY_INVALID|API key not valid|invalid.api.key/i.test(diagnostic) || error.code === 3) return 'Google rejected the API key. Check it in Google AI Studio and try again.'
  if (/ENOTFOUND|ECONN|ETIMEDOUT|network|dial tcp|TLS|timeout|timed out|no such host/i.test(diagnostic) || error.killed) return 'Could not reach the Gemini API. Check the Host network and try again.'
  return 'Gemini API key verification failed. Check your Google project and try again.'
}
export async function validateKey(key, signal) {
  const env = { ...process.env }
  // A candidate must not inherit another Gemini credential or endpoint.
  for (const name of Object.keys(env)) if (name.startsWith('GEMINI_')) delete env[name]
  env.GEMINI_API_KEY = key
  let stdout
  try {
    ;({ stdout } = await exec('gemini-api', ['models', 'list', '--page-size', '1', '--output-format', 'json', '--no-keyring'], {
      env, signal, timeout: 30_000, maxBuffer: 512 << 10,
    }))
  } catch (error) {
    signal?.throwIfAborted()
    throw new Error(failure(error))
  }
  let result
  try { result = JSON.parse(stdout) } catch {}
  // Offline help/usage is not evidence of authenticated access.
  if (!isObject(result) || result.error || !Array.isArray(result.models)) {
    throw new Error('Gemini API CLI returned an unexpected model-list response. Reinstall the plugin and try again.')
  }
}
