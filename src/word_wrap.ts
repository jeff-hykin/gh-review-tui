// ── Word wrap text to fit within a given width ──────────────────────────

export function wordWrap(text: string, width: number): string[] {
    const result: string[] = []
    for (const line of text.split("\n")) {
        if (line.length <= width) {
            result.push(line)
            continue
        }
        let remaining = line
        while (remaining.length > width) {
            // Find last space within width
            let breakAt = remaining.lastIndexOf(" ", width)
            if (breakAt <= 0) {
                // No space found — hard break
                breakAt = width
            }
            result.push(remaining.slice(0, breakAt))
            remaining = remaining.slice(breakAt).replace(/^ /, "")
        }
        if (remaining.length > 0) {
            result.push(remaining)
        }
    }
    return result
}
