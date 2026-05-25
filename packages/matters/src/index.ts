/**
 * @teamsuzie/matters — composition layer for the Matters workspace.
 *
 * "Matter" is the user-facing label for a multi-document workspace within
 * an agent (legal: matter, M&A: deal, healthcare: case, consulting:
 * engagement — re-skinnable via `manifest.matters.label`). This package
 * does NOT define new data tables: matter rows live in
 * `@teamsuzie/workspaces` (already a generic doc-container store) and
 * member rows live in `@teamsuzie/sharing`. What this package contributes
 * is the wiring that turns those generic primitives into the matter
 * surface a build mounts behind `modules.matters`:
 *
 *   - matter-uploads router (multipart → fileStore[bucket=matterId] +
 *     workspaces.addDocument + documentVersions.addVersion('upload'))
 *   - requireMatterAccess middleware + backfillMatterOwnership
 *   - matter-members router (owner-only mutations; last-owner block)
 *
 * Router exports are added as each piece lands. For now the package
 * exports the SubjectRef.type constant that callers use against the
 * shared MembersStore.
 */
export { SUBJECT_MATTER } from './constants.js';
export { createMatterUploadsRouter } from './uploads-router.js';
export type {
    CreateMatterUploadsRouterOptions,
    MatterFileRecord,
    MatterFileStore,
} from './uploads-router.js';
export {
    backfillMatterOwnership,
    createRequireMatterAccess,
} from './access-middleware.js';
export type {
    BackfillMatterOwnershipOptions,
    CreateRequireMatterAccessOptions,
    GetSessionUser,
} from './access-middleware.js';
