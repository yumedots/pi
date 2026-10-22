/**
 * The paths of the resources of a package.
 *
 * The packages belong to the server: it installs them and it resolves their resources. The
 * client only draws the paths, and the source info of a path is what both sides describe
 * with, so the shape of a resolved path lives here, in the package the two of them share.
 */

import type { SourceScope } from "./source-info.ts";

export interface PathMetadata {
	source: string;
	scope: SourceScope;
	origin: "package" | "top-level";
	baseDir?: string;
	packageRoot?: string;
}

export interface ResolvedResource {
	path: string;
	enabled: boolean;
	metadata: PathMetadata;
}

export interface ResolvedPaths {
	extensions: ResolvedResource[];
	skills: ResolvedResource[];
	prompts: ResolvedResource[];
	themes: ResolvedResource[];
}
