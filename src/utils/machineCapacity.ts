export interface MachineInterval {
  start: Date
  end: Date | null
}

// Half-open intervals; missing end is considered occupied indefinitely.
export function hasMachineCapacity(capacity: number, requested: MachineInterval, existing: MachineInterval[]): boolean {
  const start = requested.start.getTime(),
    end = requested.end?.getTime()
  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    !Number.isFinite(start) ||
    end === undefined ||
    !Number.isFinite(end) ||
    end <= start
  )
    return false
  const events: Array<[number, number]> = [
    [start, 1],
    [end, -1]
  ]
  for (const item of existing) {
    const from = item.start.getTime(),
      to = item.end === null ? Infinity : item.end.getTime()
    if (!Number.isFinite(from) || (item.end !== null && !Number.isFinite(to)) || to <= from) return false
    if (from < end && to > start) events.push([Math.max(start, from), 1], [Math.min(end, to), -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let used = 0
  for (const [, change] of events) if ((used += change) > capacity) return false
  return true
}
