/**
 * The paths of the resources of a package.
 *
 * The packages belong to the server: it installs them and it resolves their
 * resources. The client only draws the paths, so it needs their shape and
 * nothing else.
 *
 * The types are type-only imports: they are erased before the runtime sees them,
 * so the client never loads the module that declares them.
 */

export type {
	PathMetadata,
	ResolvedPaths,
	ResolvedResource,
} from "@earendil-works/pi-support/path-metadata";
