/**
 * True on browsers that will not save a file unless a user activation is live at
 * the moment the save starts.
 *
 * Every save in this app is behind a click, so the distinction is not clicked vs
 * not clicked — it is *when*. A browser attributes a download to a live
 * activation on the document, not to whichever element JS clicked, and an
 * activation is transient (Chrome's window is about five seconds, and some APIs
 * consume it outright). A `.click()` synthesized after `await fetch(...)` carries
 * none of its own, so the tap that started it has already expired: the download
 * arrives with no gesture behind it.
 *
 * Chrome then runs it through a per-tab state machine. A fresh navigation starts
 * at ALLOW_ONE_DOWNLOAD, so the first such save goes through; it then moves to
 * PROMPT_BEFORE_DOWNLOAD, where every later one needs the user to allow multiple
 * downloads — a tab shows a permission bubble, an installed PWA has nowhere to
 * show it and the save is refused. Mobile WebKit reaches the same place by its
 * own route. Neither reports any of this: the fetch succeeded, the click was
 * accepted, and no file exists.
 *
 * So the bytes have to already be in hand when the user taps, which is the whole
 * reason DownloadProvider parks finished blobs instead of saving them. One
 * activation authorizes one download, so a loop of clicks inside a single tap
 * still saves a single file — a batch is either one tap per file or one
 * navigator.share() call.
 *
 * Deliberately platform-based rather than viewport-based: rotating a phone into
 * landscape can push it past a width breakpoint, and the download policy does
 * not change when it does.
 */
export function blocksAutomaticDownloads(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPadOS reports itself as a Mac, so touch points are what give it away.
    const isIpadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isIpadOS;
}
