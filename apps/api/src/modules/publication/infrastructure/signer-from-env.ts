import type { Env } from "../../../config/env";
import { createSigner, type Signer } from "../domain/signing";
import { createTransitSigner } from "./transit-signer";

/** Builds the passport signer the configuration asks for (local key or KMS). */
export const signerFromEnv = (env: Env): Promise<Signer> => {
  if (env.PASSPORT_SIGNER === "local") {
    // loadEnv guarantees the key when PASSPORT_SIGNER=local.
    return createSigner(env.PASSPORT_SIGNING_KEY ?? "", env.PASSPORT_PREVIOUS_KEYS);
  }
  return createTransitSigner({
    addr: env.KMS_ADDR ?? "",
    mount: env.KMS_TRANSIT_MOUNT,
    keyName: env.KMS_KEY_NAME,
    auth: env.KMS_TOKEN
      ? { token: env.KMS_TOKEN }
      : { roleId: env.KMS_ROLE_ID ?? "", secretId: env.KMS_SECRET_ID ?? "" },
    previous: env.PASSPORT_PREVIOUS_KEYS,
  });
};
