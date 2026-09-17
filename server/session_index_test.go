package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The index is what makes windowed playback possible: it must report where each
// chunk sits in time and which chunks are FullSnapshots, because rrweb can only
// begin rendering from one.
func TestSessionIndexReportsTimeAndKeyframes(t *testing.T) {
	srv, ts := newTestServer(t)
	css := bigCSS("index")
	sid := "sess-index"
	seedCSSSession(t, srv, sid, css) // seq 0 carries a FullSnapshot

	// A second chunk of incrementals only: not a valid seek target.
	incrementals, _ := json.Marshal([]any{
		map[string]any{"type": 3, "timestamp": 2000, "data": map[string]any{}},
		map[string]any{"type": 3, "timestamp": 5000, "data": map[string]any{}},
	})
	writeChunk(t, srv, sid, 1, incrementals)

	resp := authed(t, ts.URL, http.MethodGet, "/api/sessions/"+sid+"/index", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d, want 200", resp.StatusCode)
	}
	var out struct {
		Chunks []struct {
			Seq      int   `json:"seq"`
			FirstTS  int64 `json:"first_ts"`
			LastTS   int64 `json:"last_ts"`
			Events   int   `json:"events"`
			Snapshot bool  `json:"snapshot"`
		} `json:"chunks"`
		FirstTS int64 `json:"first_ts"`
		LastTS  int64 `json:"last_ts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if len(out.Chunks) != 2 {
		t.Fatalf("got %d chunks, want 2", len(out.Chunks))
	}
	if !out.Chunks[0].Snapshot {
		t.Error("chunk 0 holds a FullSnapshot but is not marked as a seek target")
	}
	if out.Chunks[1].Snapshot {
		t.Error("chunk 1 is incrementals only and must not be offered as a seek target")
	}
	if out.Chunks[1].FirstTS != 2000 || out.Chunks[1].LastTS != 5000 {
		t.Errorf("chunk 1 spans %d-%d, want 2000-5000", out.Chunks[1].FirstTS, out.Chunks[1].LastTS)
	}
	if out.LastTS != 5000 {
		t.Errorf("recording last_ts = %d, want 5000", out.LastTS)
	}
}

// The index must never carry stylesheet bytes: it exists so the client can
// avoid downloading the recording, and a 3 MB sheet in it defeats the purpose.
func TestSessionIndexIsSmall(t *testing.T) {
	srv, ts := newTestServer(t)
	css := bigCSS("small")
	sid := "sess-small"
	seedCSSSession(t, srv, sid, css)

	resp := authed(t, ts.URL, http.MethodGet, "/api/sessions/"+sid+"/index", "")
	defer resp.Body.Close()
	var buf [1 << 16]byte
	n, _ := resp.Body.Read(buf[:])
	body := string(buf[:n])
	if len(body) > 4096 {
		t.Errorf("index is %d bytes for a 1-chunk recording; it should be a table, not the data", len(body))
	}
	for _, leak := range []string{"_cssText", "small", "@traceux-css-ref"} {
		if contains(body, leak) {
			t.Errorf("index leaked %q; it must carry only timings", leak)
		}
	}
}

func contains(h, n string) bool {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return true
		}
	}
	return false
}
