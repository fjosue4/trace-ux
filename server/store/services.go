package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const MaxServiceNameLength = 100

type Service struct {
	ID                int64    `json:"id"`
	SiteID            int64    `json:"site_id"`
	Name              string   `json:"name"`
	KeyHint           string   `json:"key_hint"`
	InheritSeverities bool     `json:"inherit_severities"`
	Severities        []string `json:"severities"`
	CreatedAt         int64    `json:"created_at"`
	LastUsedAt        int64    `json:"last_used_at"`
	RevokedAt         int64    `json:"revoked_at"`
}

func newServiceKey() string { return "tux_log_" + newKey(24) }

func hashServiceKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func serviceKeyHint(prefix, suffix string) string {
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	if len(suffix) > 4 {
		suffix = suffix[len(suffix)-4:]
	}
	return prefix + "…" + suffix
}

func normalizeServiceName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > MaxServiceNameLength {
		return "", errors.New("service name must be 1-100 characters")
	}
	return name, nil
}

func normalizeServiceSeverities(values []string) ([]string, error) {
	if !ValidLogSeverities(values) {
		return nil, errors.New("invalid severities")
	}
	selected := make(map[string]bool, len(values))
	for _, value := range values {
		selected[value] = true
	}
	ordered := make([]string, 0, len(values))
	for _, severity := range allLogSeverities {
		if selected[severity] {
			ordered = append(ordered, severity)
		}
	}
	return ordered, nil
}

func scanService(row interface{ Scan(...any) error }) (Service, error) {
	var service Service
	var prefix, suffix, rawSeverities string
	var inherit int
	err := row.Scan(&service.ID, &service.SiteID, &service.Name, &prefix, &suffix,
		&inherit, &rawSeverities, &service.CreatedAt, &service.LastUsedAt, &service.RevokedAt)
	if err != nil {
		return service, err
	}
	service.KeyHint = serviceKeyHint(prefix, suffix)
	service.InheritSeverities = inherit != 0
	if err := json.Unmarshal([]byte(rawSeverities), &service.Severities); err != nil {
		service.Severities = []string{LogSeverityError}
	}
	return service, nil
}

const serviceColumns = `id, site_id, name, key_prefix, key_suffix, inherit_severities,
	severities, created_at, last_used_at, revoked_at`

func (s *Store) ListServices(siteID int64) ([]Service, error) {
	rows, err := s.DB.Query(`SELECT `+serviceColumns+` FROM services WHERE site_id = ? ORDER BY created_at DESC, id DESC`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	services := []Service{}
	for rows.Next() {
		service, err := scanService(rows)
		if err != nil {
			return nil, err
		}
		services = append(services, service)
	}
	return services, rows.Err()
}

func (s *Store) CreateService(siteID int64, name string) (Service, string, error) {
	name, err := normalizeServiceName(name)
	if err != nil {
		return Service{}, "", err
	}
	key := newServiceKey()
	now := time.Now().Unix()
	var exists int
	if err := s.DB.QueryRow(`SELECT 1 FROM sites WHERE id = ?`, siteID).Scan(&exists); err != nil {
		return Service{}, "", err
	}
	severities, _ := json.Marshal([]string{LogSeverityError})
	res, err := s.DB.Exec(`INSERT INTO services
		(site_id, name, key_hash, key_prefix, key_suffix, inherit_severities, severities, created_at)
		VALUES (?, ?, ?, ?, ?, 1, ?, ?)`, siteID, name, hashServiceKey(key), key[:8], key[len(key)-4:], string(severities), now)
	if err != nil {
		return Service{}, "", err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Service{}, "", err
	}
	service, err := scanService(s.DB.QueryRow(`SELECT `+serviceColumns+` FROM services WHERE id = ?`, id))
	return service, key, err
}

func (s *Store) UpdateService(siteID, serviceID int64, name string, inherit bool, severities []string) (Service, error) {
	var err error
	name, err = normalizeServiceName(name)
	if err != nil {
		return Service{}, err
	}
	severities, err = normalizeServiceSeverities(severities)
	if err != nil {
		return Service{}, err
	}
	raw, _ := json.Marshal(severities)
	res, err := s.DB.Exec(`UPDATE services SET name = ?, inherit_severities = ?, severities = ?
		WHERE id = ? AND site_id = ?`, name, inherit, string(raw), serviceID, siteID)
	if err != nil {
		return Service{}, err
	}
	if count, _ := res.RowsAffected(); count == 0 {
		return Service{}, sql.ErrNoRows
	}
	return scanService(s.DB.QueryRow(`SELECT `+serviceColumns+` FROM services WHERE id = ?`, serviceID))
}

func (s *Store) RotateServiceKey(siteID, serviceID int64) (Service, string, error) {
	key := newServiceKey()
	res, err := s.DB.Exec(`UPDATE services SET key_hash = ?, key_prefix = ?, key_suffix = ?, revoked_at = 0, last_used_at = 0
		WHERE id = ? AND site_id = ?`, hashServiceKey(key), key[:8], key[len(key)-4:], serviceID, siteID)
	if err != nil {
		return Service{}, "", err
	}
	if count, _ := res.RowsAffected(); count == 0 {
		return Service{}, "", sql.ErrNoRows
	}
	service, err := scanService(s.DB.QueryRow(`SELECT `+serviceColumns+` FROM services WHERE id = ?`, serviceID))
	return service, key, err
}

func (s *Store) RevokeServiceKey(siteID, serviceID int64) error {
	res, err := s.DB.Exec(`UPDATE services SET revoked_at = ? WHERE id = ? AND site_id = ? AND revoked_at = 0`, time.Now().Unix(), serviceID, siteID)
	if err != nil {
		return err
	}
	if count, _ := res.RowsAffected(); count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ServiceForKey authenticates one active service key and returns the site's
// current log severities so inheritance always reflects the latest settings.
func (s *Store) ServiceForKey(key string) (Service, []string, bool, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return Service{}, nil, false, nil
	}
	service, err := scanService(s.DB.QueryRow(`SELECT `+serviceColumns+` FROM services
		WHERE key_hash = ? AND revoked_at = 0`, hashServiceKey(key)))
	if err == sql.ErrNoRows {
		return Service{}, nil, false, nil
	}
	if err != nil {
		return Service{}, nil, false, err
	}
	var config string
	if err := s.DB.QueryRow(`SELECT config FROM sites WHERE id = ?`, service.SiteID).Scan(&config); err != nil {
		return Service{}, nil, false, err
	}
	allowed := service.Severities
	if service.InheritSeverities {
		allowed = ParseSiteSettings(config).Logs.Severities
	}
	if _, err := s.DB.Exec(`UPDATE services SET last_used_at = ? WHERE id = ?`, time.Now().Unix(), service.ID); err != nil {
		return Service{}, nil, false, err
	}
	return service, allowed, true, nil
}
