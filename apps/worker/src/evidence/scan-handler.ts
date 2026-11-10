import type { Db, Tx } from "@casitrace/db";
import { newId, type ObjectStorage } from "@casitrace/shared";
import type { RelayedEvent } from "../events";
import type { VirusScanner } from "./clamav";

interface FileUploaded {
  fileId: string;
  version: number;
  storageKey: string;
  sha256: string;
}

/** Worker jobs act across organisations; they set platform scope and stay within the event's org. */
const platformTx = <T>(db: Db, fn: (tx: Tx) => Promise<T>) =>
  db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.platform_access', 'on', true)`;
    return fn(tx);
  });

/**
 * Scans an uploaded evidence file. Clean → the evidence moves submitted → checked (if this file is
 * still the current one). Infected → rejected, and the stored object is deleted.
 * Idempotent: a file already scanned is skipped.
 */
export const createScanHandler =
  (db: Db, storage: ObjectStorage, scanner: VirusScanner) => async (event: RelayedEvent) => {
    const p = event.payload as FileUploaded;
    const file = await platformTx(db, (tx) => tx.evidenceFile.findUnique({ where: { id: p.fileId } }));
    if (file?.scanStatus !== "pending") return;

    const bytes = await storage.read(file.storageKey);
    const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const result =
      actual !== file.sha256
        ? { clean: false, signature: `hash mismatch (stored object ${actual.slice(0, 12)}…)` }
        : await scanner.scan(bytes);

    await platformTx(db, async (tx) => {
      await tx.evidenceFile.update({
        where: { id: file.id },
        data: {
          scanStatus: result.clean ? "clean" : "infected",
          scanDetail: result.signature,
          scannedAt: new Date(),
        },
      });
      const evidence = await tx.evidence.findUniqueOrThrow({ where: { id: file.evidenceId } });
      const isCurrent = evidence.currentFileVersion === file.version;
      if (isCurrent && evidence.status === "submitted") {
        const to = result.clean ? "checked" : "rejected";
        const moved = await tx.evidence.updateMany({
          where: { id: evidence.id, status: "submitted" },
          data: { status: to },
        });
        if (moved.count === 1) {
          await tx.evidenceStatusChange.create({
            data: {
              id: newId(),
              orgId: file.orgId,
              evidenceId: evidence.id,
              fromStatus: "submitted",
              toStatus: to,
              reason: result.clean
                ? "Virus scan clean; file type and hash checked"
                : `Virus scan failed: ${result.signature}`,
              actorType: "system",
              actorId: null,
              fileVersion: file.version,
            },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          id: newId(),
          orgId: file.orgId,
          actorType: "system",
          actorId: null,
          action: result.clean ? "evidence.scan_clean" : "evidence.scan_infected",
          resourceType: "evidence",
          resourceId: file.evidenceId,
          data: { version: file.version, signature: result.signature },
        },
      });
    });

    if (!result.clean) await storage.delete(file.storageKey);
  };
