const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// --- DATABASE CONNECTION ---
// Update these credentials to match your PostgreSQL setup
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'doctor_who_database_final',
    user: 'postgres',       // ← change to your postgres username
    password: '31415' // ← change to your postgres password
});

// Test DB connection on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.message);
    } else {
        console.log('Connected to doctor_who_databse_final');
        release();
    }
});


// ============================================================
// GET /api/episodes  — used by index.html
// Returns all episodes with season/series info joined
// Optional query params: ?doctor=10&season=1&min_rating=7&available=true&search=blink
// ============================================================
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
            // Match episodes where doctor_num equals the value OR contains it (e.g. "1, 2, 3" matches doctor=1)
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


// ============================================================
// GET /api/episodes/:id  — used by episode.html
// Returns a single episode's full details
// ============================================================
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


// ============================================================
// GET /api/doctors  — used to populate the filter dropdown
// ============================================================
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


// ============================================================
// GET /api/seasons  — used to populate the season filter dropdown
// ============================================================
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


// ============================================================
// GET /api/filter-options  — returns doctors & seasons scoped to a series tab
// Query param: ?tab=Classic|Modern|Spin-offs
// ============================================================
app.get('/api/filter-options', async (req, res) => {
    try {
        const { tab } = req.query;

        // Build a WHERE clause that matches the same tab logic used client-side
        let seriesFilter = '';
        if (tab === 'Classic') {
            seriesFilter = `AND LOWER(sr.series_name) LIKE '%classic%'`;
        } else if (tab === 'Modern') {
            seriesFilter = `AND LOWER(sr.series_name) LIKE '%modern%'`;
        } else if (tab === 'Spin-offs') {
            seriesFilter = `AND LOWER(sr.series_name) NOT LIKE '%classic%' AND LOWER(sr.series_name) NOT LIKE '%modern%'`;
        }

        // Distinct single-doctor values for the active tab
        // Episodes with multiple doctors (e.g. "1, 2") are excluded from filter options
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

        // Distinct seasons for the active tab
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


// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});