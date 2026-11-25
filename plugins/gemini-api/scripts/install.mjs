import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// Dependency setup belongs to pnpm installation, never Cordis apply/dispose.
const directory = await mkdtemp(path.join(tmpdir(), 'go-bot-gemini-install-'))
try {
  const file = path.join(directory, 'install.sh')
  execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--connect-timeout', '15', '--max-time', '120',
    'https://raw.githubusercontent.com/google-gemini/gemini-api-cli/main/scripts/install.sh', '--output', file], { stdio: 'inherit' })
  const env = { ...process.env }
  delete env.GEMINI_VERSION
  delete env.GEMINI_INSTALL_DIR
  // Default official release and install location; no user credential is needed.
  execFileSync('bash', [file], { stdio: 'inherit', env, timeout: 8 * 60_000 })
  execFileSync('gemini-api', ['--version'], { stdio: 'inherit', timeout: 15_000 })
  execFileSync('gemini-api', ['--help'], { stdio: 'ignore', timeout: 15_000 })
} finally {
  await rm(directory, { recursive: true, force: true })
}
