/**
 * True on browsers where the page cannot be the thing that saves a file, and each
 * download has to be handed to the browser's own download manager in a tab of its
 * own.
 *
 * The rule being worked around is Chrome's download limiter, and its state is per
 * *tab*. A tab starts at ALLOW_ONE_DOWNLOAD; once that is spent it moves to
 * PROMPT_BEFORE_DOWNLOAD, where every later download waits for the user to allow
 * multiple downloads for the site. An installed PWA has nowhere to show that
 * request, so the download manager accepts the download, posts a notification, and
 * then waits forever. Modern Chromium resets the state only on a user-initiated
 * navigation — which is why a reload buys exactly one more download.
 *
 * Three things were tried inside one tab before that was understood, and they fail
 * identically because they all spend the same single allowance: saving a fetched
 * blob (the original bug), saving a blob from inside a tap (notification, no file),
 * and a top-level navigation to an attachment URL (notification, then a hang).
 * Frames do not have their own state either; they share the tab's.
 *
 * A page-held blob turned out not to be a first-class download here regardless, so
 * both halves matter: the bytes come from a URL the server marks as an attachment,
 * and the navigation to it happens in a new tab. See DownloadProvider.
 *
 * The other way out is the site's "Automatic downloads" permission, which stops the
 * limiter asking at all — but it is a per-device setting a page can neither request
 * nor detect, so it cannot be what this depends on.
 *
 * Deliberately platform-based rather than viewport-based: rotating a phone into
 * landscape can push it past a width breakpoint, and the download policy does not
 * change when it does.
 */
export function blocksAutomaticDownloads(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPadOS reports itself as a Mac, so touch points are what give it away.
    const isIpadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isIpadOS;
}
