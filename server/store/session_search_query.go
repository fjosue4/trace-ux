package store

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"unicode/utf8"
)

const sessionSearchAliasText = "custom event events action actions activity activities " +
	"click clicks clicked page pages visit visits navigation navigated opened " +
	"log logs browser console debug info warn error"

type indexedSession struct {
	rowID   int64
	session Session
}

type sessionSearchQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// ListSessions returns sessions newest first, with optional filters. With
// f.SiteID set it is scoped to one site; with 0 it spans every site. It keeps
// the store API convenient for internal callers that do not own a context.
func (s *Store) ListSessions(f SessionFilter) ([]Session, error) {
	return s.ListSessionsContext(context.Background(), f)
}

// ListSessionsContext returns the same results as the standard LIKE query,
// using FTS only while the optional index is complete and applicable.
func (s *Store) ListSessionsContext(ctx context.Context, f SessionFilter) ([]Session, error) {
	terms := strings.Fields(strings.ToLower(f.Action))
	if len(terms) == 0 || !canUseSessionSearchTerms(terms) {
		return s.listSessionsStandard(ctx, f)
	}
	tx, err := s.readDB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	st, err := scanSearchIndexState(tx.QueryRowContext(ctx, searchIndexStateSelect))
	if err != nil || st.state != "ready" || st.overflowed {
		_ = tx.Rollback()
		return s.listSessionsStandard(ctx, f)
	}
	rows, err := s.listSessionsIndexed(ctx, tx, f, terms)
	if err != nil {
		_ = tx.Rollback()
		// A state transition may remove the virtual table after the readiness
		// check. Falling back preserves availability and exact results.
		if isMissingSearchTable(err) {
			return s.listSessionsStandard(ctx, f)
		}
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rows, nil
}

func canUseSessionSearchTerms(terms []string) bool {
	for _, term := range terms {
		if utf8.RuneCountInString(term) < 3 || strings.Contains(sessionSearchAliasText, term) ||
			strings.ContainsAny(term, "%_") || !isASCII(term) {
			return false
		}
	}
	return true
}

func isASCII(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}

func quoteFTSTerm(term string) string {
	return `"` + strings.ReplaceAll(term, `"`, `""`) + `"`
}

func (s *Store) listSessionsIndexed(ctx context.Context, q sessionSearchQueryer, f SessionFilter, terms []string) ([]Session, error) {
	// Keep the candidate IN clause below SQLite's conservative 999-variable
	// limit even after the ordinary filters and additional terms are appended.
	const driverBatch = 500
	cursor := maxSearchCursor()
	accepted := make([]indexedSession, 0, f.Limit)
	seen := make(map[int64]bool)

	for len(accepted) < f.Limit {
		rows, err := q.QueryContext(ctx, `SELECT rowid FROM session_search
			WHERE session_search MATCH ? AND rowid < ? ORDER BY rowid DESC LIMIT ?`,
			quoteFTSTerm(terms[0]), cursor, driverBatch)
		if err != nil {
			return nil, err
		}
		candidateIDs := make([]int64, 0, 128)
		for rows.Next() {
			var ftsRowID int64
			if err := rows.Scan(&ftsRowID); err != nil {
				rows.Close()
				return nil, err
			}
			sessionRowID := ftsRowID >> 24
			if !seen[sessionRowID] {
				seen[sessionRowID] = true
				candidateIDs = append(candidateIDs, sessionRowID)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if len(candidateIDs) == 0 {
			break
		}

		matches, err := s.filterIndexedSessionCandidates(ctx, q, f, terms[1:], candidateIDs)
		if err != nil {
			return nil, err
		}
		for _, rowID := range candidateIDs {
			if session, ok := matches[rowID]; ok {
				accepted = append(accepted, indexedSession{rowID: rowID, session: session})
			}
		}
		// We already evaluated the oldest session represented in this driver
		// batch, so skip the rest of its matching item rows on the next pass.
		cursor = candidateIDs[len(candidateIDs)-1] << 24
	}

	sort.Slice(accepted, func(i, j int) bool {
		if accepted[i].session.StartedAt == accepted[j].session.StartedAt {
			return accepted[i].rowID > accepted[j].rowID
		}
		return accepted[i].session.StartedAt > accepted[j].session.StartedAt
	})
	if len(accepted) > f.Limit {
		accepted = accepted[:f.Limit]
	}
	out := make([]Session, len(accepted))
	for i := range accepted {
		out[i] = accepted[i].session
	}
	return out, nil
}

func (s *Store) filterIndexedSessionCandidates(
	ctx context.Context,
	q sessionSearchQueryer,
	f SessionFilter,
	otherTerms []string,
	rowIDs []int64,
) (map[int64]Session, error) {
	query := `SELECT s.rowid, ` + sessionColsQualified + `, si.name
		FROM sessions s JOIN sites si ON si.id = s.site_id WHERE s.rowid IN (`
	args := make([]any, 0, len(rowIDs)+32)
	for i, id := range rowIDs {
		if i > 0 {
			query += ","
		}
		query += "?"
		args = append(args, id)
	}
	query += `)`
	query, args = appendIndexedSessionFilters(query, args, f)
	for _, term := range otherTerms {
		query += ` AND EXISTS (SELECT 1 FROM session_search
			WHERE session_search MATCH ?
			  AND session_search.rowid BETWEEN (s.rowid << 24) AND ((s.rowid << 24) | 0xFFFFFF))`
		args = append(args, quoteFTSTerm(term))
	}

	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int64]Session, len(rowIDs))
	for rows.Next() {
		var rowID int64
		var session Session
		var active int
		if err := rows.Scan(&rowID,
			&session.ID, &session.SiteID, &session.StartedAt, &session.LastSeen,
			&session.DurationMs, &session.PageCount, &session.EventCount,
			&session.InitialURL, &session.ExitURL, &session.Referrer,
			&session.UTMSource, &session.UTMMedium, &session.UTMCampaign,
			&session.Browser, &session.OS, &session.Device,
			&session.ViewportW, &session.ViewportH, &session.ScreenW, &session.ScreenH,
			&session.IPHash, &session.Country, &session.UserAgent,
			&session.UserID, &session.ClientID, &session.RemoteID,
			&active, &session.SiteName,
		); err != nil {
			return nil, err
		}
		session.Active = active != 0
		out[rowID] = session
	}
	return out, rows.Err()
}

func appendIndexedSessionFilters(query string, args []any, f SessionFilter) (string, []any) {
	if f.SiteID > 0 {
		query += ` AND s.site_id = ?`
		args = append(args, f.SiteID)
	}
	if f.Browser != "" {
		query += ` AND s.browser = ?`
		args = append(args, f.Browser)
	}
	if f.OS != "" {
		query += ` AND s.os = ?`
		args = append(args, f.OS)
	}
	if f.Device != "" {
		query += ` AND s.device = ?`
		args = append(args, f.Device)
	}
	if f.Country != "" {
		query += ` AND s.country = ?`
		args = append(args, f.Country)
	}
	if f.URL != "" {
		like := "%" + f.URL + "%"
		query += ` AND (s.initial_url LIKE ? OR s.exit_url LIKE ? OR EXISTS
			(SELECT 1 FROM pages pg WHERE pg.session_id = s.id AND pg.url LIKE ?))`
		args = append(args, like, like, like)
	}
	if f.Identity != "" {
		like := "%" + f.Identity + "%"
		query += ` AND (s.user_id LIKE ? OR s.client_id LIKE ? OR s.remote_id LIKE ?)`
		args = append(args, like, like, like)
	}
	if f.MinDurationMs > 0 {
		query += ` AND s.duration_ms >= ?`
		args = append(args, f.MinDurationMs)
	}
	if f.Before != 0 {
		query += ` AND s.started_at < ?`
		args = append(args, f.Before)
	}
	return query, args
}
