-- Add optional profile picture support to existing users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
