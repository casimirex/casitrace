import { S3Client } from "bun";

/** Storage port (ADR 0011). Domain and application code depend on this interface, never on S3 directly. */
export interface ObjectStorage {
  put(key: string, body: Blob | ArrayBuffer | Uint8Array | string, contentType?: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Short-lived URL for a client to download (GET) or upload (PUT) one object. */
  presign(
    key: string,
    opts: { method: "GET" | "PUT"; expiresInSeconds: number; contentType?: string },
  ): string;
  /** Verifies the bucket is reachable and writable. */
  check(): Promise<void>;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const MAX_PRESIGN_SECONDS = 15 * 60;

export const createS3Storage = (cfg: S3Config): ObjectStorage => {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  });

  return {
    async put(key, body, contentType) {
      await client.write(key, body, contentType ? { type: contentType } : undefined);
    },
    exists: (key) => client.exists(key),
    async delete(key) {
      await client.delete(key);
    },
    presign(key, { method, expiresInSeconds, contentType }) {
      if (expiresInSeconds <= 0 || expiresInSeconds > MAX_PRESIGN_SECONDS) {
        throw new Error(`presign expiry must be 1..${MAX_PRESIGN_SECONDS} seconds`);
      }
      return client.presign(key, {
        method,
        expiresIn: expiresInSeconds,
        ...(contentType ? { type: contentType } : {}),
      });
    },
    async check() {
      // A write to a missing bucket can succeed silently on some S3 servers, so confirm with a read.
      const key = "_health/probe";
      await client.write(key, new Date().toISOString());
      if (!(await client.exists(key)))
        throw new Error(`bucket "${cfg.bucket}" is not writable or does not exist`);
    },
  };
};
