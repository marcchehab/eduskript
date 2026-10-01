const FENCE_RE = /^[ \t]*(```|~~~)/

/** Char ranges (incl. the fence lines themselves) covered by ``` / ~~~ fenced blocks. */
export function fencedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let inFence = false
  let fenceStart = 0
  let offset = 0
  for (const line of content.split('\n')) {
    if (FENCE_RE.test(line)) {
      if (!inFence) {
        inFence = true
        fenceStart = offset
      } else {
        inFence = false
        ranges.push([fenceStart, offset + line.length])
      }
    }
    offset += line.length + 1 // +1 for the '\n' split away
  }
  return ranges
}
