export interface ContainerInfo {
  name: string;
  ignored: boolean;
  groupName: string;
  customName?: string;
  interval?: number;
}

export interface KumaMonitor {
  id: number;
  name: string;
  type: string;
  docker_container?: string;
  docker_host?: number;
}

export interface StatusPageGroup {
  name: string;
  weight: number;
  monitorList: Array<{ id: number }>;
}

export interface FleetConfig {
  kumaUrl: string;
  kumaUser: string;
  kumaPass: string;
  dockerSocket: string;
  dockerHostName: string;
  statusPageSlug?: string;
  syncIntervalMs: number;
  autoDeregister: boolean;
  defaultGroup: string;
  ignorePatterns: RegExp[];
  skipBuildx: boolean;
}
