import { resolve } from "jsr:@std/path@1/resolve"

// ── ~200 common keyboard emojis for hashing ──────────────────────────────

const EMOJI_POOL = [
    // Faces
    "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉",
    "😊", "😇", "😍", "🤩", "😘", "😋", "😜", "🤪", "😝", "🤑",
    "🤗", "🤔", "🤐", "😐", "😑", "😶", "😏", "😒", "🙄", "😬",
    "😮", "😯", "😲", "😳", "🥺", "😢", "😭", "😤", "😡", "🤬",
    "😈", "👿", "💀", "👻", "👽", "🤖", "💩", "🤡", "👹", "👺",
    // Hands
    "👋", "🤚", "✋", "🖖", "👌", "🤌", "🤏", "✌", "🤞", "🤟",
    "🤘", "🤙", "👈", "👉", "👆", "👇", "☝", "👍", "👎", "✊",
    "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🙏", "💪",
    // Animals
    "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
    "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦅",
    "🦉", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🐢", "🐍", "🦎",
    "🐙", "🦑", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🦈", "🐊",
    // Fruits & food
    "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈",
    "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🍆", "🥦",
    "🌽", "🌶", "🥕", "🧄", "🧅", "🥔", "🍠", "🥐", "🍞", "🥖",
    "🧀", "🥚", "🍳", "🥓", "🥩", "🍗", "🍖", "🌭", "🍔", "🍟",
    "🍕", "🌮", "🌯", "🥙", "🧆", "🥗", "🍝", "🍜", "🍲", "🍛",
    // Objects & symbols
    "⭐", "🌟", "💫", "✨", "🔥", "💥", "❄️", "🌈", "☀️", "🌙",
    "⚡", "💧", "🌊", "🎯", "🎲", "🎮", "🕹️", "🎸", "🎺", "🥁",
    "🔔", "🔑", "🗝️", "💎", "🧲", "🔮", "🧿", "🪬", "🎀", "🎁",
    // Flags & misc
    "🏁", "🚩", "🏳️", "🏴", "🏺", "🗿", "🪨", "🌵", "🎄", "🌲",
]

// Strip variation selectors (U+FE0F) that break terminal width calculations
const CLEAN_POOL = EMOJI_POOL.map(e => e.replace(/\uFE0F/g, ""))

// ── Hash a string to 3 emojis ────────────────────────────────────────────

function hashCode(s: string): number {
    let hash = 0
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash)
}

export function emojiHash(input: string): string {
    const poolSize = CLEAN_POOL.length
    const h = hashCode(input)
    // Use different parts of the hash for each emoji position
    const e1 = CLEAN_POOL[h % poolSize]
    const e2 = CLEAN_POOL[Math.abs((h >>> 8) ^ (h * 31)) % poolSize]
    const e3 = CLEAN_POOL[Math.abs((h >>> 16) ^ (h * 127)) % poolSize]
    return `${e1}${e2}${e3}`
}

// ── Sanitize a string for use as a directory name ────────────────────────

export function sanitizeDirName(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9\-_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
}

// ── Build a dir name: sanitized + emoji hash suffix ──────────────────────

function dirLabel(name: string): string {
    return `${sanitizeDirName(name)}_${emojiHash(name)}`
}

// ── Build the state file path ────────────────────────────────────────────

export function stateDir(remote: string, branch: string): string {
    const home = Deno.env.get("HOME")!
    return resolve(home, ".gre", dirLabel(remote), dirLabel(branch))
}

export function statePath(remote: string, branch: string): string {
    return resolve(stateDir(remote, branch), "state.yaml")
}
