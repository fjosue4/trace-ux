package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ---- Analyze: saved count reports over tracked actions or logs ----
//
// A report stores its definition, never its result. Visibility is enforced by
// every read and write query here rather than by the caller inspecting a row
// it already fetched: a private report is simply not found for anyone but its
// owner, so its name and existence never leave the store.

const (
	AnalyzeSourceEvent = "event"
	AnalyzeSourceLog   = "log"

	AnalyzeVisibilityTeam    = "team"
	AnalyzeVisibilityPrivate = "private"

	AnalyzeScopeAll  = "all"
	AnalyzeScopeMine = "mine"
	AnalyzeScopeTeam = "team"

	// Bucket sizes. A report's interval follows from its window: minutes for
	// the last few hours, hours for up to a week, calendar days beyond that.
	AnalyzeIntervalFiveMinutes = "5min"
	AnalyzeIntervalHour        = "hour"
	AnalyzeIntervalDay         = "day"

	// Counts are gathered in slots and folded into buckets by the caller.
	// Every IANA offset in use is a multiple of 15 minutes, so a local
	// midnight or hour always falls on a 15-minute slot boundary and no slot
	// straddles two buckets in any timezone. 5-minute buckets use 5-minute
	// slots, which divide those boundaries too.
	AnalyzeSlotMs     = 15 * 60 * 1000
	AnalyzeFineSlotMs = 5 * 60 * 1000

	// How a log report compares its message. Exact is case-sensitive equality;
	// contains is a case-insensitive substring match, the same rule as the Logs
	// page search. A definition without a mode predates contains and is exact.
	AnalyzeMessageExact    = "exact"
	AnalyzeMessageContains = "contains"

	MaxAnalyzeReportsListed = 500
	MaxAnalyzeOptions       = 50
	// The saved message or pattern is bounded so a definition stays small.
	MaxAnalyzeLogMessageBytes = 4096
	// Suggestions for messages longer than MaxAnalyzeLogMessageBytes carry
	// only their opening characters: a prefix still works as a contains
	// pattern, and the dashboard never has to receive a multi-megabyte log.
	analyzeOptionPrefixChars = 1000
	// Suggestions look back this far. Recent activity is what a new report is
	// built from, and it keeps the GROUP BY over logs bounded.
	analyzeOptionsLookback = 30 * 24 * time.Hour
)

// AnalyzeMatch holds the exact-match rule. Which fields are allowed depends on
// the definition's source; the API validator enforces that.
type AnalyzeMatch struct {
	// Action/event source.
	Name    string `json:"name,omitempty"`
	TrackID string `json:"track_id,omitempty"`
	// Log source.
	Message     string `json:"message,omitempty"`
	MessageMode string `json:"message_mode,omitempty"` // exact (default) | contains
	Severity    string `json:"severity,omitempty"`
	ServiceID   int64  `json:"service_id,omitempty"`
	Environment string `json:"environment,omitempty"`
}

// AnalyzeDefinition is the versioned, validated report definition. SiteID nil
// means All sites.
type AnalyzeDefinition struct {
	Version int          `json:"version"`
	Source  string       `json:"source"`
	SiteID  *int64       `json:"site_id"`
	Metric  string       `json:"metric"`
	Match   AnalyzeMatch `json:"match"`
	// Exactly one of DefaultDays and DefaultHours is set: the rolling window
	// the report opens on.
	DefaultDays   int    `json:"default_days,omitempty"`
	DefaultHours  int    `json:"default_hours,omitempty"`
	Interval      string `json:"interval"`
	Timezone      string `json:"timezone"`
	Visualization string `json:"visualization"`
}

type AnalyzeReportOwner struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type AnalyzeReport struct {
	ID          int64              `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Visibility  string             `json:"visibility"`
	Source      string             `json:"source"`
	SiteID      *int64             `json:"site_id"`
	SiteName    string             `json:"site_name,omitempty"`
	Owner       AnalyzeReportOwner `json:"owner"`
	CanEdit     bool               `json:"can_edit"`
	Definition  AnalyzeDefinition  `json:"definition"`
	CreatedAt   int64              `json:"created_at"`
	UpdatedAt   int64              `json:"updated_at"`
}

// AnalyzeReportInput is a complete, already-validated report to write.
type AnalyzeReportInput struct {
	Name        string
	Description string
	Visibility  string
	Definition  AnalyzeDefinition
}

type AnalyzeReportFilter struct {
	Scope  string // all | mine | team
	SiteID int64  // 0 = no site filter
	Source string // "" = any source
}

const analyzeReportSelect = `SELECT r.id, r.name, r.description, r.visibility, r.source, r.site_id,
		COALESCE(si.name, ''), r.owner_user_id, u.username, r.definition, r.created_at, r.updated_at
		FROM analyze_reports r
		JOIN users u ON u.id = r.owner_user_id
		LEFT JOIN sites si ON si.id = r.site_id`

// analyzeReadable is the visibility predicate every read goes through.
const analyzeReadable = `(r.visibility = 'team' OR r.owner_user_id = ?)`

func scanAnalyzeReport(row interface{ Scan(...any) error }, viewerID int64) (*AnalyzeReport, error) {
	var r AnalyzeReport
	var siteID sql.NullInt64
	var definition string
	if err := row.Scan(&r.ID, &r.Name, &r.Description, &r.Visibility, &r.Source, &siteID,
		&r.SiteName, &r.Owner.ID, &r.Owner.Username, &definition, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	if siteID.Valid {
		id := siteID.Int64
		r.SiteID = &id
	}
	if err := json.Unmarshal([]byte(definition), &r.Definition); err != nil {
		return nil, fmt.Errorf("analyze report %d: stored definition is unreadable: %w", r.ID, err)
	}
	r.CanEdit = r.Owner.ID == viewerID
	return &r, nil
}

func encodeAnalyzeDefinition(def AnalyzeDefinition) (string, any, error) {
	raw, err := json.Marshal(def)
	if err != nil {
		return "", nil, err
	}
	var siteID any
	if def.SiteID != nil {
		siteID = *def.SiteID
	}
	return string(raw), siteID, nil
}

func (s *Store) CreateAnalyzeReport(ownerID int64, in AnalyzeReportInput) (*AnalyzeReport, error) {
	definition, siteID, err := encodeAnalyzeDefinition(in.Definition)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	res, err := s.DB.Exec(`INSERT INTO analyze_reports
		(owner_user_id, name, description, visibility, source, site_id, definition, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ownerID, in.Name, in.Description, in.Visibility, in.Definition.Source, siteID, definition, now, now)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.GetAnalyzeReport(id, ownerID)
}

// GetAnalyzeReport returns a report the viewer may read, or nil. A private
// report of another user is indistinguishable from one that does not exist.
func (s *Store) GetAnalyzeReport(id, viewerID int64) (*AnalyzeReport, error) {
	r, err := scanAnalyzeReport(s.DB.QueryRow(analyzeReportSelect+`
		WHERE r.id = ? AND `+analyzeReadable, id, viewerID), viewerID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return r, err
}

func (s *Store) ListAnalyzeReports(viewerID int64, f AnalyzeReportFilter) ([]AnalyzeReport, error) {
	query := analyzeReportSelect
	args := []any{}
	switch f.Scope {
	case AnalyzeScopeMine:
		query += ` WHERE r.owner_user_id = ?`
		args = append(args, viewerID)
	case AnalyzeScopeTeam:
		query += ` WHERE r.visibility = 'team'`
	default:
		query += ` WHERE ` + analyzeReadable
		args = append(args, viewerID)
	}
	if f.SiteID > 0 {
		query += ` AND r.site_id = ?`
		args = append(args, f.SiteID)
	}
	if f.Source != "" {
		query += ` AND r.source = ?`
		args = append(args, f.Source)
	}
	query += ` ORDER BY r.updated_at DESC, r.id DESC LIMIT ?`
	args = append(args, MaxAnalyzeReportsListed)

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AnalyzeReport{}
	for rows.Next() {
		r, err := scanAnalyzeReport(rows, viewerID)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// UpdateAnalyzeReport replaces a report's definition and metadata. It changes
// nothing, and reports false, unless ownerID owns the report.
func (s *Store) UpdateAnalyzeReport(id, ownerID int64, in AnalyzeReportInput) (bool, error) {
	definition, siteID, err := encodeAnalyzeDefinition(in.Definition)
	if err != nil {
		return false, err
	}
	res, err := s.DB.Exec(`UPDATE analyze_reports
		SET name = ?, description = ?, visibility = ?, source = ?, site_id = ?, definition = ?, updated_at = ?
		WHERE id = ? AND owner_user_id = ?`,
		in.Name, in.Description, in.Visibility, in.Definition.Source, siteID, definition, time.Now().Unix(),
		id, ownerID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// DeleteAnalyzeReport removes a report only when ownerID owns it.
func (s *Store) DeleteAnalyzeReport(id, ownerID int64) (bool, error) {
	res, err := s.DB.Exec(`DELETE FROM analyze_reports WHERE id = ? AND owner_user_id = ?`, id, ownerID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ---- Aggregation ----

// AnalyzeSlotCounts counts a definition's matches in [fromMs, toMs), keyed by
// slot index (timestamp / slotMs). Only the columns and comparisons below are
// ever queried; definition values are bound parameters.
func (s *Store) AnalyzeSlotCounts(def AnalyzeDefinition, fromMs, toMs, slotMs int64) (map[int64]int64, error) {
	if slotMs != AnalyzeSlotMs && slotMs != AnalyzeFineSlotMs {
		return nil, errors.New("unsupported analyze slot size")
	}
	switch def.Source {
	case AnalyzeSourceEvent:
		return s.analyzeEvents(def, fromMs, toMs, slotMs)
	case AnalyzeSourceLog:
		return s.analyzeLogs(def, fromMs, toMs, slotMs)
	default:
		return nil, errors.New("unsupported analyze source")
	}
}

func (s *Store) analyzeEvents(def AnalyzeDefinition, fromMs, toMs, slotMs int64) (map[int64]int64, error) {
	query := `SELECT ce.ts / ?, COUNT(*) FROM custom_events ce`
	args := []any{slotMs}
	if def.SiteID != nil {
		query += ` JOIN sessions se ON se.id = ce.session_id AND se.site_id = ?`
		args = append(args, *def.SiteID)
	}
	query += ` WHERE ce.name = ?`
	args = append(args, def.Match.Name)
	if def.Match.TrackID != "" {
		query += ` AND ce.track_id = ?`
		args = append(args, def.Match.TrackID)
	}
	query += ` AND ce.ts >= ? AND ce.ts < ? GROUP BY 1`
	args = append(args, fromMs, toMs)
	return s.analyzeSlots(query, args)
}

func (s *Store) analyzeLogs(def AnalyzeDefinition, fromMs, toMs, slotMs int64) (map[int64]int64, error) {
	query := `SELECT l.timestamp_ms / ?, COUNT(*) FROM logs l WHERE 1=1`
	args := []any{slotMs}
	if def.SiteID != nil {
		query += ` AND l.site_id = ?`
		args = append(args, *def.SiteID)
	}
	query += ` AND l.timestamp_ms >= ? AND l.timestamp_ms < ?`
	args = append(args, fromMs, toMs)
	if def.Match.MessageMode == AnalyzeMessageContains {
		query += ` AND instr(lower(l.message), lower(?)) > 0`
	} else {
		query += ` AND l.message = ?`
	}
	args = append(args, def.Match.Message)
	if def.Match.Severity != "" {
		query += ` AND l.severity = ?`
		args = append(args, def.Match.Severity)
	}
	if def.Match.ServiceID > 0 {
		query += ` AND l.service_id = ?`
		args = append(args, def.Match.ServiceID)
	}
	if def.Match.Environment != "" {
		query += ` AND l.environment = ?`
		args = append(args, def.Match.Environment)
	}
	query += ` GROUP BY 1`
	return s.analyzeSlots(query, args)
}

func (s *Store) analyzeSlots(query string, args []any) (map[int64]int64, error) {
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int64{}
	for rows.Next() {
		var slot, count int64
		if err := rows.Scan(&slot, &count); err != nil {
			return nil, err
		}
		out[slot] = count
	}
	return out, rows.Err()
}

// AnalyzeRetentionCutoffMs returns the instant from which a source's stored
// data is complete, for one site or (siteID 0) every site, or 0 when nothing
// has been pruned by time. Across sites the latest cutoff wins: before it, at
// least one site's data may already be gone.
func (s *Store) AnalyzeRetentionCutoffMs(source string, siteID int64, defaultSessionDays int, now time.Time) (int64, error) {
	query := `SELECT config FROM sites`
	args := []any{}
	if siteID > 0 {
		query += ` WHERE id = ?`
		args = append(args, siteID)
	}
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var cutoff int64
	for rows.Next() {
		var config string
		if err := rows.Scan(&config); err != nil {
			return 0, err
		}
		settings := ParseSiteSettings(config)
		days := 0
		switch source {
		case AnalyzeSourceEvent:
			days = settings.RetentionSessionsDays
			if days <= 0 {
				days = defaultSessionDays
			}
		case AnalyzeSourceLog:
			days = settings.Logs.RetentionDays
		}
		if days <= 0 {
			continue
		}
		if c := now.AddDate(0, 0, -days).UnixMilli(); c > cutoff {
			cutoff = c
		}
	}
	return cutoff, rows.Err()
}

// ---- Builder support ----

func (s *Store) SiteExists(id int64) (bool, error) {
	var one int
	err := s.DB.QueryRow(`SELECT 1 FROM sites WHERE id = ?`, id).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

// ServiceSite returns the site a service belongs to, or found=false.
func (s *Store) ServiceSite(serviceID int64) (siteID int64, found bool, err error) {
	err = s.DB.QueryRow(`SELECT site_id FROM services WHERE id = ?`, serviceID).Scan(&siteID)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	return siteID, err == nil, err
}

type AnalyzeEventOption struct {
	Name       string `json:"name"`
	TrackID    string `json:"track_id"`
	Count      int64  `json:"count"`
	LastSeenMs int64  `json:"last_seen_ms"`
}

type AnalyzeLogOption struct {
	Message string `json:"message"`
	// Truncated means Message is only the opening of a longer log: usable as
	// a contains pattern, never as an exact match.
	Truncated  bool   `json:"truncated,omitempty"`
	Severity   string `json:"severity"`
	Count      int64  `json:"count"`
	LastSeenMs int64  `json:"last_seen_ms"`
}

// AnalyzeEventOptions suggests recently seen action name/track_id pairs,
// most frequent first, never crossing the selected site.
func (s *Store) AnalyzeEventOptions(siteID int64, search string, now time.Time) ([]AnalyzeEventOption, error) {
	query := `SELECT ce.name, ce.track_id, COUNT(*), MAX(ce.ts) FROM custom_events ce`
	args := []any{}
	if siteID > 0 {
		query += ` JOIN sessions se ON se.id = ce.session_id AND se.site_id = ?`
		args = append(args, siteID)
	}
	query += ` WHERE ce.ts >= ?`
	args = append(args, now.Add(-analyzeOptionsLookback).UnixMilli())
	if search != "" {
		query += ` AND (instr(lower(ce.name), lower(?)) > 0 OR instr(lower(ce.track_id), lower(?)) > 0)`
		args = append(args, search, search)
	}
	query += ` GROUP BY ce.name, ce.track_id ORDER BY COUNT(*) DESC, MAX(ce.ts) DESC LIMIT ?`
	args = append(args, MaxAnalyzeOptions)

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AnalyzeEventOption{}
	for rows.Next() {
		var o AnalyzeEventOption
		if err := rows.Scan(&o.Name, &o.TrackID, &o.Count, &o.LastSeenMs); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// AnalyzeLogOptions suggests recently seen log messages with their severity,
// most frequent first. Messages too long to save come back as their opening
// characters, flagged as truncated.
func (s *Store) AnalyzeLogOptions(siteID int64, search string, now time.Time) ([]AnalyzeLogOption, error) {
	query := `SELECT CASE WHEN length(CAST(l.message AS BLOB)) <= ? THEN l.message ELSE substr(l.message, 1, ?) END,
		length(CAST(l.message AS BLOB)) > ?, l.severity, COUNT(*), MAX(l.timestamp_ms) FROM logs l WHERE 1=1`
	args := []any{MaxAnalyzeLogMessageBytes, analyzeOptionPrefixChars, MaxAnalyzeLogMessageBytes}
	if siteID > 0 {
		query += ` AND l.site_id = ?`
		args = append(args, siteID)
	}
	query += ` AND l.timestamp_ms >= ?`
	args = append(args, now.Add(-analyzeOptionsLookback).UnixMilli())
	if search != "" {
		query += ` AND instr(lower(l.message), lower(?)) > 0`
		args = append(args, search)
	}
	query += ` GROUP BY l.message, l.severity ORDER BY COUNT(*) DESC, MAX(l.timestamp_ms) DESC LIMIT ?`
	args = append(args, MaxAnalyzeOptions)

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AnalyzeLogOption{}
	for rows.Next() {
		var o AnalyzeLogOption
		if err := rows.Scan(&o.Message, &o.Truncated, &o.Severity, &o.Count, &o.LastSeenMs); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
