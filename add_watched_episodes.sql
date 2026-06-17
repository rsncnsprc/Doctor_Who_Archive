
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