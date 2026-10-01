import http from "node:http";
import { ContainerInfo, FleetConfig } from "./types.js";

interface RawContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels?: Record<string, string>;
}

export class DockerClient {
  constructor(private socketPath: string) {}

  public getContainers(config: FleetConfig): Promise<ContainerInfo[]> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: this.socketPath,
        path: "/containers/json?all=0",
        method: "GET"
      };

      const req = http.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`Docker API returned status ${res.statusCode}: ${body}`));
          }

          try {
            const rawList: RawContainer[] = JSON.parse(body);
            const containers: ContainerInfo[] = [];

            for (const item of rawList) {
              const rawName = (item.Names[0] || "").replace(/^\//, "");
              if (!rawName) continue;

              const labels = item.Labels || {};
              const explicitIgnore = labels["kumafleet.ignore"] === "true" || labels["kuma.ignore"] === "true";
              const matchesPattern = config.ignorePatterns.some((pattern) => pattern.test(rawName));
              const isBuildx = rawName.startsWith("buildx_buildkit_") || (Boolean(item.Image) && item.Image.includes("buildkit"));
              const skipBuildx = config.skipBuildx && isBuildx;

              const project = labels["com.docker.compose.project"] || "";
              const customGroup = labels["kumafleet.group"] || labels["kuma.group"];
              const groupName = customGroup || (project ? project : config.defaultGroup);

              const customName = labels["kumafleet.name"] || labels["kuma.name"];
              const intervalStr = labels["kumafleet.interval"] || labels["kuma.interval"];
              const interval = intervalStr ? parseInt(intervalStr, 10) : undefined;

              containers.push({
                id: item.Id,
                name: rawName,
                image: item.Image,
                state: item.State,
                status: item.Status,
                project,
                ignored: explicitIgnore || matchesPattern || skipBuildx,
                groupName,
                customName,
                interval
              });
            }

            resolve(containers);
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on("error", reject);
      req.end();
    });
  }
}
