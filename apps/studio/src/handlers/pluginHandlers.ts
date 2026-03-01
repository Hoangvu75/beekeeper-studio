import { EncryptedPluginData } from "@/common/appdb/models/EncryptedPluginData";
import { PluginData } from "@/common/appdb/models/PluginData";
import { Manifest, PluginContext, PluginManager, PluginRegistryEntry, PluginRepository } from "@/services/plugin";
import { PluginTimeoutError } from "@/services/plugin/errors";

const embedMode = process.env.BKS_EMBED_MODE === "1";

interface IPluginHandlers {
  "plugin/plugins": () => Promise<PluginContext[]>
  "plugin/entries": ({ clearCache }: { clearCache: boolean }) => Promise<{ official: PluginRegistryEntry[], community: PluginRegistryEntry[] }>
  "plugin/repository": ({ id }: { id: string }) => Promise<PluginRepository>
  "plugin/install": ({ id }: { id: string }) => Promise<Manifest>
  "plugin/update": ({ id }: { id: string }) => Promise<Manifest>
  "plugin/uninstall": ({ id }: { id: string }) => Promise<void>
  "plugin/checkForUpdates": ({ id }: { id: string }) => Promise<boolean>
  "plugin/setAutoUpdateEnabled": ({ id, enabled }: { id: string, enabled: boolean }) => Promise<void>
  "plugin/getAutoUpdateEnabled": ({ id }: { id: string }) => Promise<boolean>
  "plugin/viewEntrypointExists": ({ pluginId, viewId }: { pluginId: string, viewId: string }) => Promise<boolean>

  "plugin/getData": ({ manifest, key }: { manifest: Manifest, key?: string }) => Promise<unknown>
  "plugin/setData": ({ manifest, key }: { manifest: Manifest, key?: string, value?: unknown }) => Promise<void>
  "plugin/getEncryptedData": ({ manifest, key }: { manifest: Manifest, key?: string }) => Promise<unknown>
  "plugin/setEncryptedData": ({ manifest, key }: { manifest: Manifest, key?: string, value?: unknown }) => Promise<void>
  "plugin/getAsset": ({ manifest, path }: { manifest: Manifest, path: string }) => Promise<string>
}

export const PluginHandlers: (pluginManager: PluginManager) => IPluginHandlers = (pluginManager) => ({
  "plugin/waitForInit": async () => {
    if (embedMode) return;

    if (pluginManager.isInitialized) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let duration = 0;
      const interval = setInterval(() => {
        duration += 100;
        if (pluginManager.isInitialized) {
          clearInterval(interval);
          resolve();
        } else if (duration > 30_000) {
          clearInterval(interval);
          reject(new PluginTimeoutError("Plugin initialization timed out"));
        }
      }, 100);
    });
  },
  "plugin/plugins": async () => {
    if (embedMode) return [];
    return pluginManager.getPlugins();
  },
  "plugin/entries": async ({ clearCache }) => {
    if (embedMode) {
      return { official: [], community: [] };
    }
    if (clearCache) {
      pluginManager.registry.clearCache();
    }
    return await pluginManager.registry.getEntries();
  },
  "plugin/repository": async ({ id }) => {
    if (embedMode) {
      return { id } as PluginRepository;
    }
    return await pluginManager.getRepository(id);
  },
  "plugin/install": async ({ id }) => {
    if (embedMode) {
      throw new Error(`Plugin install is disabled in embedded mode: ${id}`);
    }
    return await pluginManager.installPlugin(id);
  },
  "plugin/update": async ({ id }) => {
    if (embedMode) {
      throw new Error(`Plugin update is disabled in embedded mode: ${id}`);
    }
    return await pluginManager.updatePlugin(id);
  },
  "plugin/uninstall": async ({ id }) => {
    if (embedMode) return;
    return await pluginManager.uninstallPlugin(id);
  },
  "plugin/checkForUpdates": async ({ id }) => {
    if (embedMode) return false;
    return await pluginManager.checkForUpdates(id);
  },
  "plugin/setAutoUpdateEnabled": async ({ id, enabled }) => {
    if (embedMode) return;
    await pluginManager.setPluginAutoUpdateEnabled(id, enabled);
  },
  "plugin/getAutoUpdateEnabled": async ({ id }) => {
    if (embedMode) return false;
    return pluginManager.getPluginAutoUpdateEnabled(id);
  },
  "plugin/viewEntrypointExists": async ({ pluginId, viewId }) => {
    if (embedMode) return false;
    return pluginManager.viewEntrypointExists(pluginId, viewId);
  },

  "plugin/setData": async ({ manifest, key, value }) => {
    if (embedMode) return;
    await PluginData.set(manifest.id, key, value);
  },
  "plugin/getData": async ({ manifest, key }) => {
    if (embedMode) return null;
    return await PluginData.get(manifest.id, key);
  },
  "plugin/setEncryptedData": async ({ manifest, key, value }) => {
    if (embedMode) return;
    await EncryptedPluginData.set(manifest.id, key, value);
  },
  "plugin/getEncryptedData": async ({ manifest, key }) => {
    if (embedMode) return null;
    return await EncryptedPluginData.get(manifest.id, key);
  },
  "plugin/getAsset": async ({ manifest, path }) => {
    if (embedMode) {
      throw new Error(`Plugin assets are unavailable in embedded mode: ${manifest?.id || "unknown"}:${path}`);
    }
    return await pluginManager.getPluginAsset(manifest, path);
  }
});
