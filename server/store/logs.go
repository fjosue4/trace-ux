package store

import (
	"strings"
	"time"
)

const (
	LogSeverityDebug = "debug"
	LogSeverityInfo  = "info"
	LogSeverityWarn  = "warn"
	LogSeverityError = "error"

	defaultLogRetentionDays = 15
	defaultLogMaxRows       = 1_000_000
	maxLogRetentionDays     = 3650
	maxLogRows              = 10_000_000
	MaxLogListLimit         = 1000
)

// LogSettings controls the browser logs captured for one site. Severities are
// an explicit allow-list enforced both by the tracker and by the ingest
// handler. MinimumSeverity remains in the JSON shape for older trackers and
// dashboards; it is derived from Severities for new settings and used to
// migrate older threshold-based settings.
type LogSettings struct {
	Enabled         bool     `json:"enabled"`
	Severities      []string `json:"severities"`
	MinimumSeverity string   `json:"minimum_severity"`
	RetentionDays   int      `json:"retention_days"`
	MaxRows         int      `json:"max_rows"`
}

func DefaultLogSettings() LogSettings {
	return LogSettings{
		Enabled:         false,
		Severities:      []string{LogSeverityError},
		MinimumSeverity: LogSeverityError,
		RetentionDays:   defaultLogRetentionDays,
		MaxRows:         defaultLogMaxRows,
	}
}

func ValidLogSeverity(value string) bool {
	switch value {
	case LogSeverityDebug, LogSeverityInfo, LogSeverityWarn, LogSeverityError:
		return true
	default:
		return false
	}
}

func logSeverityRank(value string) int {
	switch value {
	case LogSeverityDebug:
		return 0
	case LogSeverityInfo:
		return 1
	case LogSeverityWarn:
		return 2
	case LogSeverityError:
		return 3
	default:
		return -1
	}
}

var allLogSeverities = []string{
	LogSeverityDebug,
	LogSeverityInfo,
	LogSeverityWarn,
	LogSeverityError,
}

// LogSeveritiesAtOrAbove converts a legacy minimum threshold into the
// equivalent explicit selection.
func LogSeveritiesAtOrAbove(minimum string) []string {
	minimumRank := logSeverityRank(minimum)
	if minimumRank < 0 {
		minimumRank = logSeverityRank(LogSeverityError)
	}
	selected := make([]string, 0, len(allLogSeverities)-minimumRank)
	for _, severity := range allLogSeverities {
		if logSeverityRank(severity) >= minimumRank {
			selected = append(selected, severity)
		}
	}
	return selected
}

// ValidLogSeverities validates the explicit capture selection. An empty list
// is valid and means that no browser log levels are captured; the separate
// enabled switch remains available for turning capture off altogether.
func ValidLogSeverities(values []string) bool {
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if !ValidLogSeverity(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

// NormalizeLogSettings migrates legacy threshold settings and keeps the
// compatibility minimum in sync with the lowest explicitly selected level.
func NormalizeLogSettings(settings *LogSettings) {
	if settings.Severities == nil {
		settings.Severities = LogSeveritiesAtOrAbove(settings.MinimumSeverity)
	}
	if !ValidLogSeverities(settings.Severities) {
		settings.Severities = []string{LogSeverityError}
	}

	// Store the selection in a stable severity order regardless of click order.
	selected := make(map[string]bool, len(settings.Severities))
	for _, severity := range settings.Severities {
		selected[severity] = true
	}
	ordered := make([]string, 0, len(selected))
	for _, severity := range allLogSeverities {
		if selected[severity] {
			ordered = append(ordered, severity)
		}
	}
	settings.Severities = ordered
	if len(ordered) == 0 {
		settings.MinimumSeverity = LogSeverityError
	} else {
		settings.MinimumSeverity = ordered[0]
	}
}

// LogSeveritySelected reports whether a severity is in an explicit capture
// selection. An empty selection intentionally matches nothing.
func LogSeveritySelected(value string, selected []string) bool {
	if !ValidLogSeverity(value) || !ValidLogSeverities(selected) {
		return false
	}
	for _, severity := range selected {
		if value == severity {
			return true
		}
	}
	return false
}

func LogMeetsMinimumSeverity(value, minimum string) bool {
	return ValidLogSeverity(value) && ValidLogSeverity(minimum) &&
		logSeverityRank(value) >= logSeverityRank(minimum)
}

// ---- Logs ----

type Log struct {
	ID               int64  `json:"id"`
	SessionID        string `json:"session_id"`
	SiteID           int64  `json:"site_id"`
	SiteName         string `json:"site_name,omitempty"`
	TimestampMs      int64  `json:"timestamp_ms"`
	Severity         string `json:"severity"`
	Message          string `json:"message"`
	URL              string `json:"url"`
	CreatedAt        int64  `json:"created_at"`
	SessionStartedAt int64  `json:"session_started_at"`
	ClientSeq        int64  `json:"-"`
}

type LogFilter struct {
	SiteID     int64
	Severity   string
	Severities []string
	Search     string
	SessionID  string
	FromMs     int64
	ToMs       int64
	BeforeID   int64
	Limit      int
}

type LogStats struct {
	Total int64 `json:"total"`
	Debug int64 `json:"debug"`
	Info  int64 `json:"info"`
	Warn  int64 `json:"warn"`
	Error int64 `json:"error"`
}

// SaveLogs stores logs for a session. client_seq makes tracker retries
// idempotent without exposing the deduplication key in dashboard responses.
// It returns the subset of logs that were newly inserted -- as opposed to
// ignored duplicates from a retried ingest request -- so a caller dispatching
// Slack notifications never sends the same log twice.
func (s *Store) SaveLogs(siteID int64, sessionID string, logs []Log) ([]Log, error) {
	now := time.Now().Unix()
	if err := s.EnsureSessionForSite(siteID, sessionID, now); err != nil {
		return nil, err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	inserted := make([]Log, 0, len(logs))
	for _, item := range logs {
		res, err := tx.Exec(`INSERT OR IGNORE INTO logs
			(session_id, client_seq, timestamp_ms, severity, message, url, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			sessionID, item.ClientSeq, item.TimestampMs, item.Severity, item.Message, item.URL, now)
		if err != nil {
			return nil, err
		}
		if n, err := res.RowsAffected(); err == nil && n > 0 {
			item.SessionID = sessionID
			item.SiteID = siteID
			item.CreatedAt = now
			inserted = append(inserted, item)
		}
	}
	if _, err := tx.Exec(`UPDATE sessions SET last_seen = ? WHERE id = ? AND site_id = ?`, now, sessionID, siteID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return inserted, nil
}

// ListLogs returns newest logs first. Logs are joined to their session
// and site so the global Logs page can link each row back to its recording.
func (s *Store) ListLogs(f LogFilter) ([]Log, error) {
	query := `SELECT l.id, l.session_id, se.site_id, si.name, l.timestamp_ms,
		l.severity, l.message, l.url, l.created_at, se.started_at
		FROM logs l
		JOIN sessions se ON se.id = l.session_id
		JOIN sites si ON si.id = se.site_id
		WHERE 1=1`
	args := []any{}
	if f.SiteID > 0 {
		query += ` AND se.site_id = ?`
		args = append(args, f.SiteID)
	}
	severities := f.Severities
	if len(severities) == 0 && f.Severity != "" {
		severities = []string{f.Severity}
	}
	if len(severities) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(severities)), ",")
		query += ` AND l.severity IN (` + placeholders + `)`
		for _, severity := range severities {
			args = append(args, severity)
		}
	}
	if f.Search != "" {
		query += ` AND (instr(lower(l.message), lower(?)) > 0
			OR instr(lower(l.url), lower(?)) > 0
			OR instr(lower(si.name), lower(?)) > 0
			OR instr(lower(l.session_id), lower(?)) > 0)`
		args = append(args, f.Search, f.Search, f.Search, f.Search)
	}
	if f.SessionID != "" {
		query += ` AND l.session_id = ?`
		args = append(args, f.SessionID)
	}
	if f.FromMs > 0 {
		query += ` AND l.timestamp_ms >= ?`
		args = append(args, f.FromMs)
	}
	if f.ToMs > 0 {
		query += ` AND l.timestamp_ms <= ?`
		args = append(args, f.ToMs)
	}
	if f.BeforeID > 0 {
		query += ` AND l.id < ?`
		args = append(args, f.BeforeID)
	}
	limit := f.Limit
	if limit <= 0 || limit > MaxLogListLimit {
		limit = MaxLogListLimit
	}
	query += ` ORDER BY l.id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Log{}
	for rows.Next() {
		var item Log
		if err := rows.Scan(&item.ID, &item.SessionID, &item.SiteID, &item.SiteName,
			&item.TimestampMs, &item.Severity, &item.Message, &item.URL,
			&item.CreatedAt, &item.SessionStartedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// LogStats returns counts for a site and optional event-time window. Severity
// is intentionally ignored so the dashboard summary remains comparable while
// the table's severity filter changes.
func (s *Store) LogStats(f LogFilter) (LogStats, error) {
	var stats LogStats
	query := `SELECT l.severity, COUNT(*)
		FROM logs l JOIN sessions se ON se.id = l.session_id
		WHERE 1=1`
	args := []any{}
	if f.SiteID > 0 {
		query += ` AND se.site_id = ?`
		args = append(args, f.SiteID)
	}
	if f.FromMs > 0 {
		query += ` AND l.timestamp_ms >= ?`
		args = append(args, f.FromMs)
	}
	if f.ToMs > 0 {
		query += ` AND l.timestamp_ms <= ?`
		args = append(args, f.ToMs)
	}
	query += ` GROUP BY l.severity`
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	for rows.Next() {
		var severity string
		var count int64
		if err := rows.Scan(&severity, &count); err != nil {
			return stats, err
		}
		switch severity {
		case LogSeverityDebug:
			stats.Debug = count
		case LogSeverityInfo:
			stats.Info = count
		case LogSeverityWarn:
			stats.Warn = count
		case LogSeverityError:
			stats.Error = count
		}
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	stats.Total = stats.Debug + stats.Info + stats.Warn + stats.Error
	return stats, nil
}
