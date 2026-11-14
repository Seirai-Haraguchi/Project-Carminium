'use strict';

const { parentPort, workerData } = require('worker_threads');

let separators = (workerData && workerData.separators) || ';';
let library = null;

function getLibrary() {
  if (library) return library;
  const { MusicLibrary } = require('./library');
  library = new MusicLibrary({
    dataDir: workerData.dataDir,
    get: (key, fallback) => key === 'artist_separators' ? separators : fallback,
  });
  return library;
}

function post(message) {
  try { parentPort.postMessage(message); } catch { }
}

function status(id, payload) {
  post({ type: 'update_status', id, ...payload });
}

function progressFor(id, serverId, mapper) {
  return (value) => status(id, {
    server_id: serverId,
    stage: 'progress',
    ...mapper(value || {}),
  });
}

async function handle(message) {
  const { id, type, config = {}, options = {} } = message;
  if (type === 'set_separators') {
    separators = options.value || ';';
    post({ id, ok: true, result: true });
    return;
  }

  try {
    const lib = getLibrary();
    const serverId = Number(config.id);
    status(id, { server_id: serverId, stage: 'start', kind: type });

    let stats;
    if (type === 'subsonic') {
      const { SubsonicClient, syncServerToLibrary, prefetchCovers } = require('./subsonic');
      const { subsonicTrackId } = require('./library');
      const client = new SubsonicClient(
        config.server_url, config.username, config.password,
        config.protocol_mode || 'subsonic', 60.0
      );
      stats = await syncServerToLibrary(client, lib, serverId, {
        prefetchCovers: false,
        progressCb: progressFor(id, serverId, (s) => ({
          phase: s.phase || 'tracks', artists: s.artists || 0, albums: s.albums || 0,
          tracks: s.tracks || 0, total: s.total || 0, done: s.done || 0,
          current_artist: s.current_artist || '', current_album: s.current_album || '',
        })),
      });
      if (!stats.error) {
        try {
          const playlists = await client.getPlaylists();
          const serverPlaylistIds = new Set();
          for (const playlistInfo of (playlists || [])) {
            try {
              const remote = await client.getPlaylist(playlistInfo.id);
              if (!remote || !remote.tracks) continue;
              serverPlaylistIds.add(String(playlistInfo.id));
              const existing = lib.findRemotePlaylist(serverId, playlistInfo.id);
              const playlist = existing
                ? (lib.updateRemotePlaylist(existing.id, remote.name, remote.changed, remote.cover_art_id, remote.owner), existing)
                : lib.importRemotePlaylist(serverId, playlistInfo.id, remote.name, remote.changed, remote.cover_art_id, remote.owner);
              lib.upsertSubsonicTracksBatch(serverId, remote.tracks);
              lib.replacePlaylistTracks(playlist.id, remote.tracks.map((track) => subsonicTrackId(serverId, track.id)));
              if (remote.owner) {
                try {
                  const user = await client.getUser(remote.owner);
                  if (user && user.email) lib.updatePlaylistOwnerEmail(playlist.id, user.email);
                } catch { }
              }
            } catch (error) {
              stats.warnings.push('歌单同步失败(' + playlistInfo.id + '): ' + (error.message || error));
            }
          }
          for (const local of lib.listRemotePlaylists(serverId)) {
            if (!serverPlaylistIds.has(String(local.remote_id))) {
              try { lib.deletePlaylist(local.id); } catch { }
            }
          }
          status(id, { server_id: serverId, stage: 'playlists_done' });
        } catch (error) {
          stats.warnings.push('远程歌单同步失败: ' + (error.message || error));
        }
        try {
          if (stats.pending_covers && stats.pending_covers.length) {
            stats.covers = await prefetchCovers(client, lib, serverId, stats.pending_covers);
          }
        } catch (error) {
          stats.warnings.push('封面预缓存失败: ' + (error.message || error));
        }
      }
    } else if (type === 'webdav') {
      const { WebDAVClient, syncServerToLibrary } = require('./webdav');
      const client = new WebDAVClient(config.server_url, config.username, config.password, 60.0);
      stats = await syncServerToLibrary(client, lib, serverId, {
        progressCb: progressFor(id, serverId, (s) => ({
          phase: s.phase || 'tracks', tracks: s.tracks || 0,
          current_file: s.current_file || s.current_path || '',
        })),
      });
    } else if (type === 'smb') {
      const { SMBClient, syncServerToLibrary } = require('./smb');
      const client = new SMBClient(
        config.host, config.share_name, config.username, config.password,
        config.domain || '', 60.0
      );
      stats = await syncServerToLibrary(client, lib, serverId, {
        progressCb: progressFor(id, serverId, (s) => ({
          phase: s.phase || 'scanning', tracks: s.tracks || 0,
          current_path: s.current_path || '',
        })),
      });
      if (client.connected) {
        try { await client.disconnect(); } catch { }
      }
    } else {
      throw new Error('unknown library update type: ' + type);
    }

    if (!stats.error) {
      if (type === 'subsonic') lib.updateSubsonicServerLastSync(serverId);
      else if (type === 'webdav') lib.updateWebDAVServerLastSync(serverId);
      else if (type === 'smb') lib.updateSMBServerLastSync(serverId);
    }
    post({ id, ok: true, result: stats || null });
  } catch (error) {
    post({
      id, ok: false, name: error && error.name, code: error && error.code,
      error: error && error.message ? error.message : String(error),
    });
  }
}

parentPort.on('message', (message) => {
  if (message && typeof message === 'object') handle(message);
});
