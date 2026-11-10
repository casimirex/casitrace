// Evidence object backup and integrity check (ADR 0015, docs/operations/runbooks/restore.md).
//
//   bun scripts/ops/mirror-evidence.ts mirror   copy objects missing from the backup bucket
//   bun scripts/ops/mirror-evidence.ts verify   check every stored file in a bucket against the DB SHA-256
//
// Env: OWNER_DATABASE_URL (operator, reads evidence_file across organisations; read-only use),
//      SOURCE_* (evidence bucket) and BACKUP_* (backup bucket): _ENDPOINT, _REGION, _BUCKET,
//      _ACCESS_KEY_ID, _SECRET_ACCESS_KEY.  verify reads VERIFY_TARGET=source|backup (default backup).
// Objects are copied byte for byte; the SHA-256 recorded at upload is checked on every copy, so a
// corrupted source is reported instead of overwriting a good backup.
import { S3Client, SQL } from "bun";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const bucket = (p: string) =>
  new S3Client({
    endpoint: env(`${p}_ENDPOINT`),
    region: env(`${p}_REGION`),
    bucket: env(`${p}_BUCKET`),
    accessKeyId: env(`${p}_ACCESS_KEY_ID`),
    secretAccessKey: env(`${p}_SECRET_ACCESS_KEY`),
  });
const sha = (b: ArrayBuffer) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

const mode = process.argv[2];
const db = new SQL(env("OWNER_DATABASE_URL"));
// Infected files are deleted after scanning (P4); everything else must exist.
const files =
  (await db`SELECT storage_key, sha256 FROM evidence_file WHERE scan_status <> 'infected' ORDER BY uploaded_at`) as {
    storage_key: string;
    sha256: string;
  }[];
await db.close();

const result = {
  mode,
  files: files.length,
  copied: 0,
  alreadyPresent: 0,
  verified: 0,
  missing: [] as string[],
  corrupt: [] as string[],
};
if (mode === "mirror") {
  const src = bucket("SOURCE");
  const dst = bucket("BACKUP");
  for (const f of files) {
    if (await dst.exists(f.storage_key)) {
      result.alreadyPresent++;
      continue;
    }
    if (!(await src.exists(f.storage_key))) {
      result.missing.push(f.storage_key);
      continue;
    }
    const body = await src.file(f.storage_key).arrayBuffer();
    if (sha(body) !== f.sha256) {
      result.corrupt.push(f.storage_key);
      continue;
    }
    await dst.write(f.storage_key, body);
    result.copied++;
  }
} else if (mode === "verify") {
  const target = bucket(process.env.VERIFY_TARGET === "source" ? "SOURCE" : "BACKUP");
  for (const f of files) {
    if (!(await target.exists(f.storage_key))) {
      result.missing.push(f.storage_key);
      continue;
    }
    if (sha(await target.file(f.storage_key).arrayBuffer()) === f.sha256) result.verified++;
    else result.corrupt.push(f.storage_key);
  }
} else {
  console.error("usage: mirror-evidence.ts mirror|verify");
  process.exit(2);
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.missing.length || result.corrupt.length ? 1 : 0);
