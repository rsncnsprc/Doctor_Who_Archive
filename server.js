const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// load groq api key
let GROQ_API_KEY = '';
try {
    const envPath = path.join(__dirname, 'api_key.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/GROQ_API_KEY\s*=\s*(.+)/);
    if (match) GROQ_API_KEY = match[1].trim();
} catch (e) {
    console.warn('api_key.env not found or unreadable — AI search will be unavailable');
}

const app = express();
const PORT = 5000;

const JWT_SECRET = 'change_this_to_a_long_random_secret_before_going_public';
const JWT_EXPIRES_IN = '7d';

// middleware setup
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// database connection and verification
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'doctor_who_database_final',
    user: 'postgres',
    password: '31415'
});

// test the connection on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.message);
    } else {
        console.log('Connected to doctor_who_database_final');
        release();
    }
});

// auth middleware — check authorization header, validates jwt, and attaches user to request
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const token = authHeader.slice(7); // extract token after 'Bearer '
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function normalizeProfilePictureUrl(value) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > 2048) {
        throw new Error('Profile picture URL must be 2048 characters or fewer');
    }
    return trimmed;
}

function formatUser(row) {
    return {
        user_id: row.user_id,
        username: row.username,
        email: row.email,
        created_at: row.created_at,
        profile_picture_url: row.profile_picture_url || null
    };
}

function seriesClauseForTab(tab, alias = 'sr.series_name') {
    if (tab === 'Classic') {
        return { clause: ` AND ${alias} = $2`, params: ['Classic'] };
    }
    if (tab === 'Modern') {
        return { clause: ` AND ${alias} = $2`, params: ['Modern'] };
    }
    if (tab === 'New') {
        return { clause: ` AND ${alias} = $2`, params: ['NewEra'] };
    }
    return { clause: '', params: [] };
}

// post api/auth/register
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password, profile_picture_url } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email and password are all required' });
    }
    if (username.length < 3 || username.length > 50) {
        return res.status(400).json({ error: 'Username must be between 3 and 50 characters' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    let normalizedProfilePictureUrl;
    try {
        normalizedProfilePictureUrl = normalizeProfilePictureUrl(profile_picture_url);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        // check if username or email already exists (case-insensitive)
        const existing = await pool.query(
            'SELECT user_id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
            [username, email]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'That username or email is already registered' });
        }

        // hash password with bcrypt (cost factor: 12)
        const password_hash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash, profile_picture_url) VALUES ($1, $2, $3, $4) RETURNING user_id, username, email, created_at, profile_picture_url',
            [username, email, password_hash, normalizedProfilePictureUrl]
        );

        const user = result.rows[0];
        const token = jwt.sign(
            { user_id: user.user_id, username: user.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(201).json({
            token,
            user: formatUser(user)
        });

    } catch (err) {
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// post /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Please fill in both fields' });
    }

    try {
        // find user by email or username (not case sensitive)
        const result = await pool.query(
            'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)',
            [identifier]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Incorrect username/email or password' });
        }

        const user = result.rows[0];
        // verify password against stored hash
        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Incorrect username/email or password' });
        }

        const token = jwt.sign(
            { user_id: user.user_id, username: user.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            token,
            user: formatUser(user)
        });

    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

// get /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT user_id, username, email, created_at, profile_picture_url FROM users WHERE user_id = $1',
            [req.user.user_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: formatUser(result.rows[0]) });
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch user' });
    }
});

// put /api/auth/me — update profile picture
app.put('/api/auth/me', requireAuth, async (req, res) => {
    let normalizedProfilePictureUrl;
    try {
        normalizedProfilePictureUrl = normalizeProfilePictureUrl(req.body.profile_picture_url);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET profile_picture_url = $1 WHERE user_id = $2 RETURNING user_id, username, email, created_at, profile_picture_url',
            [normalizedProfilePictureUrl, req.user.user_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: formatUser(result.rows[0]) });
    } catch (err) {
        console.error('Update profile error:', err.message);
        res.status(500).json({ error: 'Could not update profile picture' });
    }
});


// get all favourites for the logged-in user
app.get('/api/favourites', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT f.favourite_id, f.created_at,
                   e.episode_id, e.episode_title, e.year_released, e.doctor_num,
                   e.imdb_rating, e.is_missing, e.plot_summary,
                   se.season_number, sr.series_name
            FROM favourites f
            JOIN episodes e ON e.episode_id = f.episode_id
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr ON se.series_id = sr.series_id
            WHERE f.user_id = $1
            ORDER BY f.created_at DESC
        `, [req.user.user_id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Get favourites error:', err.message);
        res.status(500).json({ error: 'Failed to fetch favourites' });
    }
});

// GET /api/favourites/ids — just the episode IDs (for quick button state check)
app.get('/api/favourites/ids', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT episode_id FROM favourites WHERE user_id = $1',
            [req.user.user_id]
        );
        res.json(result.rows.map(r => r.episode_id));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch favourite IDs' });
    }
});

// POST /api/favourites/:episodeId — toggle favourite
app.post('/api/favourites/:episodeId', requireAuth, async (req, res) => {
    const episodeId = parseInt(req.params.episodeId);
    try {
        const existing = await pool.query(
            'SELECT favourite_id FROM favourites WHERE user_id = $1 AND episode_id = $2',
            [req.user.user_id, episodeId]
        );

        if (existing.rows.length > 0) {
            await pool.query(
                'DELETE FROM favourites WHERE user_id = $1 AND episode_id = $2',
                [req.user.user_id, episodeId]
            );
            res.json({ favourited: false });
        } else {
            await pool.query(
                'INSERT INTO favourites (user_id, episode_id) VALUES ($1, $2)',
                [req.user.user_id, episodeId]
            );
            res.json({ favourited: true });
        }
    } catch (err) {
        console.error('Toggle favourite error:', err.message);
        res.status(500).json({ error: 'Failed to toggle favourite' });
    }
});

// DELETE /api/favourites/:episodeId — explicitly remove a favourite
app.delete('/api/favourites/:episodeId', requireAuth, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM favourites WHERE user_id = $1 AND episode_id = $2',
            [req.user.user_id, parseInt(req.params.episodeId)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove favourite' });
    }
});


// watched episodes

// GET /api/watched — all watched episodes for the logged-in user, optionally scoped by tab
app.get('/api/watched', requireAuth, async (req, res) => {
    try {
        const tab = req.query.tab;
        const { clause, params: seriesParams } = seriesClauseForTab(tab);

        const statsResult = await pool.query(`
            SELECT
                COUNT(e.episode_id)::int AS total_count,
                COUNT(we.watched_id)::int AS watched_count
            FROM episodes e
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr ON se.series_id = sr.series_id
            LEFT JOIN watched_episodes we
                ON we.episode_id = e.episode_id
               AND we.user_id = $1
            WHERE 1=1${clause}
        `, [req.user.user_id, ...seriesParams]);

        const watchedResult = await pool.query(`
            SELECT we.watched_id, we.watched_at,
                   e.episode_id, e.episode_title, e.year_released, e.doctor_num,
                   e.imdb_rating, e.is_missing, e.plot_summary,
                   se.season_number, sr.series_name
            FROM watched_episodes we
            JOIN episodes e ON e.episode_id = we.episode_id
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr ON se.series_id = sr.series_id
            WHERE we.user_id = $1${clause}
            ORDER BY we.watched_at DESC, e.year_released ASC NULLS LAST, se.season_number ASC NULLS LAST
        `, [req.user.user_id, ...seriesParams]);

        const stats = statsResult.rows[0] || { total_count: 0, watched_count: 0 };
        const watchedCount = Number(stats.watched_count) || 0;
        const totalCount = Number(stats.total_count) || 0;

        res.json({
            episodes: watchedResult.rows,
            stats: {
                watched_count: watchedCount,
                total_count: totalCount,
                percentage: totalCount > 0 ? Math.round((watchedCount / totalCount) * 100) : 0
            }
        });
    } catch (err) {
        console.error('Get watched error:', err.message);
        res.status(500).json({ error: 'Failed to fetch watched episodes' });
    }
});

// GET /api/watched/ids — just the episode IDs (for quick button state check)
app.get('/api/watched/ids', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT episode_id FROM watched_episodes WHERE user_id = $1',
            [req.user.user_id]
        );
        res.json(result.rows.map(r => r.episode_id));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch watched IDs' });
    }
});

// POST /api/watched/:episodeId — toggle watched
app.post('/api/watched/:episodeId', requireAuth, async (req, res) => {
    const episodeId = parseInt(req.params.episodeId);
    try {
        const existing = await pool.query(
            'SELECT watched_id FROM watched_episodes WHERE user_id = $1 AND episode_id = $2',
            [req.user.user_id, episodeId]
        );

        if (existing.rows.length > 0) {
            await pool.query(
                'DELETE FROM watched_episodes WHERE user_id = $1 AND episode_id = $2',
                [req.user.user_id, episodeId]
            );
            res.json({ watched: false });
        } else {
            await pool.query(
                'INSERT INTO watched_episodes (user_id, episode_id) VALUES ($1, $2)',
                [req.user.user_id, episodeId]
            );
            res.json({ watched: true });
        }
    } catch (err) {
        console.error('Toggle watched error:', err.message);
        res.status(500).json({ error: 'Failed to toggle watched state' });
    }
});

// DELETE /api/watched/:episodeId — explicitly remove watched state
app.delete('/api/watched/:episodeId', requireAuth, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM watched_episodes WHERE user_id = $1 AND episode_id = $2',
            [req.user.user_id, parseInt(req.params.episodeId)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove watched state' });
    }
});


// playlists

// GET /api/playlists — all playlists for the logged-in user
app.get('/api/playlists', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.playlist_id, p.name, p.description, p.created_at,
                   COUNT(pe.episode_id) AS episode_count
            FROM playlists p
            LEFT JOIN playlist_episodes pe ON pe.playlist_id = p.playlist_id
            WHERE p.user_id = $1
            GROUP BY p.playlist_id
            ORDER BY p.created_at DESC
        `, [req.user.user_id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Get playlists error:', err.message);
        res.status(500).json({ error: 'Failed to fetch playlists' });
    }
});

// GET /api/playlists/:id — a single playlist with its episodes
app.get('/api/playlists/:id', requireAuth, async (req, res) => {
    try {
        const playlistRes = await pool.query(
            'SELECT * FROM playlists WHERE playlist_id = $1 AND user_id = $2',
            [req.params.id, req.user.user_id]
        );
        if (playlistRes.rows.length === 0) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        const episodesRes = await pool.query(`
            SELECT e.episode_id, e.episode_title, e.year_released, e.doctor_num,
                   e.imdb_rating, e.is_missing, e.plot_summary,
                   se.season_number, sr.series_name, pe.added_at
            FROM playlist_episodes pe
            JOIN episodes e ON e.episode_id = pe.episode_id
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr ON se.series_id = sr.series_id
            WHERE pe.playlist_id = $1
            ORDER BY pe.added_at DESC
        `, [req.params.id]);

        res.json({ ...playlistRes.rows[0], episodes: episodesRes.rows });
    } catch (err) {
        console.error('Get playlist error:', err.message);
        res.status(500).json({ error: 'Failed to fetch playlist' });
    }
});

// POST /api/playlists — create a new playlist
app.post('/api/playlists', requireAuth, async (req, res) => {
    const { name, description } = req.body;
    if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Playlist name is required' });
    }
    if (name.length > 100) {
        return res.status(400).json({ error: 'Playlist name must be under 100 characters' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO playlists (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
            [req.user.user_id, name.trim(), description ? description.trim() : null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create playlist error:', err.message);
        res.status(500).json({ error: 'Failed to create playlist' });
    }
});

// PUT /api/playlists/:id — update name/description
app.put('/api/playlists/:id', requireAuth, async (req, res) => {
    const { name, description } = req.body;
    if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Playlist name is required' });
    }
    try {
        const result = await pool.query(
            'UPDATE playlists SET name = $1, description = $2 WHERE playlist_id = $3 AND user_id = $4 RETURNING *',
            [name.trim(), description ? description.trim() : null, req.params.id, req.user.user_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update playlist' });
    }
});

// DELETE /api/playlists/:id — delete a playlist
app.delete('/api/playlists/:id', requireAuth, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM playlists WHERE playlist_id = $1 AND user_id = $2',
            [req.params.id, req.user.user_id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete playlist' });
    }
});

// POST /api/playlists/:id/episodes/:episodeId — add episode to playlist
app.post('/api/playlists/:id/episodes/:episodeId', requireAuth, async (req, res) => {
    try {
        // verify user owns this playlist before allowing episode to be added
        const pl = await pool.query(
            'SELECT playlist_id FROM playlists WHERE playlist_id = $1 AND user_id = $2',
            [req.params.id, req.user.user_id]
        );
        if (pl.rows.length === 0) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        await pool.query(
            'INSERT INTO playlist_episodes (playlist_id, episode_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.params.id, req.params.episodeId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Add to playlist error:', err.message);
        res.status(500).json({ error: 'Failed to add episode to playlist' });
    }
});

// DELETE /api/playlists/:id/episodes/:episodeId — remove episode from playlist
app.delete('/api/playlists/:id/episodes/:episodeId', requireAuth, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM playlist_episodes WHERE playlist_id = $1 AND episode_id = $2',
            [req.params.id, parseInt(req.params.episodeId)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove episode from playlist' });
    }
});

// GET /api/playlists/episode/:episodeId — which playlists contain this episode?
app.get('/api/playlists/episode/:episodeId', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.playlist_id, p.name,
                   EXISTS(
                       SELECT 1 FROM playlist_episodes pe2
                       WHERE pe2.playlist_id = p.playlist_id AND pe2.episode_id = $2
                   ) AS has_episode
            FROM playlists p
            WHERE p.user_id = $1
            ORDER BY p.created_at DESC
        `, [req.user.user_id, req.params.episodeId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch playlists for episode' });
    }
});


// episode notes

// GET /api/notes — all notes for the logged-in user
app.get('/api/notes', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT n.note_id, n.note_text, n.created_at, n.updated_at,
                   e.episode_id, e.episode_title, e.year_released, e.doctor_num,
                   se.season_number
            FROM episode_notes n
            JOIN episodes e ON e.episode_id = n.episode_id
            LEFT JOIN seasons se ON e.season_id = se.season_id
            WHERE n.user_id = $1
            ORDER BY n.updated_at DESC
        `, [req.user.user_id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Get notes error:', err.message);
        res.status(500).json({ error: 'Failed to fetch notes' });
    }
});

// GET /api/notes/:episodeId — get the note for a specific episode
app.get('/api/notes/:episodeId', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM episode_notes WHERE user_id = $1 AND episode_id = $2',
            [req.user.user_id, req.params.episodeId]
        );
        res.json(result.rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch note' });
    }
});

// POST /api/notes/:episodeId — create or update a note (upsert)
app.post('/api/notes/:episodeId', requireAuth, async (req, res) => {
    const { note_text } = req.body;
    if (!note_text || note_text.trim().length === 0) {
        return res.status(400).json({ error: 'Note text cannot be empty' });
    }
    try {
        // upsert: insert new note or update existing one for this episode
        const result = await pool.query(`
            INSERT INTO episode_notes (user_id, episode_id, note_text, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id, episode_id)
            DO UPDATE SET note_text = EXCLUDED.note_text, updated_at = NOW()
            RETURNING *
        `, [req.user.user_id, req.params.episodeId, note_text.trim()]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Save note error:', err.message);
        res.status(500).json({ error: 'Failed to save note' });
    }
});

// DELETE /api/notes/:episodeId — delete a note
app.delete('/api/notes/:episodeId', requireAuth, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM episode_notes WHERE user_id = $1 AND episode_id = $2',
            [req.user.user_id, req.params.episodeId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete note' });
    }
});


// existing episode routes — unchanged

// GET /api/episodes
app.get('/api/episodes', async (req, res) => {
    try {
        const { doctor, season, min_rating, available, search, tab } = req.query;

        let query = `
            SELECT 
                e.episode_id,
                e.episode_title,
                e.plot_summary,
                e.year_released,
                e.doctor_num,
                e.imdb_rating,
                e.is_missing,
                e.setting,
                e.vibe_tags,
                e.episode_mood,
                e.companions,
                e.villains,
                e.story_title,
                e.episode_identifier,
                se.season_number,
                sr.series_name
            FROM episodes e
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr ON se.series_id = sr.series_id
            WHERE 1=1
        `;

        const params = [];
        let idx = 1;

        if (tab === 'Classic') {
            query += ` AND sr.series_name = $${idx++}`;
            params.push('Classic');
        } else if (tab === 'Modern') {
            query += ` AND sr.series_name = $${idx++}`;
            params.push('Modern');
        } else if (tab === 'New') {
            query += ` AND sr.series_name = $${idx++}`;
            params.push('NewEra');
        }

        if (doctor) {
            query += ` AND (e.doctor_num = $${idx} OR e.doctor_num LIKE $${idx+1} OR e.doctor_num LIKE $${idx+2} OR e.doctor_num LIKE $${idx+3})`;
            params.push(doctor, `${doctor},%`, `%, ${doctor},%`, `%, ${doctor}`);
            idx += 4;
        }
        if (season) {
            query += ` AND se.season_number = $${idx++}`;
            params.push(parseInt(season));
        }
        if (min_rating) {
            query += ` AND e.imdb_rating >= $${idx++}`;
            params.push(parseFloat(min_rating));
        }
        if (available === 'true') {
            query += ` AND e.is_missing = false`;
        } else if (available === 'false') {
            query += ` AND e.is_missing = true`;
        }
        if (search) {
            query += ` AND (
                LOWER(e.episode_title) LIKE LOWER($${idx}) OR
                LOWER(e.plot_summary) LIKE LOWER($${idx}) OR
                LOWER(e.villains) LIKE LOWER($${idx}) OR
                LOWER(e.companions) LIKE LOWER($${idx})
            )`;
            params.push(`%${search}%`);
            idx++;
        }

        query += ` ORDER BY
            e.year_released ASC NULLS LAST,
            se.season_number ASC NULLS LAST,
            CASE
                WHEN e.episode_identifier ~ '^[0-9]+$' THEN e.episode_identifier::int
                ELSE 9999
            END ASC,
            e.episode_id ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (err) {
        console.error('Error fetching episodes:', err.message);
        res.status(500).json({ error: 'Failed to fetch episodes' });
    }
});

// GET /api/episodes/:id
app.get('/api/episodes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            SELECT 
                e.episode_id,
                e.episode_title,
                e.plot_summary,
                e.year_released,
                e.doctor_num,
                e.imdb_rating,
                e.is_missing,
                e.setting,
                e.vibe_tags,
                e.episode_mood,
                e.companions,
                e.villains,
                e.story_title,
                e.episode_identifier,
                se.season_number,
                sr.series_name
            FROM episodes e
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr ON se.series_id = sr.series_id
            WHERE e.episode_id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Episode not found' });
        }

        res.json(result.rows[0]);

    } catch (err) {
        console.error('Error fetching episode:', err.message);
        res.status(500).json({ error: 'Failed to fetch episode' });
    }
});

// GET /api/doctors
app.get('/api/doctors', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT doctor_num 
            FROM episodes 
            WHERE doctor_num IS NOT NULL 
            ORDER BY doctor_num
        `);
        res.json(result.rows.map(r => r.doctor_num));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch doctors' });
    }
});

// GET /api/seasons
app.get('/api/seasons', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT season_id, season_number, series_id 
            FROM seasons 
            ORDER BY season_number ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch seasons' });
    }
});

// GET /api/filter-options
// Supports cross-filtering: pass ?tab=Classic&doctor=4 to get only seasons
// that Doctor 4 appears in (within Classic), and vice-versa for ?season=14.
app.get('/api/filter-options', async (req, res) => {
    try {
        const { tab, doctor, season } = req.query;

        // Build a series-name condition based on the active tab
        let seriesFilter = '';
        if (tab === 'Classic') {
            seriesFilter = `AND sr.series_name = 'Classic'`;
        } else if (tab === 'Modern') {
            seriesFilter = `AND sr.series_name = 'Modern'`;
        } else if (tab === 'New') {
            seriesFilter = `AND sr.series_name = 'NewEra'`;
        }

        // doctors list
        // when a season is selected, only return doctors that appear in that season
        const doctorParams = [];
        let doctorSeasonClause = '';
        if (season) {
            doctorSeasonClause = `AND se.season_number = $${doctorParams.length + 1}`;
            doctorParams.push(parseInt(season));
        }

        const doctorsResult = await pool.query(`
            SELECT DISTINCT e.doctor_num
            FROM episodes e
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr ON se.series_id = sr.series_id
            WHERE e.doctor_num IS NOT NULL
              AND e.doctor_num NOT LIKE '%,%'
              ${seriesFilter}
              ${doctorSeasonClause}
            ORDER BY e.doctor_num
        `, doctorParams);

        // seasons list
        // when a doctor is selected, only return seasons that doctor appears in
        const seasonParams = [];
        let seasonDoctorClause = '';
        if (doctor) {
            seasonDoctorClause = `AND (
                e.doctor_num = $${seasonParams.length + 1} OR
                e.doctor_num LIKE $${seasonParams.length + 2} OR
                e.doctor_num LIKE $${seasonParams.length + 3} OR
                e.doctor_num LIKE $${seasonParams.length + 4}
            )`;
            seasonParams.push(doctor, `${doctor},%`, `%, ${doctor},%`, `%, ${doctor}`);
        }

        const seasonsResult = await pool.query(`
            SELECT DISTINCT se.season_number
            FROM seasons se
            LEFT JOIN series sr ON se.series_id = sr.series_id
            INNER JOIN episodes e ON e.season_id = se.season_id
            WHERE se.season_number IS NOT NULL
              ${seriesFilter}
              ${seasonDoctorClause}
            ORDER BY se.season_number ASC
        `, seasonParams);

        res.json({
            doctors: doctorsResult.rows.map(r => r.doctor_num),
            seasons: seasonsResult.rows.map(r => r.season_number)
        });

    } catch (err) {
        console.error('Error fetching filter options:', err.message);
        res.status(500).json({ error: 'Failed to fetch filter options' });
    }
});

// ai search  (groq — free tier, llama-3.3-70b-versatile)

// post /api/ai-search
// body: { query: string, tab?: string }
// returns: { results: Episode[], explanation: string }
//
// strategy: use groq to parse intent and rank results, but keep token usage low by pre-filtering in sql.
// step 1 — ask groq to extract search intent (keywords, mood, setting, companions, etc.)
// step 2 — use that intent to build a sql where clause, fetching only ~30-60 candidate episodes
// step 3 — ask groq to rank/confirm those small candidate set against the original query
app.post('/api/ai-search', async (req, res) => {
    if (!GROQ_API_KEY) {
        return res.status(503).json({ error: 'AI search is not configured. Please add GROQ_API_KEY to api_key.env' });
    }

    const { query, tab } = req.body;
    if (!query || query.trim().length === 0) {
        return res.status(400).json({ error: 'Query is required' });
    }

    // helper function: call groq api with structured messages
    async function callGroq(messages, maxTokens = 512) {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                temperature: 0.1,
                max_tokens: maxTokens,
                messages
            })
        });
        if (!r.ok) {
            const txt = await r.text();
            throw new Error('Groq error: ' + txt);
        }
        const d = await r.json();
        return d.choices?.[0]?.message?.content || '';
    }

    function parseJSON(raw) {
        return JSON.parse(raw.replace(/```json|```/g, '').trim());
    }

    try {
        // step 1: intent extraction (tiny prompt, ~200 tokens)
        // Ask the model to parse the query into structured search intent.
        const intentRaw = await callGroq([
            {
                role: 'system',
                content: `You parse Doctor Who episode search queries into structured intent.
Return ONLY valid JSON, no markdown. Schema:
{
  "keywords": ["word1","word2"],        // general words to search in title/summary
  "mood": ["horror","tense","funny"],   // episode mood/atmosphere words
  "setting_past": true/false,           // episode set in the historical past
  "setting_future": true/false,         // episode set in the future / space
  "setting_contemporary": true/false,   // episode set in present-day Earth
  "companions_include": ["Amy","Rose"], // companion names that MUST appear
  "companions_exclude": ["River"],      // companion names that must NOT appear
  "villains_include": ["Daleks"],       // villain names that MUST appear
  "villains_exclude": [],
  "doctor_num": null                    // specific doctor number or null
}`
            },
            { role: 'user', content: `Query: "${query.trim()}"` }
        ], 400);

        let intent;
        try {
            intent = parseJSON(intentRaw);
        } catch {
            // If parsing fails, fall back to keyword-only search
            intent = { keywords: query.trim().split(/\s+/) };
        }

        // step 2: sql pre-filter — pull candidate episodes
        // Build a broad WHERE clause from the extracted intent so we only
        // send ~30-60 rows to Groq instead of the full table.
        const params = [];
        let idx = 1;
        const conditions = ['1=1'];

        // Era tab filter
        if (tab === 'Classic') {
            conditions.push(`sr.series_name = $${idx++}`);
            params.push('Classic');
        } else if (tab === 'Modern') {
            conditions.push(`sr.series_name = $${idx++}`);
            params.push('Modern');
        } else if (tab === 'New') {
            conditions.push(`sr.series_name = $${idx++}`);
            params.push('NewEra');
        }

        // Build OR clauses for broad keyword / mood / setting matching
        const orParts = [];

        const allKeywords = [
            ...(intent.keywords || []),
            ...(intent.mood || [])
        ].filter(k => k && k.length > 2);

        for (const kw of allKeywords) {
            const p = `%${kw}%`;
            params.push(p, p, p, p, p);
            orParts.push(`(
                LOWER(e.episode_title)  LIKE LOWER($${idx})   OR
                LOWER(e.plot_summary)   LIKE LOWER($${idx+1}) OR
                LOWER(e.episode_mood)   LIKE LOWER($${idx+2}) OR
                LOWER(e.vibe_tags)      LIKE LOWER($${idx+3}) OR
                LOWER(e.setting)        LIKE LOWER($${idx+4})
            )`);
            idx += 5;
        }

        // Setting inference
        if (intent.setting_past) {
            params.push('%past%', '%histor%', '%medieval%', '%victorian%', '%ancient%', '%century%', '%war%');
            orParts.push(`(LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}))`);
        }
        if (intent.setting_future) {
            params.push('%future%', '%space%', '%spaceship%', '%planet%', '%alien%', '%sci-fi%');
            orParts.push(`(LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}))`);
        }
        if (intent.setting_contemporary) {
            params.push('%contemporary%', '%present%', '%modern earth%', '%london%');
            orParts.push(`(LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}) OR LOWER(e.setting) LIKE LOWER($${idx++}))`);
        }

        // Companions / villains to include → narrow to episodes that have them
        for (const name of (intent.companions_include || [])) {
            params.push(`%${name}%`);
            conditions.push(`LOWER(e.companions) LIKE LOWER($${idx++})`);
        }
        for (const name of (intent.villains_include || [])) {
            params.push(`%${name}%`);
            conditions.push(`LOWER(e.villains) LIKE LOWER($${idx++})`);
        }

        // Companions / villains to exclude → hard filter them out
        for (const name of (intent.companions_exclude || [])) {
            params.push(`%${name}%`);
            conditions.push(`(e.companions IS NULL OR LOWER(e.companions) NOT LIKE LOWER($${idx++}))`);
        }
        for (const name of (intent.villains_exclude || [])) {
            params.push(`%${name}%`);
            conditions.push(`(e.villains IS NULL OR LOWER(e.villains) NOT LIKE LOWER($${idx++}))`);
        }

        // Doctor filter
        if (intent.doctor_num) {
            const d = String(intent.doctor_num);
            params.push(d, `${d},%`, `%, ${d},%`, `%, ${d}`);
            conditions.push(`(e.doctor_num = $${idx} OR e.doctor_num LIKE $${idx+1} OR e.doctor_num LIKE $${idx+2} OR e.doctor_num LIKE $${idx+3})`);
            idx += 4;
        }

        // If we have OR clauses, add them as a group
        if (orParts.length > 0) {
            conditions.push('(' + orParts.join(' OR ') + ')');
        }

        const candidateSQL = `
            SELECT
                e.episode_id, e.episode_title, e.plot_summary, e.year_released,
                e.doctor_num, e.imdb_rating, e.is_missing, e.setting,
                e.vibe_tags, e.episode_mood, e.companions, e.villains,
                e.story_title, e.episode_identifier,
                se.season_number, sr.series_name
            FROM episodes e
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr  ON se.series_id = sr.series_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY e.episode_id ASC
            LIMIT 60
        `;

        let candidates = (await pool.query(candidateSQL, params)).rows;

        // if sql found nothing (e.g. very abstract or niche query), grab a random sample
        // to give groq some episodes to work with
        if (candidates.length === 0) {
            const fallbackParams = [];
            let fallbackWhere = '1=1';
            if (tab === 'Classic') { fallbackWhere += ` AND sr.series_name = $1`; fallbackParams.push('Classic'); }
            else if (tab === 'Modern') { fallbackWhere += ` AND sr.series_name = $1`; fallbackParams.push('Modern'); }
            else if (tab === 'New') { fallbackWhere += ` AND sr.series_name = $1`; fallbackParams.push('NewEra'); }

            // Also honour hard excludes in fallback
            let exIdx = fallbackParams.length + 1;
            for (const name of (intent.companions_exclude || [])) {
                fallbackParams.push(`%${name}%`);
                fallbackWhere += ` AND (e.companions IS NULL OR LOWER(e.companions) NOT LIKE LOWER($${exIdx++}))`;
            }
            for (const name of (intent.villains_exclude || [])) {
                fallbackParams.push(`%${name}%`);
                fallbackWhere += ` AND (e.villains IS NULL OR LOWER(e.villains) NOT LIKE LOWER($${exIdx++}))`;
            }

            candidates = (await pool.query(`
                SELECT e.episode_id, e.episode_title, e.plot_summary, e.year_released,
                       e.doctor_num, e.imdb_rating, e.is_missing, e.setting,
                       e.vibe_tags, e.episode_mood, e.companions, e.villains,
                       e.story_title, e.episode_identifier, se.season_number, sr.series_name
                FROM episodes e
                LEFT JOIN seasons se ON e.season_id = se.season_id
                LEFT JOIN series sr  ON se.series_id = sr.series_id
                WHERE ${fallbackWhere}
                ORDER BY RANDOM() LIMIT 50
            `, fallbackParams)).rows;
        }

        if (candidates.length === 0) {
            return res.json({ results: [], explanation: 'No episodes found in this era.' });
        }

        // step 3: ask groq to rank the small candidate set
        // Compact representation — strip plot_summary to 120 chars to save tokens
        const catalogue = candidates.map(ep => ({
            id:  ep.episode_id,
            t:   ep.episode_title,
            y:   ep.year_released,
            dr:  ep.doctor_num,
            mood: ep.episode_mood,
            set: ep.setting,
            vibe: ep.vibe_tags,
            comp: ep.companions,
            vil:  ep.villains,
            s:   ep.plot_summary ? ep.plot_summary.slice(0, 120) : null
        }));

        const rankRaw = await callGroq([
            {
                role: 'system',
                content: `You are a Doctor Who episode search assistant. Given a small JSON catalogue and a user query, return the best matching episode IDs.
Rules:
- "scary"/"horror" → mood/vibe matching; "in the past" → historical setting; "in the future" → futuristic/space setting.
- Honour exclusions ("but not X", "without X") — do NOT include excluded characters.
- Return ONLY valid JSON: { "episode_ids": [1,2,3], "explanation": "one sentence" }
- Up to 15 results. episode_ids must be integers from the catalogue "id" field.`
            },
            {
                role: 'user',
                content: `Catalogue: ${JSON.stringify(catalogue)}

Query: "${query.trim()}"

Return JSON.`
            }
        ], 512);

        let aiResult;
        try {
            aiResult = parseJSON(rankRaw);
        } catch {
            console.error('Failed to parse Groq rank response:', rankRaw);
            return res.status(500).json({ error: 'AI returned an unexpected format. Try rephrasing your query.' });
        }

        const matchedIds = new Set((aiResult.episode_ids || []).map(Number));
        const matchedEpisodes = candidates.filter(ep => matchedIds.has(ep.episode_id));

        res.json({
            results: matchedEpisodes,
            explanation: aiResult.explanation || ''
        });

    } catch (err) {
        console.error('AI search error:', err.message);
        // Surface Groq rate-limit errors clearly to the user
        if (err.message.includes('rate_limit_exceeded')) {
            return res.status(429).json({ error: 'Groq rate limit hit — wait a moment and try again.' });
        }
        res.status(500).json({ error: 'AI search failed: ' + err.message });
    }
});

// geo proxy  — browser can't call ip-api directly due to cors;
// the server makes the request instead and forwards the result.

// GET /api/geo  →  { countryCode: "BG", countryName: "Bulgaria" }
app.get('/api/geo', async (req, res) => {
    // extract the real client ip from request (may be behind a proxy)
    const clientIp =
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket.remoteAddress ||
        '';

    // when running on localhost, ip-api returns a special result based on the server's ip
    // so we omit the ip parameter and let ip-api auto-detect from our outgoing connection
    // check if running locally
    const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '';
    // ip-api url: omit ip parameter for localhost (auto-detect), provide ip for production
    const url = isLocal
        ? 'http://ip-api.com/json/?fields=status,country,countryCode'
        : `http://ip-api.com/json/${clientIp}?fields=status,country,countryCode`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== 'success') {
            return res.status(502).json({ error: 'Geo lookup failed' });
        }

        res.json({ countryCode: data.countryCode, countryName: data.country });
    } catch (err) {
        console.error('Geo proxy error:', err.message);
        res.status(502).json({ error: 'Geo lookup unavailable' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
