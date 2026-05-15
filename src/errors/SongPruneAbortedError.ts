export class SongPruneAbortedError extends Error {
  constructor(message = 'Song prune job was cancelled') {
    super(message)
    this.name = 'SongPruneAbortedError'
  }
}
