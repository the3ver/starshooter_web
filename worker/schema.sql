-- Starshooter Highscores D1 Schema
CREATE TABLE IF NOT EXISTS highscores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,           -- 'single', 'coop_bot', 'online'
    name TEXT NOT NULL,           -- 'AAA' oder 'P1+P2'
    score INTEGER NOT NULL,       -- Punktzahl
    level INTEGER NOT NULL,       -- Erreichtes Level
    ship_p1 TEXT NOT NULL,        -- 'viper' oder 'phantom'
    ship_p2 TEXT,                 -- 'viper', 'phantom' oder NULL
    country TEXT,                 -- ISO-Ländercode z.B. 'DE', 'US'
    city TEXT,                    -- Stadt z.B. 'Frankfurt', 'Berlin'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_hash TEXT                  -- Anonymisierter IP-Hash für Rate-Limiting
);

CREATE INDEX IF NOT EXISTS idx_highscores_mode_score ON highscores(mode, score DESC);
CREATE INDEX IF NOT EXISTS idx_highscores_created_at ON highscores(created_at DESC);
