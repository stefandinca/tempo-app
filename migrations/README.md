# Database Migrations

This directory contains SQL migration scripts for the tempo-app database.

## Running Migrations

To apply a migration, execute the SQL file against your MySQL database:

```bash
mysql -u your_username -p your_database < migrations/migration_file.sql
```

Or using phpMyAdmin:
1. Open phpMyAdmin
2. Select your database
3. Go to the SQL tab
4. Copy and paste the contents of the migration file
5. Click "Go" to execute

## Available Migrations

### add_is_archived_to_clients.sql
**Date:** 2025-11-11
**Description:** Adds the `is_archived` column to the clients table to support archiving clients.

**Changes:**
- Adds `is_archived TINYINT(1)` column to clients table (default: 0)
- Sets all existing clients to active (is_archived = 0)
- Creates an index on `is_archived` for faster filtering

**Usage:**
After running this migration, clients can be marked as archived through the client form in the admin section. Archived clients will appear with an "ARHIVAT" badge in the client list and will have reduced opacity.
