/** Milliseconds retained by the cloud snapshot index. */
export const CLOUD_RETENTION_MS = 8 * 24 * 60 * 60 * 1_000;

export const CLOUD_MANIFEST_SCHEMA = 1 as const;

export interface CloudSnapshotEntry {
  timestamp: number;
  file: `snapshots/${number}.txt`;
  bytes: number;
}

export interface CloudManifest {
  schemaVersion: typeof CLOUD_MANIFEST_SCHEMA;
  generatedAt: string;
  latestTimestamp: number | null;
  snapshots: CloudSnapshotEntry[];
}
