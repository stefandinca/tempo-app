<?php
/**
 * Database Migration Runner
 * Run this script to apply database migrations
 */

require_once 'db.php';

try {
    // Read the migration file
    $migrationFile = __DIR__ . '/migrations/001_add_portage_checked_items.sql';

    if (!file_exists($migrationFile)) {
        die("Migration file not found: $migrationFile\n");
    }

    $sql = file_get_contents($migrationFile);

    if ($sql === false) {
        die("Failed to read migration file\n");
    }

    echo "Running migration: 001_add_portage_checked_items.sql\n";

    // Execute the migration
    $pdo->exec($sql);

    echo "✓ Migration completed successfully!\n";
    echo "✓ Table 'portage_checked_items' has been created.\n";

} catch (PDOException $e) {
    echo "✗ Migration failed: " . $e->getMessage() . "\n";
    exit(1);
}
