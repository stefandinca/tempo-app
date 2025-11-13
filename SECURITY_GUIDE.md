# Security Guide for Tempo App - Client Data Protection

**Version**: 1.0
**Last Updated**: November 2025
**Project**: Tempo Therapy Management System

---

## 🔐 Overview

This guide provides security recommendations for protecting sensitive client healthcare data, personal information, and documents in the Tempo application. Given that this system handles medical/therapy data, implementing these security measures is critical for compliance and client privacy.

---

## 🚨 Immediate Security Priorities

### 1. HTTPS/SSL Encryption (CRITICAL)

**Status**: ⚠️ Required
**Priority**: HIGH

Force HTTPS for all connections to encrypt data in transit:

```apache
# Add to .htaccess in root directory
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

**Why**: Encrypts all data in transit including login credentials, client data, medical notes, and file uploads.

**Action Items**:
- [ ] Obtain SSL certificate from hosting provider or Let's Encrypt
- [ ] Enable HTTPS in cPanel/hosting control panel
- [ ] Add redirect rule to `.htaccess`
- [ ] Test all functionality over HTTPS
- [ ] Update session cookie settings to require HTTPS

---

### 2. Enhanced File Upload Security

**Status**: ⚠️ Required
**Priority**: HIGH

**Location**: `uploads/client_documents/.htaccess`

Update the `.htaccess` file to prevent malicious file execution:

```apache
# Prevent script execution and directory listing
Options -Indexes -ExecCGI
AddHandler cgi-script .php .pl .py .jsp .asp .sh .cgi

# Block execution of any script files
<FilesMatch "\.(php|php3|php4|php5|phtml|pl|py|jsp|asp|sh|cgi)$">
    Order Deny,Allow
    Deny from all
</FilesMatch>

# Only allow specific safe file types
<FilesMatch "\.(pdf|doc|docx|jpg|jpeg|png|gif)$">
    Order Allow,Deny
    Allow from all
</FilesMatch>

# Prevent access to hidden files
<FilesMatch "^\.">
    Order Deny,Allow
    Deny from all
</FilesMatch>
```

**Additional Recommendation**: Move `uploads/` directory outside the web root if possible:
- Current: `/public_html/uploads/`
- Better: `/home/username/private_uploads/`

---

### 3. Secure Document Download with Access Control

**Status**: 🔨 Not Implemented
**Priority**: HIGH

Create a new file to handle secure document downloads with authentication checks.

**File**: `download_document.php`

```php
<?php
/**
 * Secure Document Download Handler
 * Enforces authentication and authorization before serving files
 */

session_start();
require_once 'db.php';

// Check if user is logged in
if (!isset($_SESSION['user_id'])) {
    http_response_code(403);
    error_log("Unauthorized document access attempt from IP: " . $_SERVER['REMOTE_ADDR']);
    die('Access denied. Please log in.');
}

$docId = $_GET['id'] ?? null;

if (!$docId || !is_numeric($docId)) {
    http_response_code(400);
    die('Invalid document ID');
}

try {
    // Get document information
    $stmt = $pdo->prepare("SELECT cd.*, c.name as client_name
                          FROM client_documents cd
                          JOIN clients c ON cd.client_id = c.id
                          WHERE cd.id = ?");
    $stmt->execute([$docId]);
    $doc = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$doc) {
        http_response_code(404);
        die('Document not found');
    }

    // Optional: Role-based access control
    // Uncomment to restrict access based on user role
    /*
    if ($_SESSION['role'] === 'therapist') {
        // Check if therapist is assigned to this client
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM event_team_members etm
                              JOIN event_clients ec ON etm.event_id = ec.event_id
                              WHERE ec.client_id = ? AND etm.team_member_id = ?");
        $stmt->execute([$doc['client_id'], $_SESSION['user_id']]);
        $hasAccess = $stmt->fetchColumn() > 0;

        if (!$hasAccess) {
            http_response_code(403);
            die('You do not have permission to access this document');
        }
    }
    */

    // Build file path
    $filePath = __DIR__ . '/uploads/client_documents/' . $doc['file_name'];

    if (!file_exists($filePath)) {
        http_response_code(404);
        error_log("File not found on disk: " . $filePath);
        die('File not found on server');
    }

    // Log the access (for audit trail)
    $logStmt = $pdo->prepare("INSERT INTO audit_log (user_id, action, table_name, record_id, ip_address)
                             VALUES (?, 'DOWNLOAD_DOCUMENT', 'client_documents', ?, ?)");
    $logStmt->execute([$_SESSION['user_id'], $docId, $_SERVER['REMOTE_ADDR']]);

    // Determine MIME type
    $mimeTypes = [
        'pdf' => 'application/pdf',
        'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'gif' => 'image/gif'
    ];
    $mimeType = $mimeTypes[$doc['file_type']] ?? 'application/octet-stream';

    // Send file with secure headers
    header('Content-Type: ' . $mimeType);
    header('Content-Disposition: inline; filename="' . basename($doc['original_name']) . '"');
    header('Content-Length: ' . filesize($filePath));
    header('Cache-Control: private, must-revalidate, max-age=0');
    header('Pragma: private');
    header('X-Content-Type-Options: nosniff');

    // Prevent caching of sensitive files
    header('Expires: 0');

    readfile($filePath);
    exit;

} catch (Exception $e) {
    error_log("Document download error: " . $e->getMessage());
    http_response_code(500);
    die('An error occurred while processing your request');
}
?>
```

**Update Frontend** (`js/uiService.js` line ~1502):

Change from:
```javascript
<a href="uploads/client_documents/${doc.file_name}"
```

To:
```javascript
<a href="download_document.php?id=${doc.id}"
```

---

### 4. Password Hashing & Authentication

**Status**: ⚠️ Needs Review
**Priority**: HIGH
**Current Issue**: Passwords may be stored in plaintext

**Update `api.php` login handler** (around line 103):

```php
// BEFORE (INSECURE):
if ($user && $password === $user['password']) {
    // Login success
}

// AFTER (SECURE):
if ($user && password_verify($password, $user['password'])) {
    // Login success

    // Regenerate session ID to prevent session fixation
    session_regenerate_id(true);

    $_SESSION['user_id'] = $user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['role'] = $user['role'] ?? 'therapist';

    // Log successful login
    debugLog("Login SUCCESS: user=" . $user['username'] . ", IP=" . $_SERVER['REMOTE_ADDR']);

    sendResponse([
        'success' => true,
        'user' => [
            'id' => $user['id'],
            'username' => $user['username'],
            'role' => $_SESSION['role']
        ]
    ]);
}
```

**Migrate Existing Passwords**:

Create `migrate_passwords.php` (run once, then delete):

```php
<?php
require_once 'db.php';

// Get all users
$users = $pdo->query("SELECT id, username, password FROM users")->fetchAll();

foreach ($users as $user) {
    // Check if password is already hashed (bcrypt hashes start with $2y$)
    if (substr($user['password'], 0, 4) !== '$2y$') {
        $hashedPassword = password_hash($user['password'], PASSWORD_BCRYPT);

        $stmt = $pdo->prepare("UPDATE users SET password = ? WHERE id = ?");
        $stmt->execute([$hashedPassword, $user['id']]);

        echo "Updated password for: " . $user['username'] . "\n";
    } else {
        echo "Already hashed: " . $user['username'] . "\n";
    }
}

echo "\nPassword migration complete!\n";
echo "DELETE THIS FILE NOW!\n";
?>
```

---

### 5. Session Security Hardening

**Status**: ⚠️ Required
**Priority**: MEDIUM

**Update `api.php`** (add after line 1, before any session_start()):

```php
<?php
/**
 * Therapy Calendar API - PHP Backend (MySQL Version)
 * Provides RESTful API for calendar data management
 */

// Configure secure session settings
ini_set('session.cookie_httponly', 1); // Prevent JavaScript access to session cookies
ini_set('session.cookie_secure', 1);   // Only send cookies over HTTPS (enable after SSL is active)
ini_set('session.use_strict_mode', 1); // Reject uninitialized session IDs
ini_set('session.cookie_samesite', 'Strict'); // CSRF protection
ini_set('session.use_only_cookies', 1); // Don't accept session IDs from URLs
ini_set('session.gc_maxlifetime', 3600); // Session timeout: 1 hour

// Error reporting (disable display in production)
error_reporting(E_ALL);
ini_set('display_errors', 0); // CRITICAL: Keep this 0 in production!
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/php_errors.log');

// ... rest of api.php
```

**Add session timeout check**:

```php
// Add this function near the top of api.php
function checkSessionTimeout() {
    $timeout = 3600; // 1 hour in seconds

    if (isset($_SESSION['last_activity']) && (time() - $_SESSION['last_activity'] > $timeout)) {
        session_unset();
        session_destroy();
        sendError('Session expired. Please log in again.', 401);
    }

    $_SESSION['last_activity'] = time();
}

// Call this at the start of authenticated routes
if (isset($_SESSION['user_id'])) {
    checkSessionTimeout();
}
```

---

### 6. Role-Based Access Control (RBAC)

**Status**: 🔨 Not Implemented
**Priority**: MEDIUM

Add permission checking function to `api.php`:

```php
/**
 * Check user authentication and permissions
 * @param string|null $requiredRole - Required role (null = any authenticated user)
 * @return bool
 */
function checkPermission($requiredRole = null) {
    // Check if user is logged in
    if (!isset($_SESSION['user_id'])) {
        debugLog("Unauthorized access attempt - No session");
        sendError('Unauthorized. Please log in.', 401);
    }

    // Check role-based permission
    if ($requiredRole !== null) {
        $userRole = $_SESSION['role'] ?? 'therapist';

        // Admin has access to everything
        if ($userRole === 'admin') {
            return true;
        }

        // Check if user has required role
        if ($userRole !== $requiredRole) {
            debugLog("Permission denied for user: " . $_SESSION['user_id'] . " (role: $userRole, required: $requiredRole)");
            sendError('Insufficient permissions', 403);
        }
    }

    return true;
}

/**
 * Check if user can access specific client data
 * @param string $clientId
 * @return bool
 */
function canAccessClient($clientId) {
    global $pdo;

    // Admins can access all clients
    if ($_SESSION['role'] === 'admin') {
        return true;
    }

    // Therapists can only access clients they work with
    if ($_SESSION['role'] === 'therapist') {
        $stmt = $pdo->prepare("
            SELECT COUNT(DISTINCT ec.client_id)
            FROM event_clients ec
            JOIN event_team_members etm ON ec.event_id = etm.event_id
            WHERE ec.client_id = ? AND etm.team_member_id = ?
        ");
        $stmt->execute([$clientId, $_SESSION['user_id']]);
        $count = $stmt->fetchColumn();

        return $count > 0;
    }

    return false;
}
```

**Use in endpoints**:

```php
// Protect sensitive endpoints
case 'client-documents':
    checkPermission(); // Require authentication

    if ($method === 'GET') {
        $clientId = $_GET['client_id'] ?? null;

        // Check if user can access this client
        if (!canAccessClient($clientId)) {
            sendError('You do not have permission to access this client', 403);
        }

        // ... rest of code
    }
    break;

case 'clients':
    checkPermission('admin'); // Only admins can create/delete clients
    // ... rest of code
    break;
```

---

### 7. Database Credential Security

**Status**: ⚠️ Exposed
**Priority**: HIGH
**Current Issue**: Database credentials hardcoded in `db.php`

**Create `.env` file** (in project root, add to `.gitignore`):

```env
# Database Configuration
DB_HOST=127.0.0.1
DB_NAME=incjzljm_tempo_livebetterlife
DB_USER=incjzljm_tempo_livebetterlife
DB_PASS=your_secure_password_here

# Encryption Key (generate a random 32-character string)
ENCRYPTION_KEY=generate_random_32_char_key_here

# Session Configuration
SESSION_TIMEOUT=3600
```

**Update `.gitignore`**:

```gitignore
.env
debug.log
php_errors.log
uploads/client_documents/*
!uploads/client_documents/.htaccess
```

**Update `db.php`**:

```php
<?php
/**
 * Database Connection Configuration
 * Uses environment variables for security
 */

// Error reporting (hide in production)
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// Load environment variables from .env file
function loadEnv($path) {
    if (!file_exists($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) {
            continue; // Skip comments
        }

        list($name, $value) = explode('=', $line, 2);
        $name = trim($name);
        $value = trim($value);

        if (!array_key_exists($name, $_ENV)) {
            $_ENV[$name] = $value;
            putenv("$name=$value");
        }
    }
}

// Load .env file
loadEnv(__DIR__ . '/.env');

// Database configuration from environment
$host = getenv('DB_HOST') ?: '127.0.0.1';
$db   = getenv('DB_NAME') ?: 'incjzljm_tempo_livebetterlife';
$user = getenv('DB_USER') ?: 'incjzljm_tempo_livebetterlife';
$pass = getenv('DB_PASS') ?: '';
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
    // Log error securely (don't expose database details)
    error_log('Database connection failed: ' . $e->getMessage());

    // Send generic error to client
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Database connection error. Please contact support.']);
    exit;
}
?>
```

---

### 8. Data Encryption for Sensitive Fields

**Status**: 🔨 Not Implemented
**Priority**: MEDIUM
**Use Case**: Encrypt medical notes, phone numbers, emails

**Create `encryption.php`**:

```php
<?php
/**
 * Encryption Helper Functions
 * Uses AES-256-CBC encryption for sensitive data
 */

class Encryption {
    private static $cipher = 'aes-256-cbc';

    /**
     * Get encryption key from environment
     */
    private static function getKey() {
        $key = getenv('ENCRYPTION_KEY');

        if (empty($key)) {
            throw new Exception('ENCRYPTION_KEY not set in environment');
        }

        // Ensure key is proper length (32 bytes for AES-256)
        return hash('sha256', $key, true);
    }

    /**
     * Encrypt data
     * @param string $data - Plain text data
     * @return string - Base64 encoded encrypted data
     */
    public static function encrypt($data) {
        if (empty($data)) {
            return $data;
        }

        $key = self::getKey();
        $ivLength = openssl_cipher_iv_length(self::$cipher);
        $iv = openssl_random_pseudo_bytes($ivLength);

        $encrypted = openssl_encrypt($data, self::$cipher, $key, 0, $iv);

        // Combine IV and encrypted data
        return base64_encode($encrypted . '::' . $iv);
    }

    /**
     * Decrypt data
     * @param string $data - Base64 encoded encrypted data
     * @return string - Plain text data
     */
    public static function decrypt($data) {
        if (empty($data)) {
            return $data;
        }

        try {
            $key = self::getKey();
            $data = base64_decode($data);

            list($encrypted, $iv) = explode('::', $data, 2);

            return openssl_decrypt($encrypted, self::$cipher, $key, 0, $iv);
        } catch (Exception $e) {
            error_log('Decryption error: ' . $e->getMessage());
            return '[ENCRYPTED]';
        }
    }

    /**
     * Generate a secure encryption key
     * @return string
     */
    public static function generateKey() {
        return bin2hex(random_bytes(16)); // 32 character hex string
    }
}
?>
```

**Usage Example**:

```php
require_once 'encryption.php';

// When saving sensitive data
$encryptedMedical = Encryption::encrypt($clientData['medical']);
$stmt = $pdo->prepare("UPDATE clients SET medical = ? WHERE id = ?");
$stmt->execute([$encryptedMedical, $clientId]);

// When retrieving sensitive data
$client = $stmt->fetch();
$client['medical'] = Encryption::decrypt($client['medical']);
```

**⚠️ Important**: Backup unencrypted data before implementing encryption!

---

### 9. Audit Logging System

**Status**: 🔨 Not Implemented
**Priority**: MEDIUM
**Purpose**: Track who accessed what and when (GDPR compliance)

**Create database table**:

```sql
CREATE TABLE `audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(255) DEFAULT NULL,
  `username` varchar(255) DEFAULT NULL,
  `action` varchar(50) NOT NULL,
  `table_name` varchar(50) DEFAULT NULL,
  `record_id` varchar(255) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `timestamp` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
```

**Add logging function to `api.php`**:

```php
/**
 * Log security-sensitive actions for audit trail
 * @param string $action - Action performed (e.g., 'LOGIN', 'VIEW_CLIENT', 'DOWNLOAD_DOCUMENT')
 * @param string|null $tableName - Table affected
 * @param string|null $recordId - Record ID affected
 * @param string|null $details - Additional details
 */
function logAudit($action, $tableName = null, $recordId = null, $details = null) {
    global $pdo;

    try {
        $stmt = $pdo->prepare("
            INSERT INTO audit_log
            (user_id, username, action, table_name, record_id, details, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ");

        $stmt->execute([
            $_SESSION['user_id'] ?? 'system',
            $_SESSION['username'] ?? 'anonymous',
            $action,
            $tableName,
            $recordId,
            $details,
            $_SERVER['REMOTE_ADDR'] ?? 'unknown',
            substr($_SERVER['HTTP_USER_AGENT'] ?? 'unknown', 0, 255)
        ]);
    } catch (Exception $e) {
        error_log('Audit logging failed: ' . $e->getMessage());
    }
}
```

**Use throughout the application**:

```php
// Log successful login
logAudit('LOGIN', 'users', $user['id'], 'Successful login');

// Log failed login
logAudit('LOGIN_FAILED', 'users', $username, 'Invalid password');

// Log viewing client data
logAudit('VIEW_CLIENT', 'clients', $clientId);

// Log document downloads
logAudit('DOWNLOAD_DOCUMENT', 'client_documents', $docId, $doc['original_name']);

// Log data modifications
logAudit('UPDATE_CLIENT', 'clients', $clientId, 'Updated medical notes');

// Log deletions
logAudit('DELETE_CLIENT', 'clients', $clientId, $client['name']);
```

**Create audit log viewer** (`admin_audit_log.php`):

```php
<?php
session_start();
require_once 'db.php';

// Only admins can view audit logs
if (!isset($_SESSION['role']) || $_SESSION['role'] !== 'admin') {
    die('Access denied');
}

$limit = 100;
$offset = $_GET['offset'] ?? 0;

$logs = $pdo->query("
    SELECT * FROM audit_log
    ORDER BY timestamp DESC
    LIMIT $limit OFFSET $offset
")->fetchAll();
?>
<!DOCTYPE html>
<html>
<head>
    <title>Audit Log</title>
    <style>
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Security Audit Log</h1>
    <table>
        <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Table</th>
            <th>Record ID</th>
            <th>IP Address</th>
            <th>Details</th>
        </tr>
        <?php foreach ($logs as $log): ?>
        <tr>
            <td><?= htmlspecialchars($log['timestamp']) ?></td>
            <td><?= htmlspecialchars($log['username']) ?></td>
            <td><?= htmlspecialchars($log['action']) ?></td>
            <td><?= htmlspecialchars($log['table_name']) ?></td>
            <td><?= htmlspecialchars($log['record_id']) ?></td>
            <td><?= htmlspecialchars($log['ip_address']) ?></td>
            <td><?= htmlspecialchars($log['details']) ?></td>
        </tr>
        <?php endforeach; ?>
    </table>
</body>
</html>
```

---

### 10. XSS Protection & Output Sanitization

**Status**: ⚠️ Partial
**Priority**: MEDIUM

**Add sanitization helper to `api.php`**:

```php
/**
 * Sanitize output to prevent XSS attacks
 * @param mixed $data - Data to sanitize
 * @return mixed - Sanitized data
 */
function sanitizeOutput($data) {
    if (is_array($data)) {
        return array_map('sanitizeOutput', $data);
    }

    if (is_string($data)) {
        return htmlspecialchars($data, ENT_QUOTES, 'UTF-8');
    }

    return $data;
}

/**
 * Sanitize input to prevent injection attacks
 * @param string $input
 * @return string
 */
function sanitizeInput($input) {
    $input = trim($input);
    $input = stripslashes($input);
    return $input;
}
```

**Update frontend to escape output** (`js/uiService.js`):

```javascript
// Add escaping helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Use when rendering client data
docCard.innerHTML = `
    <div>
        <div style="font-weight: 600;">${escapeHtml(doc.original_name)}</div>
        <div style="font-size: 0.875rem;">
            ${fileSize} • Încărcat: ${uploadDate}
        </div>
    </div>
`;
```

---

## 🔒 Additional Security Measures

### 11. Rate Limiting for Login Endpoint

Prevent brute force attacks:

```php
/**
 * Rate limiting for login attempts
 * @param string $identifier - Username or IP address
 * @return bool - True if allowed, false if rate limited
 */
function checkRateLimit($identifier) {
    global $pdo;

    $maxAttempts = 5;
    $timeWindow = 900; // 15 minutes

    // Clean old attempts
    $pdo->query("DELETE FROM login_attempts WHERE timestamp < DATE_SUB(NOW(), INTERVAL $timeWindow SECOND)");

    // Count recent attempts
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND timestamp > DATE_SUB(NOW(), INTERVAL $timeWindow SECOND)");
    $stmt->execute([$identifier]);
    $attempts = $stmt->fetchColumn();

    if ($attempts >= $maxAttempts) {
        return false;
    }

    // Log this attempt
    $stmt = $pdo->prepare("INSERT INTO login_attempts (identifier, timestamp) VALUES (?, NOW())");
    $stmt->execute([$identifier]);

    return true;
}

// In login handler:
$identifier = $username . '|' . $_SERVER['REMOTE_ADDR'];
if (!checkRateLimit($identifier)) {
    logAudit('LOGIN_RATE_LIMITED', 'users', $username, 'Too many failed attempts');
    sendError('Too many login attempts. Please try again in 15 minutes.', 429);
}
```

**Create table**:

```sql
CREATE TABLE `login_attempts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `identifier` varchar(255) NOT NULL,
  `timestamp` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_identifier` (`identifier`),
  KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB;
```

---

### 12. CSRF Protection

Add CSRF tokens to forms:

```php
/**
 * Generate CSRF token
 * @return string
 */
function generateCsrfToken() {
    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/**
 * Verify CSRF token
 * @param string $token
 * @return bool
 */
function verifyCsrfToken($token) {
    if (!isset($_SESSION['csrf_token'])) {
        return false;
    }

    return hash_equals($_SESSION['csrf_token'], $token);
}

// In form submission handlers:
if ($method === 'POST' || $method === 'PUT' || $method === 'DELETE') {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $input['csrf_token'] ?? '';

    if (!verifyCsrfToken($token)) {
        sendError('Invalid CSRF token', 403);
    }
}
```

**Frontend** - Add to all API requests:

```javascript
// In apiService.js
async function apiFetch(path, options = {}) {
    // Add CSRF token to all requests
    const csrfToken = sessionStorage.getItem('csrf_token');

    if (csrfToken && (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE')) {
        options.headers = options.headers || {};
        options.headers['X-CSRF-Token'] = csrfToken;
    }

    // ... rest of code
}

// Store CSRF token on login
function storeCsrfToken(token) {
    sessionStorage.setItem('csrf_token', token);
}
```

---

### 13. Input Validation

Add strict validation for all inputs:

```php
/**
 * Validate client ID format
 */
function validateClientId($id) {
    return preg_match('/^[a-z0-9_]{3,255}$/', $id);
}

/**
 * Validate file upload
 */
function validateFileUpload($file, $maxSize = 2097152) {
    $allowedTypes = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'gif'];
    $allowedMimes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/gif'
    ];

    // Check file size
    if ($file['size'] > $maxSize) {
        return ['valid' => false, 'error' => 'File too large'];
    }

    // Check extension
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, $allowedTypes)) {
        return ['valid' => false, 'error' => 'Invalid file type'];
    }

    // Check MIME type
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);

    if (!in_array($mimeType, $allowedMimes)) {
        return ['valid' => false, 'error' => 'Invalid file content'];
    }

    return ['valid' => true];
}

/**
 * Validate email
 */
function validateEmail($email) {
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

/**
 * Validate phone number (Romanian format)
 */
function validatePhone($phone) {
    $phone = preg_replace('/\s+/', '', $phone);
    return preg_match('/^(\+40|0)?[0-9]{9}$/', $phone);
}
```

---

### 14. Secure Backup Strategy

**Automated Database Backups**:

Create `backup_database.php`:

```php
<?php
/**
 * Database Backup Script
 * Run via cron job: 0 2 * * * /usr/bin/php /path/to/backup_database.php
 */

require_once 'db.php';

$backupDir = __DIR__ . '/backups/';
if (!file_exists($backupDir)) {
    mkdir($backupDir, 0750, true);
}

$filename = 'backup_' . date('Y-m-d_H-i-s') . '.sql.gz';
$filepath = $backupDir . $filename;

$dbHost = getenv('DB_HOST');
$dbName = getenv('DB_NAME');
$dbUser = getenv('DB_USER');
$dbPass = getenv('DB_PASS');

// Create compressed backup
$command = "mysqldump -h $dbHost -u $dbUser -p$dbPass $dbName | gzip > $filepath";
exec($command, $output, $returnCode);

if ($returnCode === 0) {
    echo "Backup created: $filename\n";

    // Delete backups older than 30 days
    $files = glob($backupDir . 'backup_*.sql.gz');
    foreach ($files as $file) {
        if (filemtime($file) < time() - (30 * 24 * 60 * 60)) {
            unlink($file);
            echo "Deleted old backup: " . basename($file) . "\n";
        }
    }
} else {
    error_log("Backup failed with return code: $returnCode");
}
?>
```

**Add to `.htaccess`** to protect backups:

```apache
# Protect backup directory
<FilesMatch "\.(sql|gz|zip)$">
    Order Deny,Allow
    Deny from all
</FilesMatch>
```

---

## 🇪🇺 GDPR Compliance

### Data Subject Rights Implementation

**1. Right to Access** - Allow clients to request their data

Create `export_client_data.php`:

```php
<?php
/**
 * Export all data for a specific client (GDPR compliance)
 */
session_start();
require_once 'db.php';

// Admin only
if ($_SESSION['role'] !== 'admin') {
    die('Access denied');
}

$clientId = $_GET['client_id'] ?? null;

if (!$clientId) {
    die('Client ID required');
}

// Gather all client data
$data = [];

// Client info
$stmt = $pdo->prepare("SELECT * FROM clients WHERE id = ?");
$stmt->execute([$clientId]);
$data['client'] = $stmt->fetch();

// Events
$stmt = $pdo->prepare("
    SELECT e.* FROM events e
    JOIN event_clients ec ON e.id = ec.event_id
    WHERE ec.client_id = ?
");
$stmt->execute([$clientId]);
$data['events'] = $stmt->fetchAll();

// Documents
$stmt = $pdo->prepare("SELECT * FROM client_documents WHERE client_id = ?");
$stmt->execute([$clientId]);
$data['documents'] = $stmt->fetchAll();

// Evaluations
$stmt = $pdo->prepare("SELECT * FROM logopedic_evaluations WHERE client_id = ?");
$stmt->execute([$clientId]);
$data['logopedic_evaluations'] = $stmt->fetchAll();

$stmt = $pdo->prepare("SELECT * FROM portage_evaluations WHERE client_id = ?");
$stmt->execute([$clientId]);
$data['portage_evaluations'] = $stmt->fetchAll();

// Export as JSON
header('Content-Type: application/json');
header('Content-Disposition: attachment; filename="client_data_' . $clientId . '.json"');
echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

// Log export
logAudit('GDPR_DATA_EXPORT', 'clients', $clientId, 'Full data export');
?>
```

**2. Right to Erasure** - Complete data deletion

```php
/**
 * Permanently delete all client data (GDPR "Right to be Forgotten")
 * WARNING: This is irreversible!
 */
function deleteClientCompletely($clientId) {
    global $pdo;

    try {
        $pdo->beginTransaction();

        // Log deletion before it happens
        logAudit('GDPR_DATA_DELETION', 'clients', $clientId, 'Complete data erasure initiated');

        // Delete documents from filesystem
        $stmt = $pdo->prepare("SELECT file_name FROM client_documents WHERE client_id = ?");
        $stmt->execute([$clientId]);
        $docs = $stmt->fetchAll();

        foreach ($docs as $doc) {
            $filePath = __DIR__ . '/uploads/client_documents/' . $doc['file_name'];
            if (file_exists($filePath)) {
                unlink($filePath);
            }
        }

        // Database deletions (CASCADE will handle related records)
        $pdo->prepare("DELETE FROM client_documents WHERE client_id = ?")->execute([$clientId]);
        $pdo->prepare("DELETE FROM logopedic_evaluations WHERE client_id = ?")->execute([$clientId]);
        $pdo->prepare("DELETE FROM portage_evaluations WHERE client_id = ?")->execute([$clientId]);
        $pdo->prepare("DELETE FROM event_clients WHERE client_id = ?")->execute([$clientId]);
        $pdo->prepare("DELETE FROM clients WHERE id = ?")->execute([$clientId]);

        $pdo->commit();

        return ['success' => true, 'message' => 'Client data permanently deleted'];

    } catch (Exception $e) {
        $pdo->rollBack();
        error_log('GDPR deletion failed: ' . $e->getMessage());
        return ['success' => false, 'error' => $e->getMessage()];
    }
}
```

---

## 📋 Security Implementation Checklist

### Critical (Implement Immediately)
- [ ] Enable HTTPS/SSL on domain
- [ ] Update `.htaccess` in uploads directory
- [ ] Implement secure document download script
- [ ] Hash all passwords with `password_hash()`
- [ ] Add session security configuration
- [ ] Move database credentials to `.env` file
- [ ] Test all functionality after changes

### High Priority (Implement Soon)
- [ ] Add role-based access control
- [ ] Implement audit logging
- [ ] Add rate limiting to login
- [ ] Create backup automation script
- [ ] Add CSRF protection
- [ ] Implement input validation throughout

### Medium Priority (Implement When Possible)
- [ ] Encrypt sensitive database fields
- [ ] Add session timeout handling
- [ ] Create audit log viewer for admins
- [ ] Implement GDPR data export function
- [ ] Add XSS protection helpers
- [ ] Document security procedures for team

### Optional Enhancements
- [ ] Two-factor authentication (2FA)
- [ ] IP whitelist for admin panel
- [ ] Automated security scanning
- [ ] Database query optimization
- [ ] Content Security Policy (CSP) headers

---

## 🚨 Incident Response Plan

### If a Security Breach Occurs:

1. **Immediate Actions**:
   - Change all passwords immediately
   - Disable affected user accounts
   - Block suspicious IP addresses
   - Take affected systems offline if necessary

2. **Investigation**:
   - Review audit logs (`audit_log` table)
   - Check `debug.log` and `php_errors.log`
   - Review server access logs
   - Identify scope of breach

3. **Notification** (GDPR requirement):
   - Within 72 hours: Report to Data Protection Authority
   - Notify affected clients if personal data was compromised
   - Document all actions taken

4. **Recovery**:
   - Restore from clean backup if compromised
   - Apply security patches
   - Review and strengthen security measures
   - Monitor systems closely for 30 days

5. **Post-Incident**:
   - Document lessons learned
   - Update security procedures
   - Train staff on new procedures
   - Consider security audit by professional

---

## 📞 Security Contacts

- **Hosting Support**: [Your hosting provider support]
- **Database Administrator**: [Name/Email]
- **Application Developer**: [Name/Email]
- **Data Protection Officer**: [Name/Email if applicable]

---

## 📚 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [PHP Security Best Practices](https://www.php.net/manual/en/security.php)
- [GDPR Official Text](https://gdpr-info.eu/)
- [MySQL Security Guidelines](https://dev.mysql.com/doc/refman/8.0/en/security-guidelines.html)

---

## 📝 Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-11-13 | 1.0 | Initial security guide created | Claude |

---

**Last Updated**: November 13, 2025
**Review Frequency**: Quarterly
**Next Review**: February 2026
