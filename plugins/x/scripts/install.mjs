import { nativeDirectory } from '../src/native-cli.mjs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
await nativeDirectory('x',path.join(process.env.HOME||'/root','.xurl'))
execFileSync('npm', ['install', '-g', '@xdevplatform/xurl'], { stdio: 'inherit' })
execFileSync('xurl', ['--version'], { stdio: 'inherit' })
