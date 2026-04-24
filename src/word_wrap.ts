// ── Word wrap text to fit within a given width ──────────────────────────

export function wordWrap(text: string, width: number): string[] {
    const result: string[] = []
    for (const line of text.split("\n")) {
        if (line.length <= width) {
            result.push(line)
            continue
        }
        // Capture leading indentation to preserve on continuation lines
        const indentMatch = line.match(/^(\s*)/)
        const indent = indentMatch ? indentMatch[1] : ""
        let remaining = line
        let isFirstChunk = true
        while (remaining.length > width) {
            // Find last space within width
            let breakAt = remaining.lastIndexOf(" ", width)
            if (breakAt <= 0) {
                // No space found — hard break
                breakAt = width
            }
            result.push(remaining.slice(0, breakAt))
            remaining = remaining.slice(breakAt).replace(/^ /, "")
            if (isFirstChunk && indent) {
                // Prepend indentation to continuation lines
                remaining = indent + remaining
                isFirstChunk = false
            }
        }
        if (remaining.length > 0) {
            result.push(remaining)
        }
    }
    return result
}
