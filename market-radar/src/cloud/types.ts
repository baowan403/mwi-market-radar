/** Milliseconds retained by the cloud snapshot index. */
export const CLOUD_RETENTION_MS = 8 * 24 * 60 * 60 * 1_000;

export const CLOUD_MANIFEST_SCHEMA = 1 as const;

export interface CloudSnapshotEntry {
  timestamp: number;
  file: string;
  bytes: number;
}

export interface CloudManifest {
  schema: typeof CLOUD_MANIFEST_SCHEMA;
  generatedAt: string;
  latest: number | null;
  snapshots: CloudSnapshotEntry[];
}
