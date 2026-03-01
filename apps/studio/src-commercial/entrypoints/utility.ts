import rawLog from '@bksLogger';
rawLog.info("initializing utility");

const log = rawLog.scope('UtilityProcess');

import fs from 'fs';
import path from 'path';
import { MessagePortMain } from 'electron';
import ORMConnection from '@/common/appdb/Connection'
import Migration from '@/migration/index'
import platformInfo from '@/common/platform_info';
import { AppDbHandlers } from '@/handlers/appDbHandlers';
import { ConnHandlers } from '../backend/handlers/connHandlers';
import { FileHandlers } from '@/handlers/fileHandlers';
import { GeneratorHandlers } from '@/handlers/generatorHandlers';
import { Handlers } from '../backend/handlers/handlers';
import { newState, removeState, state } from '@/handlers/handlerState';
import { QueryHandlers } from '@/handlers/queryHandlers';
import { TabHistoryHandlers } from '@/handlers/tabHistoryHandlers'
import { ExportHandlers } from '@commercial/backend/handlers/exportHandlers';
import { BackupHandlers } from '@commercial/backend/handlers/backupHandlers';
import { AwsHandlers } from '@commercial/backend/handlers/awsHandlers';
import { ImportHandlers } from '@commercial/backend/handlers/importHandlers';
import { EnumHandlers } from '@commercial/backend/handlers/enumHandlers';
import { TempHandlers } from '@/handlers/tempHandlers';
import { DevHandlers } from '@/handlers/devHandlers';
import { FormatterPresetHandlers } from '@/handlers/formatterPresetHandlers';
import { LicenseHandlers } from '@/handlers/licenseHandlers';
import { LockHandlers } from '@/handlers/lockHandlers';
import { PluginHandlers } from '@/handlers/pluginHandlers';
import { PluginManager } from '@/services/plugin';
import PluginFileManager from '@/services/plugin/PluginFileManager';
import _ from 'lodash';
import { BundledPluginModule } from '@commercial/backend/plugin-system/modules/BundledPluginModule';

import * as sms from 'source-map-support'

if (platformInfo.env.development || platformInfo.env.test) {
  sms.install()
}

const embedMode = process.env.BKS_EMBED_MODE === "1";
const disableBundledPlugins = process.env.BKS_EMBED_DISABLE_BUNDLED_PLUGINS === "1";

let ormConnection: ORMConnection;
const REQUIRED_APPDB_TABLES = ['bk_migrations', 'user_setting', 'license_keys'] as const;
const pluginManager = new PluginManager({
  appVersion: platformInfo.appVersion,
  fileManager: new PluginFileManager({
    pluginsDirectory: platformInfo.pluginsDirectory,
  }),
});

if (embedMode && disableBundledPlugins) {
  log.info("Embedded mode: skipping bundled plugin bootstrap");
} else {
  pluginManager.registerModule(BundledPluginModule);
}

interface Reply {
  id: string,
  type: 'reply' | 'error',
  data?: any,
  error?: string
  stack?: string
}

export const handlers: Handlers = {
  ...ConnHandlers,
  ...QueryHandlers,
  ...GeneratorHandlers,
  ...ExportHandlers,
  ...ImportHandlers,
  ...AppDbHandlers,
  ...BackupHandlers,
  ...AwsHandlers,
  ...FileHandlers,
  ...EnumHandlers,
  ...TempHandlers,
  ...LicenseHandlers,
  ...PluginHandlers(pluginManager),
  ...TabHistoryHandlers,
  ...LockHandlers,
  ...FormatterPresetHandlers,
  ...(platformInfo.isDevelopment && DevHandlers),
};

_.mixin({
  'deepMapKeys': function (obj, fn) {

    const x = {};

    _.forOwn(obj, function (rawV, k) {
      let v = rawV
      if (_.isPlainObject(v)) {
        v = _.deepMapKeys(v, fn);
      } else if (_.isArray(v)) {
        v = v.map((item) => _.deepMapKeys(item, fn))
      }
      x[fn(v, k)] = v;
    });

    return x;
  }
});

process.on('uncaughtException', (error) => {
  log.error(error);
});

process.parentPort.on('message', async ({ data, ports }) => {
  const { type, sId } = data;
  switch (type) {
    case 'init':
      if (ports && ports.length > 0) {
        log.info('RECEIVED PORT: ', ports[0]);
        await initState(sId, ports[0]);
      } else {
        await init();
      }
      break;
    case 'close':
      log.info('REMOVING STATE FOR: ', sId);
      state(sId).port.close();
      removeState(sId);
      break;
    default:
      log.error('UNRECOGNIZED MESSAGE TYPE RECEIVED FROM MAIN PROCESS');
  }
})

async function runHandler(id: string, name: string, args: any) {
  log.info('RECEIVED REQUEST FOR NAME, ID: ', name, id);
  const replyArgs: Reply = {
    id,
    type: 'reply',
  };

  if (handlers[name]) {
    return handlers[name](args)
      .then((data) => {
        replyArgs.data = data;
      })
      .catch((e) => {
        replyArgs.type = 'error';
        replyArgs.stack = e?.stack;
        replyArgs.error = e?.message ?? e;
        log.error("HANDLER: ERROR", e)
      })
      .finally(() => {
        try {
          state(args.sId).port.postMessage(replyArgs);
        } catch (e) {
          log.error('ERROR SENDING MESSAGE: ', replyArgs, '\n\n\n ERROR: ', e)
        }
      });
  } else {
    replyArgs.type = 'error';
    replyArgs.error = `Invalid handler name: ${name}`;

    try {
      state(args.sId).port.postMessage(replyArgs);
    } catch (e) {
      log.error('ERROR SENDING MESSAGE: ', replyArgs, '\n\n\n ERROR: ', e)
    }
  }
}

async function initState(sId: string, port: MessagePortMain) {
  newState(sId);

  state(sId).port = port;

  state(sId).port.on('message', ({ data }) => {
    const { id, name, args } = data;
    runHandler(id, name, args);
  })

  state(sId).port.start();
}

async function missingCoreTables(): Promise<string[]> {
  const runner = ormConnection.connection.createQueryRunner();
  try {
    const missing: string[] = [];
    for (const tableName of REQUIRED_APPDB_TABLES) {
      // sqlite doesn't allow table names as parameters, but values are static constants.
      const rows = await runner.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`,
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        missing.push(tableName);
      }
    }
    return missing;
  } finally {
    await runner.release();
  }
}

async function reconnectAndMigrate(migrationEnv: string): Promise<void> {
  ormConnection = new ORMConnection(platformInfo.appDbPath, false);
  await ormConnection.connect();
  const migrator = new Migration(ormConnection, migrationEnv);
  await migrator.run();
}

async function init() {
  try {
    fs.mkdirSync(platformInfo.userDirectory, { recursive: true });
    fs.mkdirSync(platformInfo.pluginsDirectory, { recursive: true });
    fs.mkdirSync(path.dirname(platformInfo.appDbPath), { recursive: true });
  } catch (e) {
    log.warn("Failed to initialize BeeKeeper user directories", e);
  }

  const migrationEnv = process.env.NODE_ENV || (platformInfo.isDevelopment ? 'development' : 'production');
  await reconnectAndMigrate(migrationEnv);

  let missing = await missingCoreTables();
  if (missing.length > 0) {
    log.warn(`Core app DB tables missing after migration: ${missing.join(', ')}. Recreating DB.`);
    try {
      await ormConnection.disconnect();
    } catch (e) {
      log.warn("Error disconnecting DB before recreation", e);
    }

    try {
      if (fs.existsSync(platformInfo.appDbPath)) {
        const brokenDbPath = `${platformInfo.appDbPath}.broken-${Date.now()}`;
        fs.renameSync(platformInfo.appDbPath, brokenDbPath);
        log.warn(`Backed up broken app DB to ${brokenDbPath}`);
      }
    } catch (e) {
      log.warn("Failed to backup app DB, attempting delete fallback", e);
      try {
        if (fs.existsSync(platformInfo.appDbPath)) {
          fs.unlinkSync(platformInfo.appDbPath);
        }
      } catch (unlinkErr) {
        log.error("Failed to remove broken app DB", unlinkErr);
      }
    }

    await reconnectAndMigrate(migrationEnv);
    missing = await missingCoreTables();
    if (missing.length > 0) {
      log.error(`Core app DB tables still missing after recreate: ${missing.join(', ')}`);
    }
  }

  pluginManager.initialize().catch((e) => {
    log.error("Error initializing plugin manager", e);
  });

  process.parentPort.postMessage({ type: 'ready' });
}
