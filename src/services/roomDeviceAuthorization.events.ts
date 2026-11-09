import { EventEmitter } from 'events'

// In-process invalidation only. Multiple API/socket processes require a shared
// pub/sub bridge and Socket.IO adapter; status remains the source of truth.
const events = new EventEmitter()
type Listener = (privateIds: string[]) => void

export function onDeviceAuthorizationChanged(listener: Listener): () => void {
  events.on('changed', listener)
  return () => events.off('changed', listener)
}

export function deviceAuthorizationChanged(privateIds: string[] = []): void {
  // Socket delivery must never make a committed authorization mutation fail.
  try { events.emit('changed', privateIds) } catch { /* best effort */ }
}
