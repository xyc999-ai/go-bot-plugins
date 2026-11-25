import { run } from '../src/cli.mjs'
import { verify } from '../src/prepare.mjs'
// Standard lifecycle installation. Cordis apply/dispose never installs software.
await run('npm', ['install', '-g', '@officecli/officecli'])
await verify()
