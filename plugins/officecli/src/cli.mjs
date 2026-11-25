import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
export async function run(binary, args, options = {}) {
  return exec(binary, args, { encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 2 << 20, ...options })
}
export async function verifyCLI(command) {
  try {
    const value = (await run(command, ['--version'])).stdout.trim()
    if (!value) throw new Error(`${command} did not report its version`)
  } catch (error) {
    throw new Error(`${command} is not ready. Reinstall the plugin to prepare its dependencies. ${error.message}`)
  }
}
