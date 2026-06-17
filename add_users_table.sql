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
