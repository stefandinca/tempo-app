<?php
/**
 * Migration Runner
 * Run this script to create database tables for new features
 * Usage: php run_migration.php
 * Or visit: http://localhost/tempo-app/run_migration.php
 */

// Include database connection
require_once __DIR__ . '/db.php';

// List of migrations to run
$migrations = [
    'add_subscriptions_table.sql' => [
        'description' => 'Subscriptions feature for billing',
        'tables' => ['subscriptions']
    ],
    'add_intervention_plans_table.sql' => [
        'description' => 'Intervention plans for clients',
        'tables' => ['intervention_plans', 'intervention_plan_programs']
    ]
];

echo "=== Database Migration Runner ===\n\n";

$successCount = 0;
$failedCount = 0;
$skippedCount = 0;

foreach ($migrations as $filename => $info) {
    $migrationFile = __DIR__ . '/migrations/' . $filename;

    echo "Running: $filename\n";
    echo "Description: {$info['description']}\n";
    echo str_repeat('-', 60) . "\n";

    if (!file_exists($migrationFile)) {
        echo "✗ Error: Migration file not found!\n\n";
        $failedCount++;
        continue;
    }

    $sql = file_get_contents($migrationFile);

    if ($sql === false) {
        echo "✗ Error: Could not read migration file!\n\n";
        $failedCount++;
        continue;
    }

    try {
        // Execute the SQL statements
        $pdo->exec($sql);

        echo "✓ Migration completed successfully!\n";
        foreach ($info['tables'] as $table) {
            echo "  ✓ Table '$table' created\n";
        }
        echo "\n";
        $successCount++;

    } catch (PDOException $e) {
        // Check if table already exists
        if (strpos($e->getMessage(), 'already exists') !== false) {
            echo "⊘ Skipped: Tables already exist\n\n";
            $skippedCount++;
        } else {
            echo "✗ Migration failed!\n";
            echo "  Error: " . $e->getMessage() . "\n\n";
            $failedCount++;
        }
    }
}

echo str_repeat('=', 60) . "\n";
echo "Migration Summary:\n";
echo "  ✓ Successful: $successCount\n";
echo "  ⊘ Skipped: $skippedCount\n";
echo "  ✗ Failed: $failedCount\n";

if ($failedCount === 0) {
    echo "\n✓ All migrations completed successfully!\n";
    echo "You can now use the new features in the application.\n";
} else {
    echo "\n⚠ Some migrations failed. Please check the errors above.\n";
    exit(1);
}
