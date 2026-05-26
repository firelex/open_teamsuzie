// Re-export from the workspace-shared crypto package so shared-auth and
// other consumers (e.g. the PE settings host) cannot drift on the at-rest
// wire format. New helpers belong in `@teamsuzie/crypto`; this file exists
// only as a backward-compat shim for callers that still import from
// `../utils/encryption`.
export {
  encrypt,
  decrypt,
  deriveKey,
  hashApiKey,
  generateApiKey,
  verifyApiKey,
  generateSecureToken,
  type EncryptionResult,
} from '@teamsuzie/crypto';
