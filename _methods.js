
  // Remote Playlists (Subsonic)

  importRemotePlaylist(serverId, remoteId, name, remoteChanged) {
    const now = Date.now() / 1000;
    const result = this._db.prepare(
      "INSERT INTO playlists (name, created_at, updated_at, source, server_id, remote_id, remote_changed)
       VALUES (?, ?, ?, ^x27subsonic^x27, ?, ?, ?)"
