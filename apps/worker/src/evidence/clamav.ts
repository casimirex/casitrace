import net from "node:net";

export interface ScanResult {
  clean: boolean;
  signature: string | null;
}

export interface VirusScanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

/**
 * Minimal clamd client (INSTREAM over TCP). Sends the bytes in chunks prefixed with a 4-byte
 * big-endian length, terminated by a zero-length chunk, and parses "stream: OK" or "stream: <sig> FOUND".
 */
export const createClamavScanner = (host: string, port: number, timeoutMs = 60_000): VirusScanner => ({
  scan: (bytes) =>
    new Promise<ScanResult>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const chunks: Buffer[] = [];
      const fail = (e: Error) => {
        socket.destroy();
        reject(e);
      };
      socket.setTimeout(timeoutMs, () => fail(new Error("clamd timed out")));
      socket.on("error", fail);
      socket.on("data", (d) => chunks.push(Buffer.from(d)));
      socket.on("end", () => {
        const reply = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
        if (reply.endsWith("OK")) return resolve({ clean: true, signature: null });
        const found = reply.match(/^stream: (.+) FOUND$/);
        if (found) return resolve({ clean: false, signature: found[1] ?? "unknown" });
        reject(new Error(`clamd: ${reply || "empty reply"}`));
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        const CHUNK = 64 * 1024;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          const part = bytes.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          socket.write(len);
          socket.write(part);
        }
        socket.end(Buffer.alloc(4)); // zero-length chunk ends the stream
      });
    }),
});
