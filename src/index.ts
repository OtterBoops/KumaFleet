import { loadConfig } from "./config.js";
import { DockerClient } from "./docker.js";
import { KumaClient } from "./kuma.js";
import { StatusPageGroup } from "./types.js";

async function main() {
  console.log("------------------------------------------------");
  console.log(" KumaFleet - Zero-Touch Docker Monitoring");
  console.log(" https://github.com/OtterBoops/KumaFleet");
  console.log("------------------------------------------------");

  const config = loadConfig();
  const docker = new DockerClient(config.dockerSocket);
  const kuma = new KumaClient(config);

  await kuma.connect();
  await kuma.ensureDockerHost();

  let isSyncing = false;

  async function syncFleet() {
    if (isSyncing || !kuma.isReady()) return;
    isSyncing = true;

    try {
      const containers = await docker.getContainers(config);
      const activeContainers = containers.filter((c) => !c.ignored);

      const existingMonitors = await kuma.getMonitors();
      const existingByContainer = new Map<string, number>();

      for (const [idStr, mon] of Object.entries(existingMonitors)) {
        if (mon.type === "docker" && mon.docker_container) {
          existingByContainer.set(mon.docker_container, parseInt(idStr, 10));
        }
      }

      const activeNames = new Set(activeContainers.map((c) => c.name));

      // 1. Delete stale monitors if cleanup is enabled
      if (config.cleanupStale) {
        for (const [containerName, monId] of existingByContainer.entries()) {
          if (!activeNames.has(containerName)) {
            await kuma.deleteMonitor(monId, containerName);
            existingByContainer.delete(containerName);
          }
        }
      }

      // 2. Add newly discovered containers
      const monitorGroupMap = new Map<string, number[]>();

      for (const container of activeContainers) {
        let monId = existingByContainer.get(container.name);

        if (!monId) {
          const newId = await kuma.addMonitor(container.name, container.customName, container.interval);
          if (newId) {
            monId = newId;
            existingByContainer.set(container.name, newId);
          }
        }

        if (monId) {
          const groupName = container.groupName;
          if (!monitorGroupMap.has(groupName)) {
            monitorGroupMap.set(groupName, []);
          }
          monitorGroupMap.get(groupName)!.push(monId);
        }
      }

      // 3. Sync status page if configured
      if (config.statusPageSlug && monitorGroupMap.size > 0) {
        const sortedGroups = Array.from(monitorGroupMap.keys()).sort();
        const publicGroupList: StatusPageGroup[] = sortedGroups.map((groupName, idx) => ({
          name: groupName,
          weight: idx + 1,
          monitorList: monitorGroupMap.get(groupName)!.map((id) => ({ id }))
        }));

        await kuma.updateStatusPage(config.statusPageSlug, publicGroupList);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kumafleet] Sync error: ${msg}`);
    } finally {
      isSyncing = false;
    }
  }

  // Initial sync
  await syncFleet();

  // Scheduled interval
  const timer = setInterval(syncFleet, config.syncIntervalMs);

  function shutdown(signal: string) {
    console.log(`[kumafleet] Received ${signal}. Shutting down gracefully...`);
    clearInterval(timer);
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[kumafleet] Fatal startup error:", err);
  process.exit(1);
});