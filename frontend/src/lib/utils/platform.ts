/**
 * True on browsers where the page cannot be the thing that saves a file, and the
 * download has to be handed to the browser's own download manager instead.
 *
 * Every save in this app is behind a click, so the distinction is not clicked vs
 * not clicked — it is *when*. A browser attributes a download to a live user
 * activation on the document, not to whichever element JS clicked, and activation
 * is transient. A `.click()` synthesized after `await fetch(...)` carries none of
 * its own, so the tap that started it has already expired.
 *
 * Chrome runs such a download through a per-tab state machine: a fresh navigation
 * starts at ALLOW_ONE_DOWNLOAD, so the first one lands, and it then moves to
 * PROMPT_BEFORE_DOWNLOAD, where the rest need the user to allow multiple downloads
 * — a tab shows a permission bubble, an installed PWA has nowhere to show it. That
 * is the whole shape of the bug this exists for: the first save of a page load
 * works, the second is refused, a reload buys exactly one more, and in a batch only
 * file one arrives.
 *
 * Restructuring the page's own save path does not fix it. Moving the save into a
 * tap, with the bytes already in hand, still failed on Android Chrome as an
 * installed PWA — the download manager posted a notification and no file appeared.
 * A page-held blob is simply not a first-class download there.
 *
 * So on these platforms the page does not save anything. It points the browser at a
 * URL the server marks as an attachment and the download manager does the rest,
 * which is the one path that is reliable, repeatable, and visible to the user. See
 * DownloadProvider's handOffToBrowser.
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
