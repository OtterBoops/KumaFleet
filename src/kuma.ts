import { io, Socket } from "socket.io-client";
import { FleetConfig, KumaMonitor, StatusPageGroup } from "./types.js";

export class KumaClient {
  private socket: Socket | null = null;
  private dockerHostId: number | null = null;
  private authenticated = false;

  constructor(private config: FleetConfig) {}

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.config.kumaUrl, {
        reconnection: true,
        reconnectionDelay: 3000,
        timeout: 10000
      });

      this.socket.on("connect", () => {
        console.log(`[kumafleet] Connected to Uptime Kuma at ${this.config.kumaUrl}`);
        this.login()
          .then(() => {
            this.authenticated = true;
            resolve();
          })
          .catch(reject);
      });

      this.socket.on("disconnect", () => {
        this.authenticated = false;
        console.warn("[kumafleet] Disconnected from Uptime Kuma. Waiting to reconnect...");
      });

      this.socket.on("connect_error", (err) => {
        console.error(`[kumafleet] Connection error: ${err.message}`);
      });
    });
  }

  public isReady(): boolean {
    return this.socket !== null && this.socket.connected && this.authenticated;
  }

  private login(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error("Socket not initialized"));

      this.socket.emit(
        "login",
        { username: this.config.kumaUser, password: this.config.kumaPass },
        (res: { ok: boolean; msg?: string; token?: string }) => {
          if (!res || !res.ok) {
            return reject(new Error(`Login failed: ${res?.msg || "unknown error"}`));
          }
          console.log(`[kumafleet] Authenticated as '${this.config.kumaUser}'`);
          resolve();
        }
      );
    });
  }

  public async ensureDockerHost(): Promise<number> {
    if (this.dockerHostId) return this.dockerHostId;
    if (!this.socket) throw new Error("Socket not connected");

    return new Promise((resolve) => {
      this.socket!.emit(
        "addDockerHost",
        {
          name: this.config.dockerHostName,
          dockerType: "socket",
          dockerDaemon: this.config.dockerSocket
        },
        null,
        (res: { ok: boolean; id?: number }) => {
          this.dockerHostId = res?.id || 1;
          console.log(`[kumafleet] Using Docker host ID: ${this.dockerHostId}`);
          resolve(this.dockerHostId);
        }
      );
    });
  }

  public getMonitors(): Promise<Record<string, KumaMonitor>> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve({});
      this.socket.emit("getMonitorList", (res: Record<string, KumaMonitor>) => {
        resolve(res || {});
      });
    });
  }

  public addMonitor(containerName: string, displayName?: string, interval = 60): Promise<number | null> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve(null);

      const payload = {
        name: displayName || containerName,
        type: "docker",
        docker_container: containerName,
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

      this.socket.emit("add", payload, (res: { ok: boolean; msg?: string; monitorID?: number }) => {
        if (res && res.ok && res.monitorID) {
          console.log(`[kumafleet] + Added monitor for '${containerName}' (id: ${res.monitorID})`);
          resolve(res.monitorID);
        } else {
          console.error(`[kumafleet] ! Failed to add '${containerName}': ${res?.msg || "unknown error"}`);
          resolve(null);
        }
      });
    });
  }

  public deleteMonitor(monitorId: number, containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve(false);
      this.socket.emit("deleteMonitor", monitorId, (res: { ok: boolean; msg?: string }) => {
        if (res && res.ok) {
          console.log(`[kumafleet] - Deleted stale monitor '${containerName}' (id: ${monitorId})`);
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  public updateStatusPage(slug: string, groups: StatusPageGroup[]): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve();

      this.socket.emit("getStatusPage", slug, (res: { ok?: boolean; config?: Record<string, unknown> }) => {
        if (!res || !res.config) {
          console.warn(`[kumafleet] Status page with slug '${slug}' not found on Uptime Kuma.`);
          return resolve();
        }

        const icon = (res.config.icon as string) || "";
        this.socket!.emit("saveStatusPage", slug, res.config, icon, groups, (saveRes: { ok: boolean }) => {
          if (saveRes && saveRes.ok) {
            console.log(`[kumafleet] Synced status page '${slug}' across ${groups.length} groups.`);
          } else {
            console.error(`[kumafleet] Failed to save status page '${slug}'.`);
          }
          resolve();
        });
      });
    });
  }
}