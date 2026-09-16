package store

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// Stylesheet deduplication.
//
// rrweb inlines every stylesheet into each FullSnapshot, and it takes a fresh
// snapshot on a timer. The same bytes are therefore stored again on every
// checkout: measured on a real application, 2.95 MB of CSS inside a 4.78 MB
// snapshot, repeated for the life of the session.
//
// Each distinct stylesheet is stored once, keyed by the SHA-256 of its own
// bytes, and the snapshot keeps a reference in its place. The hash IS the
// version: a deploy changes the bundle, which changes the hash, which is a new
// row. Two users on different builds reference different rows and cannot
// collide. A stylesheet unique to one recording is simply a hash with one
// referrer -- same mechanism, no special case.
//
// Sessions link to assets through a table rather than a reference count.
// Sessions are deleted from three places (RetentionSweep, SweepToBudget, and
// the cascade from sites), so a counter has three chances to drift -- silently,
// toward either leaking blobs forever or dropping one a live recording still
// needs. Rows that cascade away on their own cannot drift.

const (
	// The marker that replaces inlined CSS. Fixed shape, hex-validated on the
	// way back out, so it cannot be confused with real stylesheet text.
	cssRefPrefix = "@traceux-css-ref:"
	cssRefLen    = len(cssRefPrefix) + 64 // prefix + hex sha256

	// Below this, a row in css_assets costs more than the duplication saves.
	cssDedupeMinBytes = 16 << 10

	// The JSON key rrweb uses for an inlined stylesheet.
	cssTextKey = `"_cssText"`
)

// DedupeCSS replaces inlined stylesheets in these events with references,
// storing each distinct stylesheet once and linking it to the session.
//
// Events that cannot contain a stylesheet are returned untouched without being
// parsed: the byte scan below is the difference between ~117ns for an ordinary
// incremental event and a full JSON round-trip. Incremental events outnumber
// snapshots by three orders of magnitude, so this filter carries the cost of
// the whole feature.
func (s *Store) DedupeCSS(sessionID string, events []json.RawMessage) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, len(events))
	copy(out, events)
	for i, raw := range events {
		if !bytes.Contains(raw, []byte(cssTextKey)) {
			continue
		}
		var doc any
		if err := json.Unmarshal(raw, &doc); err != nil {
			// Not our business to reject it; store it as it arrived.
			continue
		}
		changed := false
		walked := walkCSSText(doc, func(css string) (string, bool) {
			if len(css) < cssDedupeMinBytes || strings.HasPrefix(css, cssRefPrefix) {
				return css, false
			}
			hash, err := s.putCSSAsset(sessionID, css)
			if err != nil {
				return css, false // fall back to storing it inline
			}
			changed = true
			return cssRefPrefix + hash, true
		})
		if !changed {
			continue
		}
		next, err := json.Marshal(walked)
		if err != nil {
			continue
		}
		out[i] = next
	}
	return out, nil
}

// RehydrateCSS puts the stylesheets back before events reach the player.
//
// A reference that cannot be resolved is an error rather than an empty string.
// Serving the replay with no styles would look like a broken application and
// send somebody hunting through their own stylesheets for a fault that is not
// there; failing loudly points at the actual problem.
func (s *Store) RehydrateCSS(events []json.RawMessage) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, len(events))
	copy(out, events)
	for i, raw := range events {
		if !bytes.Contains(raw, []byte(cssRefPrefix)) {
			continue
		}
		var doc any
		if err := json.Unmarshal(raw, &doc); err != nil {
			continue
		}
		var missing string
		walked := walkCSSText(doc, func(v string) (string, bool) {
			hash, ok := parseCSSRef(v)
			if !ok {
				return v, false
			}
			css, err := s.getCSSAsset(hash)
			if err != nil {
				missing = hash
				return v, false
			}
			return css, true
		})
		if missing != "" {
			return nil, fmt.Errorf("stylesheet %s referenced by this recording is missing", missing)
		}
		next, err := json.Marshal(walked)
		if err != nil {
			continue
		}
		out[i] = next
	}
	return out, nil
}

// parseCSSRef validates the fixed marker shape: exact length, exact prefix, and
// 64 hex characters. Real CSS starting with the prefix by accident would still
// fail the hex check.
func parseCSSRef(v string) (string, bool) {
	if len(v) != cssRefLen || !strings.HasPrefix(v, cssRefPrefix) {
		return "", false
	}
	hash := v[len(cssRefPrefix):]
	if _, err := hex.DecodeString(hash); err != nil {
		return "", false
	}
	return hash, true
}

// walkCSSText rewrites every "_cssText" string value reachable in the document.
func walkCSSText(v any, fn func(string) (string, bool)) any {
	switch t := v.(type) {
	case map[string]any:
		for k, child := range t {
			if k == "_cssText" {
				if str, ok := child.(string); ok {
					if next, changed := fn(str); changed {
						t[k] = next
					}
					continue
				}
			}
			t[k] = walkCSSText(child, fn)
		}
		return t
	case []any:
		for i, child := range t {
			t[i] = walkCSSText(child, fn)
		}
		return t
	default:
		return v
	}
}

// putCSSAsset stores a stylesheet under its content hash and links it to the
// session. Both writes are idempotent: the same bundle arriving from twenty
// browsers at once inserts one row.
func (s *Store) putCSSAsset(sessionID, css string) (string, error) {
	sum := sha256.Sum256([]byte(css))
	hash := hex.EncodeToString(sum[:])

	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if _, err := zw.Write([]byte(css)); err != nil {
		return "", err
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	if _, err := s.DB.Exec(
		`INSERT INTO css_assets (hash, data, bytes, created_at)
		 VALUES (?, ?, ?, strftime('%s','now')) ON CONFLICT(hash) DO NOTHING`,
		hash, buf.Bytes(), len(css)); err != nil {
		return "", err
	}
	if _, err := s.DB.Exec(
		`INSERT INTO session_css (session_id, hash) VALUES (?, ?)
		 ON CONFLICT(session_id, hash) DO NOTHING`, sessionID, hash); err != nil {
		return "", err
	}
	return hash, nil
}

func (s *Store) getCSSAsset(hash string) (string, error) {
	var data []byte
	if err := s.DB.QueryRow(`SELECT data FROM css_assets WHERE hash = ?`, hash).Scan(&data); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("no such stylesheet %s", hash)
		}
		return "", err
	}
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	defer zr.Close()
	raw, err := io.ReadAll(io.LimitReader(zr, int64(IngestBodyLimit)))
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// LinkSessionCSS records that a session references an already-stored
// stylesheet. The tracker uses this when it sends a reference instead of the
// body, so the asset is not garbage collected while a live recording needs it.
func (s *Store) LinkSessionCSS(sessionID, hash string) error {
	_, err := s.DB.Exec(
		`INSERT INTO session_css (session_id, hash) VALUES (?, ?)
		 ON CONFLICT(session_id, hash) DO NOTHING`, sessionID, hash)
	return err
}

// HasCSSAsset reports whether a stylesheet is already stored, so a client can
// be told to send the body only when it is actually needed.
func (s *Store) HasCSSAsset(hash string) (bool, error) {
	var one int
	err := s.DB.QueryRow(`SELECT 1 FROM css_assets WHERE hash = ?`, hash).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

// GCCSSAssets drops stylesheets no session references any more.
//
// Called after every path that deletes sessions. The link rows cascade away
// with their session, so "unreferenced" is derived rather than tracked, and
// cannot fall out of step with reality.
func (s *Store) GCCSSAssets() (int64, error) {
	res, err := s.DB.Exec(
		`DELETE FROM css_assets WHERE hash NOT IN (SELECT hash FROM session_css)`)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
