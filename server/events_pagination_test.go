package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
)

// Paging must never lose an event.
//
// The original loop filled a page up to max_events, then reported next_seq as
// the chunk it had stopped inside -- so the next request resumed after that
// chunk and its remaining events were never sent. On a real recording this
// silently dropped 23% of the session.
func TestPagingDeliversEveryEvent(t *testing.T) {
	srv, ts := newTestServer(t)
	sid := "sess-paging"
	if _, err := srv.store.CreateSite("S", "https://example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.store.DB.Exec(
		`INSERT INTO sessions (id,site_id,started_at,last_seen) VALUES (?,1,1,1)`, sid); err != nil {
		t.Fatal(err)
	}

	// Chunks deliberately larger than the page size, so every page boundary
	// falls inside a chunk -- the exact shape that lost events.
	const chunks, perChunk = 5, 300
	want := chunks * perChunk
	for c := 0; c < chunks; c++ {
		evs := make([]map[string]any, perChunk)
		for i := range evs {
			evs[i] = map[string]any{"type": 3, "timestamp": c*perChunk + i, "data": map[string]any{}}
		}
		body, _ := json.Marshal(evs)
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		zw.Write(body)
		zw.Close()
		if _, err := srv.store.DB.Exec(
			`INSERT INTO chunks (session_id,seq,events,data,created_at) VALUES (?,?,?,?,1)`,
			sid, c, perChunk, buf.Bytes()); err != nil {
			t.Fatal(err)
		}
	}

	seen := map[float64]bool{}
	after, trips := -1, 0
	for {
		resp := authed(t, ts.URL, http.MethodGet,
			fmt.Sprintf("/api/sessions/%s/events?after_seq=%d&max_events=200", sid, after), "")
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		var page struct {
			NextSeq int               `json:"next_seq"`
			HasMore bool              `json:"has_more"`
			Events  []json.RawMessage `json:"events"`
		}
		if err := json.Unmarshal(b, &page); err != nil {
			t.Fatal(err)
		}
		for _, raw := range page.Events {
			var e struct {
				Timestamp float64 `json:"timestamp"`
			}
			json.Unmarshal(raw, &e)
			if seen[e.Timestamp] {
				t.Fatalf("event at %v delivered twice", e.Timestamp)
			}
			seen[e.Timestamp] = true
		}
		after = page.NextSeq
		trips++
		if !page.HasMore {
			break
		}
		if trips > 50 {
			t.Fatal("paging did not terminate")
		}
	}

	if len(seen) != want {
		t.Fatalf("received %d of %d events -- %d lost (%.1f%%)",
			len(seen), want, want-len(seen), 100*float64(want-len(seen))/float64(want))
	}
	for i := 0; i < want; i++ {
		if !seen[float64(i)] {
			t.Fatalf("event %d was never delivered", i)
		}
	}
	t.Logf("all %d events delivered across %d pages", want, trips)
}
