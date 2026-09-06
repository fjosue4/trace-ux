package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Users, roles and revocable dashboard login sessions. The bootstrap "admin"
// account is created from WS_PASSWORD; the admin role is the only one allowed
// to manage users.

// ---- Password hashing: PBKDF2-HMAC-SHA256 (stdlib only, no CGO deps) ----

const pbkdf2Iterations = 210_000

// hashPassword encodes as "pbkdf2-sha256$<iterations>$<salt-hex>$<hash-hex>".
func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	dk := pbkdf2SHA256([]byte(password), salt, pbkdf2Iterations, 32)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", pbkdf2Iterations,
		hex.EncodeToString(salt), hex.EncodeToString(dk)), nil
}

// verifyPassword checks password against an encoded hash. The iteration count
// is read from the hash so it can be raised later without invalidating
// existing passwords.
func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1 || iter > 10_000_000 {
		return false
	}
	salt, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got := pbkdf2SHA256([]byte(password), salt, iter, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// pbkdf2SHA256 implements PBKDF2 (RFC 8018) with HMAC-SHA256.
func pbkdf2SHA256(password, salt []byte, iterations, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hLen := prf.Size()
	numBlocks := (keyLen + hLen - 1) / hLen
	out := make([]byte, 0, numBlocks*hLen)
	var block [4]byte
	for i := 1; i <= numBlocks; i++ {
		block[0] = byte(i >> 24)
		block[1] = byte(i >> 16)
		block[2] = byte(i >> 8)
		block[3] = byte(i)
		prf.Reset()
		prf.Write(salt)
		prf.Write(block[:])
		t := prf.Sum(nil)
		u := make([]byte, len(t))
		copy(u, t)
		for n := 1; n < iterations; n++ {
			prf.Reset()
			prf.Write(t)
			t = prf.Sum(t[:0])
			for j := range u {
				u[j] ^= t[j]
			}
		}
		out = append(out, u...)
	}
	return out[:keyLen]
}

// ---- Users ----

var errUserExists = errors.New("username already exists")

type User struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt int64  `json:"created_at"`
}

func validateUsername(name string) bool {
	if len(name) < 1 || len(name) > 64 {
		return false
	}
	for _, c := range name {
		ok := c == '.' || c == '-' || c == '_' ||
			(c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
		if !ok {
			return false
		}
	}
	return true
}

func validateRole(role string) bool { return role == "admin" || role == "viewer" }

// userRecord is a User plus its password hash; the hash never leaves the store.
type userRecord struct {
	User
	PasswordHash string
}

const userCols = `id, username, role, created_at, password_hash`

// userColsQualified is userCols for queries that join other tables sharing
// column names (auth_sessions also has created_at).
const userColsQualified = `u.id, u.username, u.role, u.created_at, u.password_hash`

func scanUser(row interface{ Scan(...any) error }) (*userRecord, error) {
	var u userRecord
	if err := row.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt, &u.PasswordHash); err != nil {
		return nil, err
	}
	return &u, nil
}

// EnsureAdmin creates the bootstrap admin account if the users table is empty.
// WS_PASSWORD is its password; once users exist, passwords live only in the DB
// and changing the env var has no effect (see WS_RESET_ADMIN in main.go).
func (s *Store) EnsureAdmin(password string) error {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)`,
		"admin", hash, time.Now().Unix())
	return err
}

// ResetAdminPassword re-points the admin account at the env password. Used by
// WS_RESET_ADMIN=1 as a lockout escape hatch.
func (s *Store) ResetAdminPassword(password string) error {
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(`UPDATE users SET password_hash = ? WHERE username = 'admin'`, hash)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return s.EnsureAdmin(password)
	}
	// A reset password must not leave stale logins alive.
	s.DeleteAuthSessionsForUsername("admin")
	return nil
}

func (s *Store) CreateUser(username, passwordHash, role string) (User, error) {
	now := time.Now().Unix()
	res, err := s.db.Exec(`INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)`,
		username, passwordHash, role, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, errUserExists
		}
		return User{}, err
	}
	id, _ := res.LastInsertId()
	return User{ID: id, Username: username, Role: role, CreatedAt: now}, nil
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT id, username, role, created_at, '' FROM users ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u.User)
	}
	return out, rows.Err()
}

func (s *Store) GetUserByUsername(username string) (*userRecord, error) {
	u, err := scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE username = ?`, username))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func (s *Store) GetUserByID(id int64) (*userRecord, error) {
	u, err := scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func (s *Store) UpdateUserPassword(id int64, passwordHash string) error {
	_, err := s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, id)
	return err
}

func (s *Store) UpdateUserRole(id int64, role string) error {
	_, err := s.db.Exec(`UPDATE users SET role = ? WHERE id = ?`, role, id)
	return err
}

func (s *Store) DeleteUser(id int64) error {
	_, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// HasOtherAdmin reports whether an admin other than userID exists — the guard
// that keeps the operator from deleting or demoting their last way in.
func (s *Store) HasOtherAdmin(userID int64) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND id != ?`, userID).Scan(&n)
	return n > 0, err
}

// ---- Auth sessions (revocable login tokens) ----

const authSessionTTL = 30 * 24 * time.Hour

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// CreateAuthSession mints a login token for the user. Only the SHA-256 hash of
// the token is stored, so a DB leak cannot be replayed as a login.
func (s *Store) CreateAuthSession(userID int64) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	now := time.Now()
	_, err = s.db.Exec(`INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		tokenHash(token), userID, now.Unix(), now.Add(authSessionTTL).Unix())
	if err != nil {
		return "", err
	}
	return token, nil
}

// UserForToken resolves a cookie token to its user, if the session is alive.
func (s *Store) UserForToken(token string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	u, err := scanUser(s.db.QueryRow(`SELECT `+userColsQualified+` FROM users u
		JOIN auth_sessions a ON a.user_id = u.id
		WHERE a.token_hash = ? AND a.expires_at > ?`, tokenHash(token), time.Now().Unix()))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u.User, nil
}

func (s *Store) DeleteAuthSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM auth_sessions WHERE token_hash = ?`, tokenHash(token))
	return err
}

// DeleteAuthSessionsForUser revokes every login of one user (password changed,
// user deleted). The currently-used token can be kept for password self-change.
func (s *Store) DeleteAuthSessionsForUser(userID int64, keepToken string) error {
	if keepToken != "" {
		_, err := s.db.Exec(`DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?`,
			userID, tokenHash(keepToken))
		return err
	}
	_, err := s.db.Exec(`DELETE FROM auth_sessions WHERE user_id = ?`, userID)
	return err
}

func (s *Store) DeleteAuthSessionsForUsername(username string) error {
	_, err := s.db.Exec(`DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`, username)
	return err
}

// DeleteExpiredAuthSessions prunes dead login sessions; called from the
// periodic maintenance loop alongside retention.
func (s *Store) DeleteExpiredAuthSessions() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM auth_sessions WHERE expires_at <= ?`, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
