const MAX_CONTRIBUTOR_NAME_LENGTH = 60;

/**
 * Tidy the name a guest typed before it is stored. It is shown in the change
 * log and in email subjects, so control characters (a newline would split a log
 * line or a header) are dropped, runs of whitespace collapse, and the length is
 * capped. Blank becomes null: "no name given", not an empty name.
 */
export function cleanContributorName(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const cleaned = [...raw]
        .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? ' ' : ch))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CONTRIBUTOR_NAME_LENGTH)
        .trim();
    return cleaned || null;
}
