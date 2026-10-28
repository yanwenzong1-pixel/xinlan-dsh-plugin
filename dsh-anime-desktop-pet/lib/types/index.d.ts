/**
 * dsh-anime-desktop-pet — host half.
 *
 * Serves the packaged animation GIF plus per-character three-view reference
 * images from the built package directory, so the client overlay references
 * real same-origin routes instead of inline data URLs.
 */
/** Plugin id shared by the client bundle, the profile row and the asset route. */
export declare const name = "dsh-anime-desktop-pet";
/** Host service needed to claim the asset routes. */
export declare const inject: string[];
/** Public route the client overlay loads the GIF from (keep in sync with core.mjs). */
export declare const GIF_ROUTE = "/@dsh-external/dsh-anime-desktop-pet/assets/blue-fat-fish-working.gif";
/** Prefix route for per-character three-view reference images (core.mjs threeView paths). */
export declare const THREE_VIEW_ROUTE = "/@dsh-external/dsh-anime-desktop-pet/assets/three-view/";
/** Prefix route for additional packaged animation GIFs (fixed desktop character). */
export declare const ANIMATED_ROUTE = "/@dsh-external/dsh-anime-desktop-pet/assets/animated/";
/** Prefix route for the transparent desktop live banner. */
export declare const BANNER_ROUTE = "/@dsh-external/dsh-anime-desktop-pet/assets/banner/";
/** Prefix route for the live-room scene (manifest/layout + @1x/@2x slices). */
export declare const SCENE_ROUTE = "/@dsh-external/dsh-anime-desktop-pet/assets/scene/";
/**
 * Resolve one safe flat image request under a route prefix. Traversal, nested
 * paths and non-image extensions return null; the resolved file must stay inside
 * the configured directory.
 */
export declare function resolveImageAsset(directory: string, urlPath: unknown, routePrefix: string): {
    file: string;
    contentType: string;
} | null;
/** Resolve a three-view image request. */
export declare function resolveThreeViewAsset(directory: string, urlPath: unknown): {
    file: string;
    contentType: string;
} | null;
/** Resolve an additional animation image request (fixed character GIF). */
export declare function resolveAnimatedAsset(directory: string, urlPath: unknown): {
    file: string;
    contentType: string;
} | null;
/** Resolve the desktop live banner image request (transparent PNG now, animated asset later). */
export declare function resolveBannerAsset(directory: string, urlPath: unknown): {
    file: string;
    contentType: string;
} | null;
/**
 * Resolve scene data: either manifest/layout JSON or one nested @1x/@2x PNG.
 * Traversal, arbitrary nested paths and other extensions are rejected.
 */
export declare function resolveSceneAsset(directory: string, urlPath: unknown): {
    file: string;
    contentType: string;
} | null;
/** Handler for the scene prefix route. */
export declare function createSceneHandler(directory: string): (req: any, res: any) => void;
/** Handler for one image prefix route; missing files read as 404, not as crashes. */
export declare function createImageHandler(directory: string, routePrefix: string): (req: any, res: any) => void;
/** Handler for the three-view prefix route. */
export declare function createThreeViewHandler(directory: string): (req: any, res: any) => void;
/** Handler for the additional-animation prefix route. */
export declare function createAnimatedHandler(directory: string): (req: any, res: any) => void;
/** Handler for the desktop live banner prefix route. */
export declare function createBannerHandler(directory: string): (req: any, res: any) => void;
/**
 * Register the asset routes; a missing asset or webServer degrades to no route.
 * @param ctx Cordis host context (typed loosely: external plugin, no DSH dependency).
 */
export declare function apply(ctx: any): void;
