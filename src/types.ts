export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  project: string;
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
  active: number;
}

export interface StatusPageGroup {
  id?: number;
  name: string;
  weight?: number;
  monitorList: Array<{ id: number; sendUrl?: number }>;
}

export interface StatusPageData {
  config: Record<string, unknown>;
  publicGroupList: StatusPageGroup[];
}

export interface FleetConfig {
  kumaUrl: string;
  kumaUser: string;
  kumaPass: string;
  dockerSocket: string;
  dockerHostName: string;
  statusPageSlug?: string;
  syncIntervalMs: number;
  cleanupStale: boolean;
  defaultGroup: string;
  ignorePatterns: RegExp[];
  skipBuildx: boolean;
}
