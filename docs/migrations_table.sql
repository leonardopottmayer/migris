CREATE TABLE
    IF NOT EXISTS migrations (
        migration_id VARCHAR(255) PRIMARY KEY,
        status CHAR(1) NOT NULL,
        updated_at TIMESTAMP,
        application_batch_id INTEGER,
        checksum VARCHAR(64)
    );
