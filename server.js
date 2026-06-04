const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;

// ── Change this to a long random string in production! ──────
// e.g. run: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
const JWT_SECRET = 'change_this_to_a_long_random_secret_before_going_public';
const JWT_EXPIRES_IN = '7d'; // token lasts 7 days

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ── Database connection ──────────────────────────────────────
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'doctor_who_database_final',
    user: 'postgres',
    password: '31415'
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.message);
    } else {
        console.log('Connected to doctor_who_database_final');
        release();
    }
});

// ── Auth middleware ──────────────────────────────────────────
// Use this on any future route that needs a logged-in user.
// e.g. app.get('/api/playlists', requireAuth, async (req, res) => { ... })
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const token = authHeader.slice(7);
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── POST /api/auth/register ──────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;

    // Basic validation
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

    try {
        // Check if username or email already taken
        const existing = await pool.query(
            'SELECT user_id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
            [username, email]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'That username or email is already registered' });
        }

        // Hash password — cost factor 12 is good for a diploma project
        const password_hash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id, username, email, created_at',
            [username, email, password_hash]
        );

        const user = result.rows[0];
        const token = jwt.sign(
            { user_id: user.user_id, username: user.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(201).json({
            token,
            user: { user_id: user.user_id, username: user.username, email: user.email, created_at: user.created_at }
        });

    } catch (err) {
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ── POST /api/auth/login ─────────────────────────────────────
// Accepts username OR email in the `identifier` field
app.post('/api/auth/login', async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Please fill in both fields' });
    }

    try {
        // Look up by email or username (case-insensitive)
        const result = await pool.query(
            'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)',
            [identifier]
        );

        if (result.rows.length === 0) {
            // Deliberately vague message to not reveal whether the account exists
            return res.status(401).json({ error: 'Incorrect username/email or password' });
        }

        const user = result.rows[0];
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
            user: { user_id: user.user_id, username: user.username, email: user.email, created_at: user.created_at }
        });

    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ── GET /api/auth/me ─────────────────────────────────────────
// Frontend calls this on load to verify a stored token is still valid
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT user_id, username, email, created_at FROM users WHERE user_id = $1',
            [req.user.user_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch user' });
    }
});


// ════════════════════════════════════════════════════════════
// Existing episode routes below — unchanged
// ════════════════════════════════════════════════════════════

// GET /api/episodes
app.get('/api/episodes', async (req, res) => {
    try {
        const { doctor, season, min_rating, available, search } = req.query;

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

        query += ` ORDER BY e.episode_id ASC`;

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
app.get('/api/filter-options', async (req, res) => {
    try {
        const { tab } = req.query;

        let seriesFilter = '';
        if (tab === 'Classic') {
            seriesFilter = `AND LOWER(sr.series_name) LIKE '%classic%'`;
        } else if (tab === 'Modern') {
            seriesFilter = `AND LOWER(sr.series_name) LIKE '%modern%'`;
        } else if (tab === 'Spin-offs') {
            seriesFilter = `AND LOWER(sr.series_name) NOT LIKE '%classic%' AND LOWER(sr.series_name) NOT LIKE '%modern%'`;
        }

        const doctorsResult = await pool.query(`
            SELECT DISTINCT e.doctor_num
            FROM episodes e
            LEFT JOIN seasons se ON e.season_id = se.season_id
            LEFT JOIN series sr ON se.series_id = sr.series_id
            WHERE e.doctor_num IS NOT NULL
              AND e.doctor_num NOT LIKE '%,%'
              ${seriesFilter}
            ORDER BY e.doctor_num
        `);

        const seasonsResult = await pool.query(`
            SELECT DISTINCT se.season_number
            FROM seasons se
            LEFT JOIN series sr ON se.series_id = sr.series_id
            INNER JOIN episodes e ON e.season_id = se.season_id
            WHERE se.season_number IS NOT NULL
              ${seriesFilter}
            ORDER BY se.season_number ASC
        `);

        res.json({
            doctors: doctorsResult.rows.map(r => r.doctor_num),
            seasons: seasonsResult.rows.map(r => r.season_number)
        });

    } catch (err) {
        console.error('Error fetching filter options:', err.message);
        res.status(500).json({ error: 'Failed to fetch filter options' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
