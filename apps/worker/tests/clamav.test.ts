import { describe, expect, test } from "bun:test";
import { render } from "../src/email/templates";
import { createClamavScanner } from "../src/evidence/clamav";

const scanner = createClamavScanner("localhost", 3310);
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

describe("ClamAV client", () => {
  test("clean bytes pass, EICAR is found, and multi-chunk files work", async () => {
    expect(await scanner.scan(new TextEncoder().encode("ordinary harvest notes"))).toEqual({
      clean: true,
      signature: null,
    });
    const infected = await scanner.scan(new TextEncoder().encode(EICAR));
    expect(infected.clean).toBe(false);
    expect(infected.signature).toContain("Eicar");
    const big = new Uint8Array(3 * 1024 * 1024).fill(65);
    expect((await scanner.scan(big)).clean).toBe(true);
  });

  test("an unreachable scanner is an error, never a clean result", async () => {
    await expect(createClamavScanner("localhost", 1, 2000).scan(new Uint8Array([1]))).rejects.toThrow();
  });
});

describe("expiry email", () => {
  test("wording for days left, today and expired", () => {
    const base = { name: "Ana", title: "Organic", organisationName: "Farm", url: "http://x" };
    const mk = (days: string) =>
      render({ template: "evidence-expiry", to: "a@x.test", data: { ...base, days } }).subject;
    expect(mk("7")).toBe("Certificate expires in 7 days: Organic");
    expect(mk("0")).toBe("Certificate expires today: Organic");
    expect(mk("expired")).toBe("Certificate expired: Organic");
  });
});
