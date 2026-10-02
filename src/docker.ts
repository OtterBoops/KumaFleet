import http from "node:http";
import { ContainerInfo, FleetConfig } from "./types.js";

interface RawContainer {
  Names: string[];
  Image: string;
  Labels?: Record<string, string>;
}

export class DockerClient {
  constructor(private socketPath: string) {}

  public getContainers(config: FleetConfig): Promise<ContainerInfo[]> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { socketPath: this.socketPath, path: "/containers/json?all=1", method: "GET", timeout: 10000 },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              return reject(new Error(`Docker API HTTP ${res.statusCode}: ${body}`));
            }
            try {
              const rawList: RawContainer[] = JSON.parse(body);
              const containers: ContainerInfo[] = [];

              for (const item of rawList) {
                const name = (item.Names[0] || "").replace(/^\//, "");
                if (!name) continue;

                const labels = item.Labels || {};
                const explicitIgnore = labels["kumafleet.ignore"] === "true" || labels["kuma.ignore"] === "true";
                const matchesPattern = config.ignorePatterns.some((p) => p.test(name));
                const isBuildx = name.startsWith("buildx_buildkit_") || (Boolean(item.Image) && item.Image.includes("buildkit"));

                const rawInterval = labels["kumafleet.interval"] || labels["kuma.interval"];
                const parsedInterval = rawInterval ? parseInt(rawInterval, 10) : NaN;

                containers.push({
                  name,
                  ignored: explicitIgnore || matchesPattern || (config.skipBuildx && isBuildx),
                  groupName: labels["kumafleet.group"] || labels["kuma.group"] || labels["com.docker.compose.project"] || config.defaultGroup,
                  customName: labels["kumafleet.name"] || labels["kuma.name"],
                  interval: !isNaN(parsedInterval) && parsedInterval >= 20 ? parsedInterval : undefined
                });
              }

              resolve(containers);
            } catch (err) {
              reject(err);
            }
          });
        }
      );

      req.on("timeout", () => req.destroy(new Error("Docker socket request timed out after 10s")));
      req.on("error", reject);
      req.end();
    });
  }
}
