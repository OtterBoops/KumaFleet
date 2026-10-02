import { io, Socket } from "socket.io-client";
import { FleetConfig, KumaMonitor, StatusPageGroup } from "./types.js";

interface DockerHost {
  id: number;
  name: string;
  dockerDaemon?: string;
  docker_daemon?: string;
}

export class KumaClient {
  private socket: Socket | null = null;
  private dockerHostId: number | null = null;
  private authenticated = false;
  private knownHosts: DockerHost[] = [];
  private monitors: Record<string, KumaMonitor> = {};

  constructor(private config: FleetConfig) {}

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let isInit = true;

      this.socket = io(this.config.kumaUrl, { reconnection: true, reconnectionDelay: 3000, timeout: 10000 });

      this.socket.on("dockerHostList", (list: DockerHost[]) => {
        if (!Array.isArray(list)) return;
        this.knownHosts = list;
        const match = list.find((h) => (h.docker_daemon || h.dockerDaemon) === this.config.dockerSocket || h.name === this.config.dockerHostName);
        if (match) this.dockerHostId = match.id;
      });

      this.socket.on("monitorList", (data: Record<string, KumaMonitor>) => {
        if (data && typeof data === "object") {
          this.monitors = { ...data };
        }
      });

      this.socket.on("updateMonitorIntoList", (data: Record<string, KumaMonitor>) => {
        if (data && typeof data === "object") {
          this.monitors = { ...this.monitors, ...data };
        }
      });

      this.socket.on("connect", () => {
        console.log(`[kumafleet] Connected to Uptime Kuma at ${this.config.kumaUrl}`);
        this.login()
          .then(async () => {
            this.authenticated = true;
            await this.ensureDockerHost();
            if (isInit) {
              isInit = false;
              resolve();
            }
          })
          .catch((err) => {
            if (isInit) {
              isInit = false;
              reject(err);
            } else {
              console.error(`[kumafleet] Re-login failed: ${err.message}`);
            }
          });
      });

      this.socket.on("disconnect", () => {
        this.authenticated = false;
        console.warn("[kumafleet] Disconnected from Uptime Kuma. Waiting to reconnect...");
      });

      this.socket.on("connect_error", (err) => console.error(`[kumafleet] Connection error: ${err.message}`));
    });
  }

  public isReady(): boolean {
    return Boolean(this.socket?.connected && this.authenticated);
  }

  private login(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket!.emit("login", { username: this.config.kumaUser, password: this.config.kumaPass }, (res: { ok: boolean; msg?: string }) => {
        if (res?.ok) {
          console.log(`[kumafleet] Authenticated as '${this.config.kumaUser}'`);
          resolve();
        } else {
          reject(new Error(`Login failed: ${res?.msg || "unknown error"}`));
        }
      });
    });
  }

  public async ensureDockerHost(): Promise<number> {
    if (this.dockerHostId) return this.dockerHostId;

    const existing = this.knownHosts.find((h) => (h.docker_daemon || h.dockerDaemon) === this.config.dockerSocket || h.name === this.config.dockerHostName);
    if (existing) {
      this.dockerHostId = existing.id;
      console.log(`[kumafleet] Reusing Docker host ID: ${this.dockerHostId}`);
      return this.dockerHostId;
    }

    return new Promise((resolve) => {
      this.socket!.emit(
        "addDockerHost",
        { name: this.config.dockerHostName, dockerType: "socket", dockerDaemon: this.config.dockerSocket },
        null,
        (res: { ok: boolean; id?: number }) => {
          this.dockerHostId = res?.id || 1;
          console.log(`[kumafleet] Configured Docker host ID: ${this.dockerHostId}`);
          resolve(this.dockerHostId);
        }
      );
    });
  }

  public getDockerHostId(): number | null {
    return this.dockerHostId;
  }

  public getMonitors(): Record<string, KumaMonitor> {
    return this.monitors;
  }

  public addMonitor(name: string, displayName?: string, interval = 60): Promise<number | null> {
    return new Promise((resolve) => {
      const payload = {
        name: displayName || name,
        type: "docker",
        docker_container: name,
        docker_host: this.dockerHostId,
        interval,
        retryInterval: interval,
        maxretries: 1,
        active: 1,
        accepted_statuscodes: ["200-299"],
        conditions: [],
        kafkaProducerBrokers: [],
        kafkaProducerSaslOptions: {},
        rabbitmqNodes: []
      };

      this.socket!.emit("add", payload, (res: { ok: boolean; msg?: string; monitorID?: number }) => {
        if (res?.ok && res.monitorID) {
          console.log(`[kumafleet] + Added monitor for '${name}' (id: ${res.monitorID})`);
          this.monitors[String(res.monitorID)] = {
            id: res.monitorID,
            name: displayName || name,
            type: "docker",
            docker_container: name,
            docker_host: this.dockerHostId || undefined
          };
          resolve(res.monitorID);
        } else {
          console.error(`[kumafleet] ! Failed to add '${name}': ${res?.msg || "unknown error"}`);
          resolve(null);
        }
      });
    });
  }

  public deleteMonitor(monitorId: number, name: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.socket!.emit("deleteMonitor", monitorId, (res: { ok: boolean }) => {
        if (res?.ok) {
          console.log(`[kumafleet] - Deleted stale monitor '${name}' (id: ${monitorId})`);
          delete this.monitors[String(monitorId)];
        }
        resolve(Boolean(res?.ok));
      });
    });
  }

  public updateStatusPage(slug: string, groups: StatusPageGroup[]): Promise<void> {
    return new Promise((resolve) => {
      this.socket!.emit("getStatusPage", slug, (res: { ok?: boolean; config?: Record<string, unknown> }) => {
        if (!res?.config) {
          console.log(`[kumafleet] Creating missing status page '${slug}'...`);
          const title = slug.charAt(0).toUpperCase() + slug.slice(1);
          this.socket!.emit("addStatusPage", title, slug, (addRes: { ok: boolean }) => {
            if (!addRes?.ok) return resolve();
            this.socket!.emit("getStatusPage", slug, (freshRes: { ok?: boolean; config?: Record<string, unknown> }) => {
              if (freshRes?.config) this.saveGroups(slug, freshRes.config, groups).then(resolve);
              else resolve();
            });
          });
          return;
        }
        this.saveGroups(slug, res.config, groups).then(resolve);
      });
    });
  }

  private saveGroups(slug: string, config: Record<string, unknown>, groups: StatusPageGroup[]): Promise<void> {
    return new Promise((resolve) => {
      this.socket!.emit("saveStatusPage", slug, config, (config.icon as string) || "", groups, (res: { ok: boolean }) => {
        if (res?.ok) console.log(`[kumafleet] Synced status page '${slug}' across ${groups.length} groups.`);
        resolve();
      });
    });
  }
}