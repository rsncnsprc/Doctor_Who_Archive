-- ═══════════════════════════════════════════════════════
--  Gallifrey Archive — User Lists Migration
--  Run this in PostgreSQL after add_users_table.sql
-- ═══════════════════════════════════════════════════════

-- ── Favourites ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favourites (
    favourite_id  SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    episode_id    INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_favourites_user ON favourites(user_id);

-- ── Playlists ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playlists (
    playlist_id   SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name          VARCHAR(100) NOT NULL,
    description   TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);

-- ── Playlist Episodes (join table) ───────────────────────
CREATE TABLE IF NOT EXISTS playlist_episodes (
    id            SERIAL PRIMARY KEY,
    playlist_id   INTEGER NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE,
    episode_id    INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    added_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(playlist_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_episodes_playlist ON playlist_episodes(playlist_id);

-- ── Episode Notes ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS episode_notes (
    note_id       SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    episode_id    INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    note_text     TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_episode_notes_user    ON episode_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_episode_notes_episode ON episode_notes(episode_id);
