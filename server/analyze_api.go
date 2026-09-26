package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	// Report day boundaries use the IANA zone stored on the report, so the
	// zone database ships inside the binary instead of depending on the host.
	_ "time/tzdata"

	"trace-ux/server/store"
)

// ---- Analyze: saved count reports (auth-protected, same-origin) ----
//
// Every route is open to both roles. Ownership, not role, decides who may
// change a report: team reports are readable by everyone and editable by
// their owner only, and a private report is a 404 for everyone else --
// admins included -- so its existence is never disclosed.

const (
	maxAnalyzeNameChars        = 120
	maxAnalyzeDescriptionChars = 1000
	maxAnalyzeDefinitionBytes  = 16 << 10
	maxAnalyzeSearchChars      = 200
	maxAnalyzeWindowDays       = 365
	// Hour windows stop at a week: beyond that, daily buckets read better.
	maxAnalyzeWindowHours = 168
	// Windows up to this many hours use 5-minute buckets (at most 72 points).
	maxAnalyzeFiveMinuteHours = 6
	// A 365-day window whose edges are snapped to local midnight can touch
	// one extra calendar day.
	maxAnalyzePoints = maxAnalyzeWindowDays + 1
	// Mirrors the ingest limits on custom event names and track ids.
	maxAnalyzeEventFieldBytes = 100
	maxAnalyzeTimezoneBytes   = 64
)

// analyzeInputError is a caller mistake: its message is safe to return as a
// 400 and never carries another user's report metadata.
type analyzeInputError struct{ msg string }

func (e analyzeInputError) Error() string { return e.msg }

func analyzeInvalid(format string, args ...any) error {
	return analyzeInputError{msg: fmt.Sprintf(format, args...)}
}

func writeAnalyzeErr(w http.ResponseWriter, err error) {
	var input analyzeInputError
	if errors.As(err, &input) {
		writeErr(w, http.StatusBadRequest, input.msg)
		return
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}

// ---- Definition validation ----

// parseAnalyzeDefinition decodes a definition strictly: unknown fields, at the
// top level or inside match, are rejected rather than silently dropped.
func parseAnalyzeDefinition(raw json.RawMessage) (store.AnalyzeDefinition, error) {
	var def store.AnalyzeDefinition
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		return def, analyzeInvalid("definition is required")
	}
	if len(raw) > maxAnalyzeDefinitionBytes {
		return def, analyzeInvalid("definition must be at most %d bytes", maxAnalyzeDefinitionBytes)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&def); err != nil {
		return def, analyzeInvalid("invalid definition: %s", describeJSONError(err))
	}
	if _, err := dec.Token(); err != io.EOF {
		return def, analyzeInvalid("invalid definition: unexpected trailing data")
	}
	if err := validateAnalyzeDefinition(def); err != nil {
		return def, err
	}
	return def, nil
}

// describeJSONError keeps decoder errors useful without echoing input values.
func describeJSONError(err error) string {
	var typeErr *json.UnmarshalTypeError
	if errors.As(err, &typeErr) && typeErr.Field != "" {
		return fmt.Sprintf("%s has the wrong type", typeErr.Field)
	}
	if msg := err.Error(); strings.HasPrefix(msg, "json: unknown field ") {
		return strings.TrimPrefix(msg, "json: ") + " is not supported"
	}
	return "malformed JSON"
}

// validateAnalyzeDefinition checks the definition's shape. It does not touch
// the database; validateAnalyzeReferences does that part.
func validateAnalyzeDefinition(def store.AnalyzeDefinition) error {
	if def.Version != 1 {
		return analyzeInvalid("definition.version must be 1")
	}
	if def.SiteID != nil && *def.SiteID <= 0 {
		return analyzeInvalid("definition.site_id must be a site id or null for all sites")
	}
	if def.Metric != "occurrences" {
		return analyzeInvalid("definition.metric must be occurrences")
	}
	m := def.Match
	switch def.Source {
	case store.AnalyzeSourceEvent:
		if strings.TrimSpace(m.Name) == "" {
			return analyzeInvalid("match.name is required for action reports")
		}
		if len(m.Name) > maxAnalyzeEventFieldBytes {
			return analyzeInvalid("match.name must be at most %d bytes", maxAnalyzeEventFieldBytes)
		}
		if len(m.TrackID) > maxAnalyzeEventFieldBytes {
			return analyzeInvalid("match.track_id must be at most %d bytes", maxAnalyzeEventFieldBytes)
		}
		if m.TrackID != "" && strings.TrimSpace(m.TrackID) == "" {
			return analyzeInvalid("match.track_id cannot be blank; omit it to match any track id")
		}
		for field, set := range map[string]bool{
			"message": m.Message != "", "message_mode": m.MessageMode != "", "severity": m.Severity != "",
			"service_id": m.ServiceID != 0, "environment": m.Environment != "",
		} {
			if set {
				return analyzeInvalid("match.%s is not supported for action reports", field)
			}
		}
	case store.AnalyzeSourceLog:
		if m.MessageMode != "" && m.MessageMode != store.AnalyzeMessageExact && m.MessageMode != store.AnalyzeMessageContains {
			return analyzeInvalid("match.message_mode must be exact or contains")
		}
		if strings.TrimSpace(m.Message) == "" {
			return analyzeInvalid("match.message is required for log reports")
		}
		if len(m.Message) > store.MaxAnalyzeLogMessageBytes {
			return analyzeInvalid("match.message must be at most %d bytes", store.MaxAnalyzeLogMessageBytes)
		}
		if m.Severity != "" && !store.ValidLogSeverity(m.Severity) {
			return analyzeInvalid("match.severity must be debug, info, warn, or error")
		}
		if m.ServiceID < 0 {
			return analyzeInvalid("match.service_id must be a service id")
		}
		if m.Environment != "" && strings.TrimSpace(m.Environment) == "" {
			return analyzeInvalid("match.environment cannot be blank; omit it to match every environment")
		}
		if len(m.Environment) > store.MaxLogEnvironmentLength {
			return analyzeInvalid("match.environment must be at most %d characters", store.MaxLogEnvironmentLength)
		}
		if m.Name != "" || m.TrackID != "" {
			return analyzeInvalid("match.name and match.track_id are not supported for log reports")
		}
	default:
		return analyzeInvalid("definition.source must be event or log")
	}
	switch {
	case def.DefaultDays != 0 && def.DefaultHours != 0:
		return analyzeInvalid("set definition.default_days or definition.default_hours, not both")
	case def.DefaultHours != 0:
		if def.DefaultHours < 1 || def.DefaultHours > maxAnalyzeWindowHours {
			return analyzeInvalid("definition.default_hours must be 1-%d", maxAnalyzeWindowHours)
		}
	case def.DefaultDays < 1 || def.DefaultDays > maxAnalyzeWindowDays:
		return analyzeInvalid("definition.default_days must be 1-%d", maxAnalyzeWindowDays)
	}
	if want := analyzeIntervalFor(def.DefaultDays, def.DefaultHours); def.Interval != want {
		return analyzeInvalid("definition.interval must be %s for this window", want)
	}
	if _, err := analyzeLocation(def.Timezone); err != nil {
		return err
	}
	if def.Visualization != "bar" && def.Visualization != "line" {
		return analyzeInvalid("definition.visualization must be bar or line")
	}
	return nil
}

// analyzeIntervalFor is the bucket size a window is drawn in. It is derived,
// never chosen, so a saved report and a temporary range of the same length
// always look alike.
func analyzeIntervalFor(days, hours int) string {
	switch {
	case hours > 0 && hours <= maxAnalyzeFiveMinuteHours:
		return store.AnalyzeIntervalFiveMinutes
	case hours > 0:
		return store.AnalyzeIntervalHour
	default:
		return store.AnalyzeIntervalDay
	}
}

// analyzeLocation resolves an IANA zone name. "Local" is refused: it would
// mean the server's zone, which is neither stable nor what the author saw.
func analyzeLocation(name string) (*time.Location, error) {
	if name == "" || name == "Local" || len(name) > maxAnalyzeTimezoneBytes {
		return nil, analyzeInvalid("definition.timezone must be an IANA timezone such as America/Tegucigalpa")
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, analyzeInvalid("definition.timezone must be an IANA timezone such as America/Tegucigalpa")
	}
	return loc, nil
}

// validateAnalyzeReferences checks that the site and service a definition
// names exist, and that the service belongs to the selected site.
func (s *Server) validateAnalyzeReferences(def store.AnalyzeDefinition) error {
	if def.SiteID != nil {
		ok, err := s.store.SiteExists(*def.SiteID)
		if err != nil {
			return err
		}
		if !ok {
			return analyzeInvalid("definition.site_id does not match a site")
		}
	}
	if def.Source == store.AnalyzeSourceLog && def.Match.ServiceID > 0 {
		siteID, found, err := s.store.ServiceSite(def.Match.ServiceID)
		if err != nil {
			return err
		}
		if !found || (def.SiteID != nil && siteID != *def.SiteID) {
			return analyzeInvalid("match.service_id does not match a service on the selected site")
		}
	}
	return nil
}

type analyzeReportBody struct {
	Name        *string         `json:"name"`
	Description *string         `json:"description"`
	Visibility  *string         `json:"visibility"`
	Definition  json.RawMessage `json:"definition"`
}

func normalizeAnalyzeName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", analyzeInvalid("name is required")
	}
	if utf8.RuneCountInString(name) > maxAnalyzeNameChars {
		return "", analyzeInvalid("name must be at most %d characters", maxAnalyzeNameChars)
	}
	return name, nil
}

func normalizeAnalyzeDescription(raw string) (string, error) {
	description := strings.TrimSpace(raw)
	if utf8.RuneCountInString(description) > maxAnalyzeDescriptionChars {
		return "", analyzeInvalid("description must be at most %d characters", maxAnalyzeDescriptionChars)
	}
	return description, nil
}

func validAnalyzeVisibility(v string) bool {
	return v == store.AnalyzeVisibilityTeam || v == store.AnalyzeVisibilityPrivate
}

// applyAnalyzeBody merges a create/patch body onto in. On create every field
// is required except the description.
func (s *Server) applyAnalyzeBody(in *store.AnalyzeReportInput, body analyzeReportBody, create bool) error {
	if body.Name != nil || create {
		name, err := normalizeAnalyzeName(deref(body.Name))
		if err != nil {
			return err
		}
		in.Name = name
	}
	if body.Description != nil {
		description, err := normalizeAnalyzeDescription(*body.Description)
		if err != nil {
			return err
		}
		in.Description = description
	}
	if body.Visibility != nil || create {
		if !validAnalyzeVisibility(deref(body.Visibility)) {
			return analyzeInvalid("visibility must be team or private")
		}
		in.Visibility = *body.Visibility
	}
	if body.Definition != nil || create {
		def, err := parseAnalyzeDefinition(body.Definition)
		if err != nil {
			return err
		}
		if err := s.validateAnalyzeReferences(def); err != nil {
			return err
		}
		in.Definition = def
	}
	return nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ---- Report handlers ----

func analyzeReportID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid report id")
		return 0, false
	}
	return id, true
}

const analyzeNotFound = "report not found"

func (s *Server) handleListAnalyzeReports(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.AnalyzeReportFilter{Scope: q.Get("scope"), Source: q.Get("source")}
	switch f.Scope {
	case "":
		f.Scope = store.AnalyzeScopeAll
	case store.AnalyzeScopeAll, store.AnalyzeScopeMine, store.AnalyzeScopeTeam:
	default:
		writeErr(w, http.StatusBadRequest, "scope must be all, mine, or team")
		return
	}
	if f.Source != "" && f.Source != store.AnalyzeSourceEvent && f.Source != store.AnalyzeSourceLog {
		writeErr(w, http.StatusBadRequest, "source must be event or log")
		return
	}
	if v := q.Get("site_id"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil || id <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid site_id")
			return
		}
		f.SiteID = id
	}
	reports, err := s.store.ListAnalyzeReports(currentUser(r).ID, f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, reports)
}

func (s *Server) handleCreateAnalyzeReport(w http.ResponseWriter, r *http.Request) {
	var body analyzeReportBody
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	var in store.AnalyzeReportInput
	if err := s.applyAnalyzeBody(&in, body, true); err != nil {
		writeAnalyzeErr(w, err)
		return
	}
	report, err := s.store.CreateAnalyzeReport(currentUser(r).ID, in)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, report)
}

func (s *Server) handleGetAnalyzeReport(w http.ResponseWriter, r *http.Request) {
	id, ok := analyzeReportID(w, r)
	if !ok {
		return
	}
	report, err := s.store.GetAnalyzeReport(id, currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if report == nil {
		writeErr(w, http.StatusNotFound, analyzeNotFound)
		return
	}
	writeJSON(w, http.StatusOK, report)
}

func (s *Server) handleUpdateAnalyzeReport(w http.ResponseWriter, r *http.Request) {
	id, ok := analyzeReportID(w, r)
	if !ok {
		return
	}
	user := currentUser(r)
	var body analyzeReportBody
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	existing, err := s.store.GetAnalyzeReport(id, user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeErr(w, http.StatusNotFound, analyzeNotFound)
		return
	}
	// Readable but not owned can only be a team report, whose existence the
	// caller already knows, so saying why is not a disclosure.
	if !existing.CanEdit {
		writeErr(w, http.StatusForbidden, "only the report's owner can edit it")
		return
	}
	in := store.AnalyzeReportInput{
		Name:        existing.Name,
		Description: existing.Description,
		Visibility:  existing.Visibility,
		Definition:  existing.Definition,
	}
	if err := s.applyAnalyzeBody(&in, body, false); err != nil {
		writeAnalyzeErr(w, err)
		return
	}
	updated, err := s.store.UpdateAnalyzeReport(id, user.ID, in)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !updated {
		writeErr(w, http.StatusNotFound, analyzeNotFound)
		return
	}
	s.writeAnalyzeReport(w, http.StatusOK, id, user.ID)
}

func (s *Server) handleDeleteAnalyzeReport(w http.ResponseWriter, r *http.Request) {
	id, ok := analyzeReportID(w, r)
	if !ok {
		return
	}
	user := currentUser(r)
	deleted, err := s.store.DeleteAnalyzeReport(id, user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !deleted {
		// Distinguish a teammate's team report (403) from anything the caller
		// cannot see at all (404), using the same visibility-aware read.
		report, err := s.store.GetAnalyzeReport(id, user.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if report != nil {
			writeErr(w, http.StatusForbidden, "only the report's owner can delete it")
			return
		}
		writeErr(w, http.StatusNotFound, analyzeNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleDuplicateAnalyzeReport copies a readable report into a new private
// report owned by the caller.
func (s *Server) handleDuplicateAnalyzeReport(w http.ResponseWriter, r *http.Request) {
	id, ok := analyzeReportID(w, r)
	if !ok {
		return
	}
	user := currentUser(r)
	source, err := s.store.GetAnalyzeReport(id, user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if source == nil {
		writeErr(w, http.StatusNotFound, analyzeNotFound)
		return
	}
	name := "Copy of " + source.Name
	if runes := []rune(name); len(runes) > maxAnalyzeNameChars {
		name = strings.TrimSpace(string(runes[:maxAnalyzeNameChars-1])) + "…"
	}
	report, err := s.store.CreateAnalyzeReport(user.ID, store.AnalyzeReportInput{
		Name:        name,
		Description: source.Description,
		Visibility:  store.AnalyzeVisibilityPrivate,
		Definition:  source.Definition,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, report)
}

func (s *Server) writeAnalyzeReport(w http.ResponseWriter, status int, id, viewerID int64) {
	report, err := s.store.GetAnalyzeReport(id, viewerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if report == nil {
		writeErr(w, http.StatusNotFound, analyzeNotFound)
		return
	}
	writeJSON(w, status, report)
}

// ---- Results ----

type analyzePoint struct {
	BucketStart int64 `json:"bucket_start"`
	Count       int64 `json:"count"`
	// Incomplete marks days that begin before retained data does: their
	// count is a lower bound, not a known value.
	Incomplete bool `json:"incomplete,omitempty"`
}

type analyzeWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type analyzeResult struct {
	From          int64            `json:"from"`
	To            int64            `json:"to"`
	Timezone      string           `json:"timezone"`
	Interval      string           `json:"interval"`
	Buckets       int              `json:"buckets"`
	Total         int64            `json:"total"`
	Average       float64          `json:"average"` // per bucket of Interval
	AvailableFrom int64            `json:"available_from"`
	Series        []analyzePoint   `json:"series"`
	Warnings      []analyzeWarning `json:"warnings"`
}

// analyzeRange is the requested window: a rolling number of hours or days, or
// explicit from/to, each an epoch-millisecond value or a YYYY-MM-DD date in
// the report's timezone. The window is [from, to). With none of them set, the
// report's own default window applies.
type analyzeRange struct {
	Hours analyzeParam `json:"hours"`
	Days  analyzeParam `json:"days"`
	From  analyzeParam `json:"from"`
	To    analyzeParam `json:"to"`
}

// analyzeParam accepts a JSON string or number, so a preview body can send
// {"days": 30} or {"from": "2026-09-01"} alike.
type analyzeParam string

func (p *analyzeParam) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*p = ""
		return nil
	}
	if len(b) > 0 && b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*p = analyzeParam(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	*p = analyzeParam(n.String())
	return nil
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func nextDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d+1, 0, 0, 0, 0, t.Location())
}

func parseAnalyzeInstant(field string, param analyzeParam, loc *time.Location) (time.Time, error) {
	raw := strings.TrimSpace(string(param))
	if raw == "" {
		return time.Time{}, analyzeInvalid("%s is required when a custom range is given", field)
	}
	if ms, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if ms <= 0 {
			return time.Time{}, analyzeInvalid("invalid %s", field)
		}
		return time.UnixMilli(ms).In(loc), nil
	}
	t, err := time.ParseInLocation("2006-01-02", raw, loc)
	if err != nil {
		return time.Time{}, analyzeInvalid("%s must be epoch milliseconds or a YYYY-MM-DD date", field)
	}
	return t, nil
}

type analyzeWindow struct {
	from, to time.Time
	interval string
}

// next returns the start of the bucket after t.
func (w analyzeWindow) next(t time.Time) time.Time {
	switch w.interval {
	case store.AnalyzeIntervalFiveMinutes:
		return t.Add(5 * time.Minute)
	case store.AnalyzeIntervalHour:
		// Absolute hours, so a DST change neither skips nor repeats a bucket.
		return t.Add(time.Hour)
	default:
		return nextDay(t)
	}
}

func parseAnalyzeCount(field string, param analyzeParam, max int) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(string(param)))
	if err != nil || n < 1 || n > max {
		return 0, analyzeInvalid("%s must be 1-%d", field, max)
	}
	return n, nil
}

// resolveAnalyzeRange turns a request into bucket-aligned bounds and the
// bucket size to draw them in. Rolling windows end with the bucket in
// progress; nothing extends past it, since periods that have not happened
// are not zeroes.
func resolveAnalyzeRange(rng analyzeRange, def store.AnalyzeDefinition, loc *time.Location, now time.Time) (analyzeWindow, error) {
	local := now.In(loc)
	endOfToday := nextDay(local)
	var from, to time.Time
	custom := rng.From != "" || rng.To != ""
	if !custom && (rng.Hours != "" || (rng.Days == "" && def.DefaultHours > 0)) {
		hours := def.DefaultHours
		if rng.Hours != "" {
			n, err := parseAnalyzeCount("hours", rng.Hours, maxAnalyzeWindowHours)
			if err != nil {
				return analyzeWindow{}, err
			}
			hours = n
		}
		w := analyzeWindow{interval: analyzeIntervalFor(0, hours)}
		if w.interval == store.AnalyzeIntervalFiveMinutes {
			w.to = local.Truncate(5 * time.Minute).Add(5 * time.Minute)
		} else {
			y, m, d := local.Date()
			w.to = time.Date(y, m, d, local.Hour(), 0, 0, 0, loc).Add(time.Hour)
		}
		w.from = w.to.Add(-time.Duration(hours) * time.Hour)
		return w, nil
	}
	if custom {
		var err error
		if from, err = parseAnalyzeInstant("from", rng.From, loc); err != nil {
			return analyzeWindow{}, err
		}
		if to, err = parseAnalyzeInstant("to", rng.To, loc); err != nil {
			return analyzeWindow{}, err
		}
		from = startOfDay(from)
		if day := startOfDay(to); !day.Equal(to) {
			to = nextDay(to)
		}
		if to.After(endOfToday) {
			to = endOfToday
		}
		if !from.Before(to) {
			return analyzeWindow{}, analyzeInvalid("from must be before to, and not in the future")
		}
	} else {
		days := def.DefaultDays
		if rng.Days != "" {
			n, err := parseAnalyzeCount("days", rng.Days, maxAnalyzeWindowDays)
			if err != nil {
				return analyzeWindow{}, err
			}
			days = n
		}
		to = endOfToday
		y, m, d := to.Date()
		from = time.Date(y, m, d-days, 0, 0, 0, 0, loc)
	}
	return analyzeWindow{from: from, to: to, interval: store.AnalyzeIntervalDay}, nil
}

// evaluateAnalyze runs a validated definition over a window and folds the
// store's slots into one point per bucket (5 minutes, an hour, or a calendar
// day in the report's timezone), empty buckets included.
func (s *Server) evaluateAnalyze(def store.AnalyzeDefinition, rng analyzeRange) (analyzeResult, error) {
	loc, err := analyzeLocation(def.Timezone)
	if err != nil {
		return analyzeResult{}, err
	}
	now := time.Now()
	window, err := resolveAnalyzeRange(rng, def, loc, now)
	if err != nil {
		return analyzeResult{}, err
	}
	var starts []int64
	for at := window.from; at.Before(window.to); at = window.next(at) {
		starts = append(starts, at.UnixMilli())
		if len(starts) > maxAnalyzePoints {
			return analyzeResult{}, analyzeInvalid("range must be %d days or fewer", maxAnalyzeWindowDays)
		}
	}
	slotMs := int64(store.AnalyzeSlotMs)
	if window.interval == store.AnalyzeIntervalFiveMinutes {
		slotMs = store.AnalyzeFineSlotMs
	}
	fromMs, toMs := window.from.UnixMilli(), window.to.UnixMilli()
	slots, err := s.store.AnalyzeSlotCounts(def, fromMs, toMs, slotMs)
	if err != nil {
		return analyzeResult{}, err
	}
	series := make([]analyzePoint, len(starts))
	for i, start := range starts {
		series[i].BucketStart = start
	}
	var total int64
	for slot, count := range slots {
		at := slot * slotMs
		i := sort.Search(len(starts), func(i int) bool { return starts[i] > at }) - 1
		if i < 0 {
			continue
		}
		series[i].Count += count
		total += count
	}

	var siteID int64
	if def.SiteID != nil {
		siteID = *def.SiteID
	}
	defaultDays := 0
	if s.cfg != nil {
		defaultDays = s.cfg.RetentionDays
	}
	cutoff, err := s.store.AnalyzeRetentionCutoffMs(def.Source, siteID, defaultDays, now)
	if err != nil {
		return analyzeResult{}, err
	}
	availableFrom := fromMs
	if cutoff > availableFrom {
		availableFrom = min(cutoff, toMs)
		for i := range series {
			series[i].Incomplete = series[i].BucketStart < availableFrom
		}
	}

	warnings := []analyzeWarning{}
	if def.Source == store.AnalyzeSourceLog && def.Match.ServiceID > 0 {
		if _, found, err := s.store.ServiceSite(def.Match.ServiceID); err != nil {
			return analyzeResult{}, err
		} else if !found {
			warnings = append(warnings, analyzeWarning{
				Code:    "service_missing",
				Message: "The service this report filters on no longer exists, so no new logs can match. Edit the report to choose another service.",
			})
		}
	}

	return analyzeResult{
		From:          fromMs,
		To:            toMs,
		Timezone:      def.Timezone,
		Interval:      window.interval,
		Buckets:       len(series),
		Total:         total,
		Average:       math.Round(float64(total)/float64(len(series))*100) / 100,
		AvailableFrom: availableFrom,
		Series:        series,
		Warnings:      warnings,
	}, nil
}

func (s *Server) handleAnalyzeReportResults(w http.ResponseWriter, r *http.Request) {
	id, ok := analyzeReportID(w, r)
	if !ok {
		return
	}
	report, err := s.store.GetAnalyzeReport(id, currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if report == nil {
		writeErr(w, http.StatusNotFound, analyzeNotFound)
		return
	}
	// The stored definition is re-validated like any other input rather than
	// trusted because it was valid when saved.
	if err := validateAnalyzeDefinition(report.Definition); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "this report's saved definition is no longer valid: "+err.Error())
		return
	}
	if report.Definition.SiteID != nil {
		if ok, err := s.store.SiteExists(*report.Definition.SiteID); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		} else if !ok {
			writeErr(w, http.StatusNotFound, analyzeNotFound)
			return
		}
	}
	q := r.URL.Query()
	result, err := s.evaluateAnalyze(report.Definition, analyzeRange{
		Hours: analyzeParam(q.Get("hours")),
		Days:  analyzeParam(q.Get("days")),
		From:  analyzeParam(q.Get("from")),
		To:    analyzeParam(q.Get("to")),
	})
	if err != nil {
		writeAnalyzeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handleAnalyzePreview evaluates an unsaved definition with the same
// validation a save would apply.
func (s *Server) handleAnalyzePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Definition json.RawMessage `json:"definition"`
		analyzeRange
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	def, err := parseAnalyzeDefinition(body.Definition)
	if err != nil {
		writeAnalyzeErr(w, err)
		return
	}
	if err := s.validateAnalyzeReferences(def); err != nil {
		writeAnalyzeErr(w, err)
		return
	}
	result, err := s.evaluateAnalyze(def, body.analyzeRange)
	if err != nil {
		writeAnalyzeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handleAnalyzeOptions returns bounded builder suggestions for one source.
// Suggestions carry exact values; a saved report never references their rows.
func (s *Server) handleAnalyzeOptions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var siteID int64
	if v := q.Get("site_id"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil || id <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid site_id")
			return
		}
		siteID = id
	}
	search := strings.TrimSpace(q.Get("search"))
	if utf8.RuneCountInString(search) > maxAnalyzeSearchChars {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("search must be at most %d characters", maxAnalyzeSearchChars))
		return
	}
	now := time.Now()
	switch q.Get("source") {
	case store.AnalyzeSourceEvent:
		options, err := s.store.AnalyzeEventOptions(siteID, search, now)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"events": options})
	case store.AnalyzeSourceLog:
		options, err := s.store.AnalyzeLogOptions(siteID, search, now)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"logs": options})
	default:
		writeErr(w, http.StatusBadRequest, "source must be event or log")
	}
}
