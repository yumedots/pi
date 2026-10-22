/**
 * The image types of the photon helper.
 *
 * The client draws the images of the session. It needs the shape of the image
 * the helper hands back, not the helper itself.
 *
 * The type is a type-only import: it is erased before the runtime sees it, so the
 * client never loads the helper.
 */

export type { PhotonImage as PhotonImageType } from "@silvia-odwyer/photon-node";
