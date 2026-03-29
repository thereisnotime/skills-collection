/**
 * Validate ssh-edit-block arguments: anchor-only, no text replace.
 * @returns {string|null} error message or null if valid
 */
export function validateEditArgs(args) {
    const hasAnchor = !!args.anchor;
    const hasInsert = !!args.insertAfter;
    const hasRangeStart = !!args.startAnchor;
    const hasRangeEnd = !!args.endAnchor;

    // Partial range first (before mode count)
    if (hasRangeStart && !hasRangeEnd) {
        return 'Incomplete range: startAnchor requires endAnchor.';
    }
    if (!hasRangeStart && hasRangeEnd) {
        return 'Incomplete range: endAnchor requires startAnchor.';
    }

    const hasRange = hasRangeStart && hasRangeEnd;
    const modeCount = [hasAnchor, hasRange, hasInsert].filter(Boolean).length;

    if (modeCount === 0) {
        return 'Required: anchor, startAnchor + endAnchor, or insertAfter. Use ssh-read-lines first to get hash anchors.';
    }
    if (modeCount > 1) {
        return 'Conflicting edit modes: provide exactly one of anchor, startAnchor + endAnchor, or insertAfter.';
    }

    if (args.newText === undefined) {
        return 'Required: newText (replacement content for anchor/range/insert edit).';
    }

    return null;
}
