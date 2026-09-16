package store

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// A realistic FullSnapshot: a DOM tree with one big stylesheet inlined.
func snapshotWithCSS(css string) json.RawMessage {
	doc := map[string]any{
		"type": 2, "timestamp": 1,
		"data": map[string]any{"node": map[string]any{
			"type": 1, "id": 1,
			"childNodes": []any{
				map[string]any{"type": 2, "tagName": "style", "id": 2,
					"attributes": map[string]any{"_cssText": css}},
				map[string]any{"type": 2, "tagName": "div", "id": 3,
					"attributes": map[string]any{"class": "app"}},
			}}},
	}
	b, _ := json.Marshal(doc)
	return b
}

func bigCSS(seed string) string {
	var sb strings.Builder
	for i := 0; sb.Len() < 40<<10; i++ {
		fmt.Fprintf(&sb, ".%s-c%d{color:#%06x;margin:%dpx}", seed, i, i*7919%0xffffff, i%50)
	}
	return sb.String()
}

func seedSession(t *testing.T, s *Store, id string) int64 {
	t.Helper()
	site, err := s.CreateSite("t", "https://e.com")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	if _, err := s.DB.Exec(`INSERT INTO sessions (id,site_id,started_at,last_seen) VALUES (?,?,?,?)`,
		id, site.ID, now, now); err != nil {
		t.Fatal(err)
	}
	return site.ID
}

// The property everything else rests on: what comes back out is byte-for-byte
// what went in. A rewrite that is not exactly reversible corrupts replays in a
// way that only shows up when somebody watches one.
func TestDedupeRoundTripsByteForByte(t *testing.T) {
	s, _ := newTestStore(t)
	seedSession(t, s, "sess-1")

	css := bigCSS("app")
	original := []json.RawMessage{
		snapshotWithCSS(css),
		json.RawMessage(`{"type":3,"timestamp":2,"data":{"source":2,"id":3}}`),
	}
	before := make([]string, len(original))
	for i, e := range original {
		before[i] = string(e)
	}

	deduped, err := s.DedupeCSS("sess-1", original)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(deduped[0]), css[:200]) {
		t.Fatal("stylesheet is still inline after dedupe")
	}
	if !strings.Contains(string(deduped[0]), cssRefPrefix) {
		t.Fatal("no reference marker was written")
	}
	if string(deduped[1]) != before[1] {
		t.Fatal("an incremental event was rewritten; it should be untouched")
	}

	back, err := s.RehydrateCSS(deduped)
	if err != nil {
		t.Fatal(err)
	}
	for i := range before {
		var a, b any
		json.Unmarshal([]byte(before[i]), &a)
		json.Unmarshal(back[i], &b)
		ja, _ := json.Marshal(a)
		jb, _ := json.Marshal(b)
		if string(ja) != string(jb) {
			t.Fatalf("event %d did not round-trip:\n  in : %.120s\n  out: %.120s", i, ja, jb)
		}
	}
}

// The saving only exists if the same bundle from many sessions is one row.
func TestIdenticalStylesheetStoredOnce(t *testing.T) {
	s, _ := newTestStore(t)
	site := seedSession(t, s, "sess-a")
	now := time.Now().Unix()
	s.DB.Exec(`INSERT INTO sessions (id,site_id,started_at,last_seen) VALUES (?,?,?,?)`, "sess-b", site, now, now)

	css := bigCSS("shared")
	for _, sid := range []string{"sess-a", "sess-b", "sess-a"} {
		if _, err := s.DedupeCSS(sid, []json.RawMessage{snapshotWithCSS(css)}); err != nil {
			t.Fatal(err)
		}
	}
	var assets, links int
	s.DB.QueryRow(`SELECT COUNT(*) FROM css_assets`).Scan(&assets)
	s.DB.QueryRow(`SELECT COUNT(*) FROM session_css`).Scan(&links)
	if assets != 1 {
		t.Fatalf("css_assets = %d rows, want 1", assets)
	}
	if links != 2 {
		t.Fatalf("session_css = %d rows, want 2 (one per session)", links)
	}
}

// A deploy changes the bundle, which changes the hash. Two builds must not
// collide, and neither may overwrite the other's replay.
func TestDifferentBuildsGetDifferentRows(t *testing.T) {
	s, _ := newTestStore(t)
	seedSession(t, s, "sess-1")
	a := snapshotWithCSS(bigCSS("v1"))
	b := snapshotWithCSS(bigCSS("v2"))
	s.DedupeCSS("sess-1", []json.RawMessage{a})
	s.DedupeCSS("sess-1", []json.RawMessage{b})
	var assets int
	s.DB.QueryRow(`SELECT COUNT(*) FROM css_assets`).Scan(&assets)
	if assets != 2 {
		t.Fatalf("css_assets = %d, want 2 distinct builds", assets)
	}
}

// An unresolvable reference must fail loudly. Rendering empty CSS would look
// like a broken application and send someone debugging their own stylesheets.
func TestMissingStylesheetIsAnErrorNotEmptyCSS(t *testing.T) {
	s, _ := newTestStore(t)
	orphan := json.RawMessage(`{"type":2,"data":{"node":{"attributes":{"_cssText":"` +
		cssRefPrefix + strings.Repeat("ab", 32) + `"}}}}`)
	if _, err := s.RehydrateCSS([]json.RawMessage{orphan}); err == nil {
		t.Fatal("a dangling reference rehydrated silently; it must be an error")
	}
}

// Real CSS that happens to start with the marker text must not be mistaken for
// a reference.
func TestMarkerCannotCollideWithRealCSS(t *testing.T) {
	for _, v := range []string{
		cssRefPrefix + "not-hex-at-all-not-hex-at-all-not-hex-at-all-not-hex-at-all-xxxx",
		cssRefPrefix + "abc",
		cssRefPrefix + strings.Repeat("ab", 32) + "trailing",
		".a{content:'" + cssRefPrefix + "'}",
	} {
		if _, ok := parseCSSRef(v); ok {
			t.Fatalf("%.60s… was accepted as a reference", v)
		}
	}
	if _, ok := parseCSSRef(cssRefPrefix + strings.Repeat("ab", 32)); !ok {
		t.Fatal("a well-formed reference was rejected")
	}
}

// Small stylesheets stay inline: a row would cost more than the duplication.
func TestSmallStylesheetsAreLeftAlone(t *testing.T) {
	s, _ := newTestStore(t)
	seedSession(t, s, "sess-1")
	small := ".a{color:red}"
	out, _ := s.DedupeCSS("sess-1", []json.RawMessage{snapshotWithCSS(small)})
	if !strings.Contains(string(out[0]), small) {
		t.Fatal("a small stylesheet was deduped")
	}
	var n int
	s.DB.QueryRow(`SELECT COUNT(*) FROM css_assets`).Scan(&n)
	if n != 0 {
		t.Fatalf("css_assets = %d, want 0", n)
	}
}

// Deleting the last session that referenced a stylesheet must free it, or the
// disk budget measures bytes it can never reclaim.
func TestGCFreesUnreferencedStylesheets(t *testing.T) {
	s, _ := newTestStore(t)
	seedSession(t, s, "sess-1")
	s.DedupeCSS("sess-1", []json.RawMessage{snapshotWithCSS(bigCSS("gone"))})

	if n, _ := s.GCCSSAssets(); n != 0 {
		t.Fatalf("GC removed %d assets while still referenced", n)
	}
	if _, err := s.DB.Exec(`DELETE FROM sessions WHERE id = 'sess-1'`); err != nil {
		t.Fatal(err)
	}
	var links int
	s.DB.QueryRow(`SELECT COUNT(*) FROM session_css`).Scan(&links)
	if links != 0 {
		t.Fatalf("session_css = %d after the session was deleted; the cascade did not fire", links)
	}
	n, err := s.GCCSSAssets()
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("GC freed %d assets, want 1", n)
	}
}
