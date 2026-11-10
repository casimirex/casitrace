// Prints a new Ed25519 passport signing key (PKCS#8, base64url) and its key ID.
// Store it in the secrets manager as PASSPORT_SIGNING_KEY; never commit a production key.
import { createSigner, generateKeyPkcs8 } from "../apps/api/src/modules/publication/domain/signing";

const key = await generateKeyPkcs8();
const signer = await createSigner(key);
console.log(`PASSPORT_SIGNING_KEY=${key}`);
console.log(`# key id: ${signer.kid}  public x: ${signer.publicKeys[0]?.x}`);
