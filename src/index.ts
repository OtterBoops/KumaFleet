import { loadConfig } from "./config.js";
import { DockerClient } from "./docker.js";
import { KumaClient } from "./kuma.js";
import { StatusPageGroup } from "./types.js";

async function main() {
  console.log("------------------------------------------------\n KumaFleet - Zero-Touch Docker Monitoring\n https://github.com/OtterBoops/KumaFleet\n------------------------------------------------");

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
      const hostId = kuma.getDockerHostId();

      for (const [idStr, mon] of Object.entries(existingMonitors)) {
        if (mon.type === "docker" && mon.docker_container && (!hostId || !mon.docker_host || mon.docker_host === hostId)) {
          existingByContainer.set(mon.docker_container, parseInt(idStr, 10));
        }
      }

      const activeNames = new Set(activeContainers.map((c) => c.name));

      if (config.autoDeregister) {
        for (const [name, monId] of existingByContainer.entries()) {
          if (!activeNames.has(name)) {
            await kuma.deleteMonitor(monId, name);
            existingByContainer.delete(name);
          }
        }
      }

      const groups = new Map<string, number[]>();

      for (const c of activeContainers) {
        let monId = existingByContainer.get(c.name);
        if (!monId) {
          monId = (await kuma.addMonitor(c.name, c.customName, c.interval)) || undefined;
          if (monId) existingByContainer.set(c.name, monId);
        }

        if (monId) {
          const list = groups.get(c.groupName) || [];
          list.push(monId);
          groups.set(c.groupName, list);
        }
      }

      if (config.statusPageSlug && groups.size > 0) {
        const sorted = Array.from(groups.keys()).sort();
        const pageGroups: StatusPageGroup[] = sorted.map((name, i) => ({
          name,
          weight: i + 1,
          monitorList: groups.get(name)!.map((id) => ({ id }))
        }));
        await kuma.updateStatusPage(config.statusPageSlug, pageGroups);
      }
    } catch (err: unknown) {
      console.error(`[kumafleet] Sync error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isSyncing = false;
    }
  }

  await syncFleet();
  const timer = setInterval(syncFleet, config.syncIntervalMs);

  const shutdown = (sig: string) => {
    console.log(`[kumafleet] Received ${sig}. Exiting...`);
    clearInterval(timer);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[kumafleet] Fatal startup error:", err);
  process.exit(1);
});