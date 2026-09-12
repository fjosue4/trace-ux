package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// Performance metrics are kept as fixed-width histograms. The upper bounds
// are deliberately broad enough for normal web requests while the final
// overflow bucket preserves counts for slow requests.
var performanceLatencyBounds = []int64{
	10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000,
}

const (
	performanceHistogramBuckets          = 12 // eleven bounds plus +Inf
	maxPerformanceObservationCount       = 1_000
	maxPerformanceDimensionLength        = 128
	maxPerformanceEndpointLength         = 512
	maxPerformanceQueryLimit             = 200
	maxPerformanceSeriesPoints           = 120
	maxPerformanceDurationMs       int64 = 60 * 60 * 1_000
)

// PerformanceObservation is the small, backend-facing payload accepted by the
// TraceUX performance ingestion endpoint. A future language agent or OTLP
// adapter can translate spans into the same shape before persistence.
type PerformanceObservation struct {
	Environment string `json:"environment"`
	Service     string `json:"service"`
	Version     string `json:"version"`
	Endpoint    string `json:"endpoint"`
	DurationMs  int64  `json:"duration_ms"`
	StatusCode  int    `json:"status_code,omitempty"`
	Error       bool   `json:"error,omitempty"`
	TimestampMs int64  `json:"timestamp_ms,omitempty"`
}

type PerformanceFilter struct {
	SiteID      int64
	Environment string
	Service     string
	Version     string
	From        int64 // unix seconds, inclusive
	To          int64 // unix seconds, exclusive
	Limit       int
}

type PerformanceStats struct {
	Requests  int64   `json:"requests"`
	Errors    int64   `json:"errors"`
	ErrorRate float64 `json:"error_rate"` // percentage, 0-100
	AvgMs     float64 `json:"avg_ms"`
	P50Ms     float64 `json:"p50_ms"`
	P95Ms     float64 `json:"p95_ms"`
	P99Ms     float64 `json:"p99_ms"`
}

type PerformanceSeriesPoint struct {
	BucketStart int64   `json:"bucket_start"`
	Requests    int64   `json:"requests"`
	P50Ms       float64 `json:"p50_ms"`
	P95Ms       float64 `json:"p95_ms"`
	P99Ms       float64 `json:"p99_ms"`
}

type PerformanceEndpoint struct {
	SiteID      int64  `json:"site_id"`
	SiteName    string `json:"site_name,omitempty"`
	Endpoint    string `json:"endpoint"`
	Environment string `json:"environment"`
	Service     string `json:"service"`
	Version     string `json:"version"`
	PerformanceStats
	Series []PerformanceSeriesPoint `json:"series"`
}

type PerformanceFilterOptions struct {
	Environments []string `json:"environments"`
	Services     []string `json:"services"`
	Versions     []string `json:"versions"`
}

type PerformanceReport struct {
	From      int64                    `json:"from"`
	To        int64                    `json:"to"`
	Summary   PerformanceStats         `json:"summary"`
	Endpoints []PerformanceEndpoint    `json:"endpoints"`
	Filters   PerformanceFilterOptions `json:"filters"`
}

type performanceMetricRow struct {
	SiteID        int64
	SiteName      string
	BucketStart   int64
	Environment   string
	Service       string
	Version       string
	Endpoint      string
	RequestCount  int64
	ErrorCount    int64
	DurationSumMs int64
	MaxDurationMs int64
	BucketCounts  []int64
}

type performanceAggregate struct {
	Requests      int64
	Errors        int64
	DurationSumMs int64
	MaxDurationMs int64
	Buckets       []int64
}

func newPerformanceAggregate() performanceAggregate {
	return performanceAggregate{Buckets: make([]int64, performanceHistogramBuckets)}
}

func (a *performanceAggregate) addRow(row performanceMetricRow) {
	if len(a.Buckets) != performanceHistogramBuckets {
		a.Buckets = make([]int64, performanceHistogramBuckets)
	}
	a.Requests += row.RequestCount
	a.Errors += row.ErrorCount
	a.DurationSumMs += row.DurationSumMs
	if row.MaxDurationMs > a.MaxDurationMs {
		a.MaxDurationMs = row.MaxDurationMs
	}
	for i, count := range row.BucketCounts {
		if i >= len(a.Buckets) {
			break
		}
		a.Buckets[i] += count
	}
}

func (a performanceAggregate) stats() PerformanceStats {
	stats := PerformanceStats{
		Requests: a.Requests,
		Errors:   a.Errors,
		P50Ms:    percentileFromHistogram(a.Buckets, a.Requests, a.MaxDurationMs, 0.50),
		P95Ms:    percentileFromHistogram(a.Buckets, a.Requests, a.MaxDurationMs, 0.95),
		P99Ms:    percentileFromHistogram(a.Buckets, a.Requests, a.MaxDurationMs, 0.99),
	}
	if a.Requests > 0 {
		stats.AvgMs = float64(a.DurationSumMs) / float64(a.Requests)
		stats.ErrorRate = float64(a.Errors) * 100 / float64(a.Requests)
	}
	return stats
}

func percentileFromHistogram(buckets []int64, requests, maxDurationMs int64, percentile float64) float64 {
	if requests <= 0 || len(buckets) == 0 {
		return 0
	}
	target := int64(math.Ceil(float64(requests) * percentile))
	if target < 1 {
		target = 1
	}
	var seen int64
	for i, count := range buckets {
		seen += count
		if seen < target {
			continue
		}
		if i < len(performanceLatencyBounds) {
			return float64(performanceLatencyBounds[i])
		}
		if maxDurationMs > 0 {
			return float64(maxDurationMs)
		}
		return float64(performanceLatencyBounds[len(performanceLatencyBounds)-1])
	}
	return float64(maxDurationMs)
}

func newPerformanceKey() string {
	return "tux_apm_" + newKey(24)
}

func hashPerformanceKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// PerformanceKeyInfo is safe to return to the dashboard. The raw key is never
// stored or returned by list endpoints.
type PerformanceKeyInfo struct {
	ID         int64  `json:"id"`
	KeyHint    string `json:"key_hint"`
	CreatedAt  int64  `json:"created_at"`
	LastUsedAt int64  `json:"last_used_at"`
}

func performanceKeyHint(prefix, suffix string) string {
	prefix = strings.TrimSpace(prefix)
	if len(prefix) > 4 {
		prefix = prefix[:4]
	}
	for len(prefix) < 4 {
		prefix += "?"
	}
	suffix = strings.TrimSpace(suffix)
	if len(suffix) > 4 {
		suffix = suffix[len(suffix)-4:]
	}
	if len(suffix) != 4 {
		suffix = "????"
	}
	return prefix + "…" + suffix
}

func (s *Store) CreatePerformanceKey(siteID int64) (PerformanceKeyInfo, string, error) {
	key := newPerformanceKey()
	now := time.Now().Unix()
	tx, err := s.db.Begin()
	if err != nil {
		return PerformanceKeyInfo{}, "", err
	}
	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM sites WHERE id = ?`, siteID).Scan(&exists); err != nil {
		tx.Rollback()
		if err == sql.ErrNoRows {
			return PerformanceKeyInfo{}, "", sql.ErrNoRows
		}
		return PerformanceKeyInfo{}, "", err
	}
	res, err := tx.Exec(`INSERT INTO performance_keys (site_id, key_hash, key_prefix, key_suffix, created_at) VALUES (?, ?, ?, ?, ?)`,
		siteID, hashPerformanceKey(key), key[:4], key[len(key)-4:], now)
	if err != nil {
		tx.Rollback()
		return PerformanceKeyInfo{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return PerformanceKeyInfo{}, "", err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return PerformanceKeyInfo{}, "", err
	}
	return PerformanceKeyInfo{
		ID:         id,
		KeyHint:    performanceKeyHint(key[:4], key[len(key)-4:]),
		CreatedAt:  now,
		LastUsedAt: 0,
	}, key, nil
}

func (s *Store) ListPerformanceKeys(siteID int64) ([]PerformanceKeyInfo, error) {
	rows, err := s.db.Query(`SELECT id, key_prefix, key_suffix, created_at, last_used_at
		FROM performance_keys WHERE site_id = ? ORDER BY created_at DESC, id DESC`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make([]PerformanceKeyInfo, 0)
	for rows.Next() {
		var key PerformanceKeyInfo
		var prefix, suffix string
		if err := rows.Scan(&key.ID, &prefix, &suffix, &key.CreatedAt, &key.LastUsedAt); err != nil {
			return nil, err
		}
		key.KeyHint = performanceKeyHint(prefix, suffix)
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s *Store) RevokePerformanceKey(siteID, keyID int64) error {
	res, err := s.db.Exec(`DELETE FROM performance_keys WHERE id = ? AND site_id = ?`, keyID, siteID)
	if err != nil {
		return err
	}
	count, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// RotatePerformanceKey is kept for compatibility with the original singular
// endpoint. New dashboard flows create independent keys and revoke them one at
// a time; this legacy method still replaces all existing keys atomically.
func (s *Store) RotatePerformanceKey(siteID int64) (string, error) {
	key := newPerformanceKey()
	now := time.Now().Unix()
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM sites WHERE id = ?`, siteID).Scan(&exists); err != nil {
		tx.Rollback()
		if err == sql.ErrNoRows {
			return "", sql.ErrNoRows
		}
		return "", err
	}
	if _, err := tx.Exec(`DELETE FROM performance_keys WHERE site_id = ?`, siteID); err != nil {
		tx.Rollback()
		return "", err
	}
	if _, err := tx.Exec(`INSERT INTO performance_keys (site_id, key_hash, key_prefix, key_suffix, created_at) VALUES (?, ?, ?, ?, ?)`,
		siteID, hashPerformanceKey(key), key[:4], key[len(key)-4:], now); err != nil {
		tx.Rollback()
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return key, nil
}

func (s *Store) ValidatePerformanceKey(siteID int64, key string) (bool, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return false, nil
	}
	var id int64
	err := s.db.QueryRow(`SELECT id FROM performance_keys WHERE site_id = ? AND key_hash = ?`,
		siteID, hashPerformanceKey(key)).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := s.db.Exec(`UPDATE performance_keys SET last_used_at = ? WHERE id = ?`, time.Now().Unix(), id); err != nil {
		return false, err
	}
	return true, nil
}

func normalizePerformanceObservation(o PerformanceObservation, nowMs int64) (PerformanceObservation, error) {
	o.Environment = normalizePerformanceDimension(o.Environment)
	o.Service = normalizePerformanceDimension(o.Service)
	o.Version = normalizePerformanceDimension(o.Version)
	o.Endpoint = strings.TrimSpace(o.Endpoint)
	if o.Environment == "" {
		o.Environment = "unknown"
	}
	if o.Service == "" {
		o.Service = "unknown"
	}
	if o.Version == "" {
		o.Version = "unknown"
	}
	if o.Endpoint == "" {
		o.Endpoint = "unknown"
	}
	if len(o.Endpoint) > maxPerformanceEndpointLength {
		return o, fmt.Errorf("endpoint must be at most %d characters", maxPerformanceEndpointLength)
	}
	if o.DurationMs < 0 || o.DurationMs > maxPerformanceDurationMs {
		return o, fmt.Errorf("duration_ms must be between 0 and %d", maxPerformanceDurationMs)
	}
	if o.TimestampMs <= 0 {
		o.TimestampMs = nowMs
	}
	return o, nil
}

func normalizePerformanceDimension(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > maxPerformanceDimensionLength {
		return value[:maxPerformanceDimensionLength]
	}
	return value
}

type performanceGroupKey struct {
	BucketStart int64
	Environment string
	Service     string
	Version     string
	Endpoint    string
}

func performanceBucketIndex(durationMs int64) int {
	for i, bound := range performanceLatencyBounds {
		if durationMs <= bound {
			return i
		}
	}
	return len(performanceLatencyBounds)
}

// SavePerformanceObservations folds a batch into one row per minute and
// dimension set. Batches are the unit of work for the agent, so SQLite sees
// substantially fewer writes than the number of backend requests observed.
func (s *Store) SavePerformanceObservations(siteID int64, observations []PerformanceObservation) error {
	if len(observations) == 0 {
		return nil
	}
	nowMs := time.Now().UnixMilli()
	groups := make(map[performanceGroupKey]*performanceAggregate)
	for _, raw := range observations {
		o, err := normalizePerformanceObservation(raw, nowMs)
		if err != nil {
			return err
		}
		bucketStart := (o.TimestampMs / 60_000) * 60
		key := performanceGroupKey{
			BucketStart: bucketStart,
			Environment: o.Environment,
			Service:     o.Service,
			Version:     o.Version,
			Endpoint:    o.Endpoint,
		}
		group := groups[key]
		if group == nil {
			created := newPerformanceAggregate()
			group = &created
			groups[key] = group
		}
		group.Requests++
		group.DurationSumMs += o.DurationMs
		if o.DurationMs > group.MaxDurationMs {
			group.MaxDurationMs = o.DurationMs
		}
		group.Buckets[performanceBucketIndex(o.DurationMs)]++
		if o.Error || o.StatusCode >= 500 {
			group.Errors++
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for key, incoming := range groups {
		var requestCount, errorCount, durationSumMs, maxDurationMs int64
		var rawBuckets string
		err := tx.QueryRow(`SELECT request_count, error_count, duration_sum_ms, max_duration_ms, bucket_counts
			FROM performance_metrics
			WHERE site_id = ? AND bucket_start = ? AND environment = ? AND service = ? AND version = ? AND endpoint = ?`,
			siteID, key.BucketStart, key.Environment, key.Service, key.Version, key.Endpoint).
			Scan(&requestCount, &errorCount, &durationSumMs, &maxDurationMs, &rawBuckets)
		if err == sql.ErrNoRows {
			buckets, marshalErr := json.Marshal(incoming.Buckets)
			if marshalErr != nil {
				return marshalErr
			}
			if _, err := tx.Exec(`INSERT INTO performance_metrics
				(site_id, bucket_start, environment, service, version, endpoint, request_count, error_count, duration_sum_ms, max_duration_ms, bucket_counts)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				siteID, key.BucketStart, key.Environment, key.Service, key.Version, key.Endpoint,
				incoming.Requests, incoming.Errors, incoming.DurationSumMs, incoming.MaxDurationMs, string(buckets)); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		existingBuckets, err := decodePerformanceBuckets(rawBuckets)
		if err != nil {
			return err
		}
		for i, count := range incoming.Buckets {
			existingBuckets[i] += count
		}
		buckets, err := json.Marshal(existingBuckets)
		if err != nil {
			return err
		}
		if incoming.MaxDurationMs > maxDurationMs {
			maxDurationMs = incoming.MaxDurationMs
		}
		if _, err := tx.Exec(`UPDATE performance_metrics SET
			request_count = ?, error_count = ?, duration_sum_ms = ?, max_duration_ms = ?, bucket_counts = ?
			WHERE site_id = ? AND bucket_start = ? AND environment = ? AND service = ? AND version = ? AND endpoint = ?`,
			requestCount+incoming.Requests, errorCount+incoming.Errors, durationSumMs+incoming.DurationSumMs,
			maxDurationMs, string(buckets), siteID, key.BucketStart, key.Environment, key.Service, key.Version, key.Endpoint); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func decodePerformanceBuckets(raw string) ([]int64, error) {
	var buckets []int64
	if err := json.Unmarshal([]byte(raw), &buckets); err != nil {
		return nil, fmt.Errorf("invalid performance histogram: %w", err)
	}
	if len(buckets) != performanceHistogramBuckets {
		return nil, fmt.Errorf("invalid performance histogram bucket count")
	}
	return buckets, nil
}

func (s *Store) loadPerformanceRows(f PerformanceFilter) ([]performanceMetricRow, error) {
	query := `SELECT pm.site_id, si.name, pm.bucket_start, pm.environment, pm.service, pm.version, pm.endpoint,
		pm.request_count, pm.error_count, pm.duration_sum_ms, pm.max_duration_ms, pm.bucket_counts
		FROM performance_metrics pm JOIN sites si ON si.id = pm.site_id WHERE 1 = 1`
	args := []any{}
	if f.SiteID > 0 {
		query += ` AND pm.site_id = ?`
		args = append(args, f.SiteID)
	}
	if f.Environment != "" {
		query += ` AND pm.environment = ?`
		args = append(args, f.Environment)
	}
	if f.Service != "" {
		query += ` AND pm.service = ?`
		args = append(args, f.Service)
	}
	if f.Version != "" {
		query += ` AND pm.version = ?`
		args = append(args, f.Version)
	}
	if f.From > 0 {
		query += ` AND pm.bucket_start >= ?`
		args = append(args, f.From)
	}
	if f.To > 0 {
		query += ` AND pm.bucket_start < ?`
		args = append(args, f.To)
	}
	query += ` ORDER BY pm.bucket_start ASC`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	metrics := make([]performanceMetricRow, 0)
	for rows.Next() {
		var row performanceMetricRow
		var rawBuckets string
		if err := rows.Scan(&row.SiteID, &row.SiteName, &row.BucketStart, &row.Environment, &row.Service,
			&row.Version, &row.Endpoint, &row.RequestCount, &row.ErrorCount, &row.DurationSumMs,
			&row.MaxDurationMs, &rawBuckets); err != nil {
			return nil, err
		}
		row.BucketCounts, err = decodePerformanceBuckets(rawBuckets)
		if err != nil {
			return nil, err
		}
		metrics = append(metrics, row)
	}
	return metrics, rows.Err()
}

func (s *Store) performanceFilterOptions(siteID int64) (PerformanceFilterOptions, error) {
	options := PerformanceFilterOptions{
		Environments: []string{},
		Services:     []string{},
		Versions:     []string{},
	}
	for column, target := range map[string]*[]string{
		"environment": &options.Environments,
		"service":     &options.Services,
		"version":     &options.Versions,
	} {
		query := `SELECT DISTINCT ` + column + ` FROM performance_metrics WHERE ` + column + ` != ''`
		args := []any{}
		if siteID > 0 {
			query += ` AND site_id = ?`
			args = append(args, siteID)
		}
		query += ` ORDER BY ` + column + ` LIMIT 200`
		rows, err := s.db.Query(query, args...)
		if err != nil {
			return options, err
		}
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return options, err
			}
			*target = append(*target, value)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return options, err
		}
		rows.Close()
	}
	return options, nil
}

type performanceEndpointKey struct {
	SiteID      int64
	Endpoint    string
	Environment string
	Service     string
	Version     string
}

type performanceEndpointGroup struct {
	SiteName string
	Total    performanceAggregate
	Series   map[int64]*performanceAggregate
}

func (s *Store) GetPerformance(f PerformanceFilter) (PerformanceReport, error) {
	if f.Limit <= 0 || f.Limit > maxPerformanceQueryLimit {
		f.Limit = maxPerformanceQueryLimit
	}
	rows, err := s.loadPerformanceRows(f)
	if err != nil {
		return PerformanceReport{}, err
	}
	options, err := s.performanceFilterOptions(f.SiteID)
	if err != nil {
		return PerformanceReport{}, err
	}
	report := PerformanceReport{
		From:      f.From,
		To:        f.To,
		Endpoints: []PerformanceEndpoint{},
		Filters:   options,
	}
	groups := make(map[performanceEndpointKey]*performanceEndpointGroup)
	var total performanceAggregate = newPerformanceAggregate()
	for _, row := range rows {
		total.addRow(row)
		key := performanceEndpointKey{SiteID: row.SiteID, Endpoint: row.Endpoint, Environment: row.Environment, Service: row.Service, Version: row.Version}
		group := groups[key]
		if group == nil {
			group = &performanceEndpointGroup{SiteName: row.SiteName, Total: newPerformanceAggregate(), Series: make(map[int64]*performanceAggregate)}
			groups[key] = group
		}
		group.Total.addRow(row)
		point := group.Series[row.BucketStart]
		if point == nil {
			created := newPerformanceAggregate()
			point = &created
			group.Series[row.BucketStart] = point
		}
		point.addRow(row)
	}
	report.Summary = total.stats()
	for key, group := range groups {
		series := performanceSeries(group.Series)
		stats := group.Total.stats()
		report.Endpoints = append(report.Endpoints, PerformanceEndpoint{
			SiteID: key.SiteID, SiteName: group.SiteName, Endpoint: key.Endpoint,
			Environment: key.Environment, Service: key.Service, Version: key.Version,
			PerformanceStats: stats, Series: series,
		})
	}
	sort.SliceStable(report.Endpoints, func(i, j int) bool {
		if report.Endpoints[i].P95Ms != report.Endpoints[j].P95Ms {
			return report.Endpoints[i].P95Ms > report.Endpoints[j].P95Ms
		}
		if report.Endpoints[i].Requests != report.Endpoints[j].Requests {
			return report.Endpoints[i].Requests > report.Endpoints[j].Requests
		}
		return report.Endpoints[i].Endpoint < report.Endpoints[j].Endpoint
	})
	if len(report.Endpoints) > f.Limit {
		report.Endpoints = report.Endpoints[:f.Limit]
	}
	return report, nil
}

func performanceSeries(series map[int64]*performanceAggregate) []PerformanceSeriesPoint {
	starts := make([]int64, 0, len(series))
	for start := range series {
		starts = append(starts, start)
	}
	sort.Slice(starts, func(i, j int) bool { return starts[i] < starts[j] })
	if len(starts) == 0 {
		return []PerformanceSeriesPoint{}
	}
	groupSize := 1
	if len(starts) > maxPerformanceSeriesPoints {
		groupSize = int(math.Ceil(float64(len(starts)) / float64(maxPerformanceSeriesPoints)))
	}
	out := make([]PerformanceSeriesPoint, 0, (len(starts)+groupSize-1)/groupSize)
	for start := 0; start < len(starts); start += groupSize {
		end := start + groupSize
		if end > len(starts) {
			end = len(starts)
		}
		aggregate := newPerformanceAggregate()
		for _, bucketStart := range starts[start:end] {
			aggregate.addAggregate(*series[bucketStart])
		}
		stats := aggregate.stats()
		out = append(out, PerformanceSeriesPoint{
			BucketStart: starts[end-1],
			Requests:    stats.Requests,
			P50Ms:       stats.P50Ms,
			P95Ms:       stats.P95Ms,
			P99Ms:       stats.P99Ms,
		})
	}
	return out
}

func (a *performanceAggregate) addAggregate(other performanceAggregate) {
	a.Requests += other.Requests
	a.Errors += other.Errors
	a.DurationSumMs += other.DurationSumMs
	if other.MaxDurationMs > a.MaxDurationMs {
		a.MaxDurationMs = other.MaxDurationMs
	}
	if len(a.Buckets) != performanceHistogramBuckets {
		a.Buckets = make([]int64, performanceHistogramBuckets)
	}
	for i, count := range other.Buckets {
		if i >= len(a.Buckets) {
			break
		}
		a.Buckets[i] += count
	}
}

func (s *Store) DeleteOldPerformanceMetrics(days int) (int64, error) {
	if days <= 0 {
		return 0, nil
	}
	cutoff := time.Now().AddDate(0, 0, -days).Unix()
	res, err := s.db.Exec(`DELETE FROM performance_metrics WHERE bucket_start < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
