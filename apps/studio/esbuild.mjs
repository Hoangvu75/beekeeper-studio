#!/usr/bin/env node
import esbuild from 'esbuild';
import { spawn } from 'child_process'
import path from 'path';
import _ from 'lodash'
import fs from 'fs'

// NOTE: keep in sync with src/common/globals.ts -> plugins.ensureInstalled
const ensureInstalled = [
  "@beekeeperstudio/bks-ai-shell",
  "@beekeeperstudio/bks-er-diagram",
];

const isWatching = process.argv[2] === 'watch';

function consumeOpenUrlFromFile() {
  const openUrlFile = process.env.BKS_OPEN_URL_FILE
  if (!openUrlFile) return null
  try {
    const url = fs.readFileSync(openUrlFile, 'utf-8').trim()
    try {
      fs.unlinkSync(openUrlFile)
    } catch {
      // best effort cleanup
    }
    return url || null
  } catch (err) {
    console.warn('Unable to read BKS_OPEN_URL_FILE', err)
    return null
  }
}

function getElectronBinary() {
  const localWinLinux = process.platform === 'win32'
    ? path.resolve('../../node_modules/electron/dist/electron.exe')
    : path.resolve('../../node_modules/electron/dist/electron')
  const rootWinLinux = process.platform === 'win32'
    ? path.resolve('../../../../node_modules/electron/dist/electron.exe')
    : path.resolve('../../../../node_modules/electron/dist/electron')
  const localMac = path.resolve('../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const rootMac = path.resolve('../../../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')

  const candidates = process.platform === 'darwin'
    ? [localMac, rootMac]
    : [localWinLinux, rootWinLinux]

  const hit = candidates.find((file) => fs.existsSync(file))
  if (!hit) {
    throw new Error(`Electron binary not found. Checked: ${candidates.join(', ')}`)
  }
  return hit
}

let electronBin
try {
  electronBin = getElectronBinary()
  console.log("Path to electron: ", electronBin)
} catch (err) {
  console.error(err)
  throw new Error(err)
}

const externals = [
  'better-sqlite3', 'sqlite3',
  'sequelize', 'reflect-metadata',
  'cassandra-driver', 'mysql2', 'ssh2', 'mysql',
  'oracledb', '@electron/remote', "@google-cloud/bigquery",
  'pg-query-stream', 'electron', '@duckdb/node-api',
  '@mongosh/browser-runtime-electron', '@mongosh/service-provider-node-driver',
  'mongodb-client-encryption', 'sqlanywhere', 'ws', 'kerberos',
  ...ensureInstalled,
]

let electron = null
/** @type {Record<string, fs.FSWatcher>} */
const configWatchers = {}

const restartElectron = _.debounce(() => {
  if (electron) {
    process.kill(electron.pid, 'SIGINT')
  }

  const electronEnv = { ...process.env }
  delete electronEnv.ELECTRON_RUN_AS_NODE
  const openUrl = consumeOpenUrlFromFile()
  const electronArgs = openUrl ? ['.', openUrl] : ['.']
  electron = spawn(electronBin, electronArgs, { stdio: 'inherit', env: electronEnv })
  electron.on('error', (err) => {
    console.error('failed to spawn electron', err)
    process.exit(1)
  })
  electron.on('exit', (code, signal) => {
    console.log('electron exited', code, signal)
    if (!signal) process.exit()
  })
  console.log('spawned electron, pid: ', electron.pid)
}, 500)

function watchConfig(file) {
  if (configWatchers[file]) return
  const watcher = fs.watch(file, () => {
    console.log(`Detected change in ${file}, rebuilding...`);
    restartElectron()
  })
  configWatchers[file] = watcher
}

function getElectronPlugin(name, action = () => restartElectron()) {
  return {
    name: `${name}-plugin`,
    setup(build) {
      if (!isWatching) return
      build.onStart(() => console.log(`ESBUILD: Building ${name}`))
      build.onEnd(() => {
        console.log(`ESBUILD: Built ${name}`)
        action()
        watchConfig('default.config.ini')
        watchConfig('local.config.ini')
        watchConfig('system.config.ini')
      })
    }
  }
}

const env = isWatching ? '"development"' : '"production"';
const commonArgs = {
  platform: 'node',
  publicPath: '.',
  outdir: 'dist',
  bundle: true,
  external: [...externals, '*.woff', '*.woff2', '*.ttf', '*.svg', '*.png'],
  sourcemap: true,
  minify: false,
  define: {
    'process.env.NODE_ENV': env
  }
}

const mainArgs = {
  ...commonArgs,
  entryPoints: ['src-commercial/entrypoints/main.ts', 'src-commercial/entrypoints/utility.ts', 'src-commercial/entrypoints/preload.ts'],
  plugins: [getElectronPlugin('Main')]
}

if (isWatching) {
  const main = await esbuild.context(mainArgs)
  await Promise.all([main.watch()])
  await new Promise(() => {})
} else {
  await Promise.all([
    esbuild.build(mainArgs),
  ])
}
