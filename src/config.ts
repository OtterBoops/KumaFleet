import { FleetConfig } from "./types.js";

function parseIgnoreList(raw: string | undefined): RegExp[] {
  const defaults = ["kumafleet", "uptime-kuma"];
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : defaults;
  return list.map((item) => {
    const escaped = item.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
  });
}

export function loadConfig(): FleetConfig {
  const kumaUrl = process.env.KUMA_URL || "http://uptime-kuma:3001";
  const kumaUser = process.env.KUMA_USER;
  const kumaPass = process.env.KUMA_PASS;

  if (!kumaUser || !kumaPass) {
    console.error("[kumafleet] Missing required env: KUMA_USER and KUMA_PASS must be provided.");
    process.exit(1);
  }

  const syncIntervalSec = parseInt(process.env.SYNC_INTERVAL || "30", 10);

  return {
    kumaUrl,
    kumaUser,
    kumaPass,
    dockerSocket: process.env.DOCKER_SOCKET || "/var/run/docker.sock",
    dockerHostName: process.env.DOCKER_HOST_NAME || "Local Docker",
    statusPageSlug: process.env.STATUS_PAGE_SLUG?.trim() || undefined,
    syncIntervalMs: Math.max(5, syncIntervalSec) * 1000,
    autoDeregister: process.env.AUTO_DEREGISTER !== "false" && process.env.AUTO_DEREGISTER !== "0",
    defaultGroup: process.env.DEFAULT_GROUP || "Standalone",
    ignorePatterns: parseIgnoreList(process.env.IGNORE_CONTAINERS),
    skipBuildx: process.env.SKIP_BUILDX !== "false" && process.env.SKIP_BUILDX !== "0"
  };
}
