CREATE TABLE IF NOT EXISTS users (
    user_id       SERIAL PRIMARY KEY,
    username      VARCHAR(50)  UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    profile_picture_url TEXT,
    created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Index for fast lookup by email and username on login
CREATE INDEX IF NOT EXISTS idx_users_email    ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username ON users (LOWER(username));

-- Favourites 
CREATE TABLE IF NOT EXISTS favourites (
    favourite_id  SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    episode_id    INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_favourites_user ON favourites(user_id);

-- Playlists
CREATE TABLE IF NOT EXISTS playlists (
    playlist_id   SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name          VARCHAR(100) NOT NULL,
    description   TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);

-- Playlist Episodes (join table)
CREATE TABLE IF NOT EXISTS playlist_episodes (
    id            SERIAL PRIMARY KEY,
    playlist_id   INTEGER NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE,
    episode_id    INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    added_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(playlist_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_episodes_playlist ON playlist_episodes(playlist_id);

-- Episode Notes
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

--  Gallifrey Archive — Watched Episodes Migration
CREATE TABLE IF NOT EXISTS watched_episodes (
    watched_id    SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    episode_id    INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    watched_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_watched_episodes_user    ON watched_episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_watched_episodes_episode ON watched_episodes(episode_id);

-- Add optional profile picture support to existing users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;