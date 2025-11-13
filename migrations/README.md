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

### create_activities_table.sql
**Date:** 2025-11-13
**Description:** Creates the `activities` table for tracking user actions across the application.

**Changes:**
- Creates new `activities` table with columns: id, user_id, user_name, action, details, action_type, related_id, created_at
- Adds indexes on user_id, action_type, created_at for query performance
- Enables activity logging for all major actions (create/update/delete events, clients, documents, evaluations)

**Table Structure:**
```sql
- id (INT, AUTO_INCREMENT, PRIMARY KEY)
- user_id (VARCHAR 255) - ID of user who performed the action
- user_name (VARCHAR 255) - Display name of the user
- action (VARCHAR 255) - Action description (e.g., "a adăugat client")
- details (TEXT) - Additional details about the action
- action_type (VARCHAR 50) - Type: event, client, document, evaluation, report, generic
- related_id (VARCHAR 255) - ID of related entity (for navigation)
- created_at (DATETIME) - Timestamp of the action
```

**Usage:**
After running this migration, all user actions will be automatically logged to the database. The Dashboard's Recent Activity section will display these activities in real-time for all users, with contextual buttons to navigate to related events, clients, or documents.

**Supported Actions:**
- Event creation, updates, deletion
- Client creation, updates, archiving
- Document uploads, deletion
- Evaluation saves
- And more...

### add_is_archived_to_clients.sql
**Date:** 2025-11-11
**Description:** Adds the `is_archived` column to the clients table to support archiving clients.

**Changes:**
- Adds `is_archived TINYINT(1)` column to clients table (default: 0)
- Sets all existing clients to active (is_archived = 0)
- Creates an index on `is_archived` for faster filtering

**Usage:**
After running this migration, clients can be marked as archived through the client form in the admin section. Archived clients will appear with an "ARHIVAT" badge in the client list and will have reduced opacity.
