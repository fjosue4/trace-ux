package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"trace-ux/server/store"
)

type exportedSession struct {
	store.SessionExport
	Events []json.RawMessage `json:"events"`
}

func TestSessionExportPreservesReplayDOMAndClickCoordinates(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Checkout", "https://shop.example")
	if err != nil {
		t.Fatal(err)
	}
	const sid = "visual-evidence"
	if err := srv.store.EnsureSessionForSite(site.ID, sid, time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	// The dialog appears through a mutation after the initial snapshot. Resolving
	// the later click requires keeping its node ID, label, attributes and CSS.
	const recording = `[
		{"type":4,"timestamp":1000,"data":{"href":"https://shop.example/checkout","width":1280,"height":800}},
		{"type":2,"timestamp":1001,"data":{"node":{"type":0,"id":1,"childNodes":[
			{"type":2,"id":2,"tagName":"html","attributes":{},"childNodes":[
				{"type":2,"id":3,"tagName":"head","attributes":{},"childNodes":[]},
				{"type":2,"id":4,"tagName":"body","attributes":{},"childNodes":[]}
			]}
		]},"initialOffset":{"left":0,"top":0}}},
		{"type":3,"timestamp":2000,"data":{"source":0,"texts":[],"attributes":[],"removes":[],"adds":[
			{"parentId":4,"nextId":null,"node":{"type":2,"id":10,"tagName":"dialog","attributes":{"open":"","aria-label":"Confirm payment","style":"position:fixed;top:100px;left:200px"},"childNodes":[
				{"type":2,"id":11,"tagName":"button","attributes":{"id":"confirm-payment","aria-label":"Pay now"},"childNodes":[{"type":3,"id":12,"textContent":"Pay now"}]}
			]}}
		]}},
		{"type":3,"timestamp":2500,"data":{"source":3,"id":1,"x":0,"y":240}},
		{"type":3,"timestamp":3000,"data":{"source":2,"type":2,"id":11,"x":264,"y":148}},
		{"type":3,"timestamp":4000,"data":{"source":4,"width":1024,"height":768}}
	]`
	writeChunk(t, srv, sid, 0, []byte(recording))
	resp := authed(t, ts.URL, http.MethodGet, "/api/sessions/"+sid+"/export", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("export: %d", resp.StatusCode)
	}
	var exportData struct {
		Events []any `json:"events"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&exportData); err != nil {
		t.Fatal(err)
	}
	var original []any
	if err := json.Unmarshal([]byte(recording), &original); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(exportData.Events, original) {
		t.Fatal("export changed the DOM, dialog state, click coordinates, scroll, or viewport events")
	}
	replay := authed(t, ts.URL, http.MethodGet, "/api/sessions/"+sid+"/events?after_seq=-1", "")
	defer replay.Body.Close()
	if replay.StatusCode != http.StatusOK {
		t.Fatalf("replay: %d", replay.StatusCode)
	}
	var replayData struct {
		Events []any `json:"events"`
	}
	if err := json.NewDecoder(replay.Body).Decode(&replayData); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(exportData.Events, replayData.Events) {
		t.Fatal("downloaded visual evidence differs from the replay player's events")
	}
}

func TestSessionExportCompleteAndScoped(t *testing.T) {
	srv, ts := newTestServer(t)
	const sid = "sess-export"
	css := bigCSS("export-styles")
	seedCSSSession(t, srv, sid, css)
	if _, err := srv.store.DB.Exec(`UPDATE sessions SET last_seen=?, browser='Firefox', os='Linux',
		device='desktop', country='HN', referrer='https://example.com/ref' WHERE id=?`, time.Now().Unix(), sid); err != nil {
		t.Fatal(err)
	}
	// Insert out of order, including chunks exceeding the replay page cap.
	const chunks, perChunk = 7, 450
	for c := chunks; c > 0; c-- {
		events := make([]any, perChunk)
		for i := range events {
			events[i] = map[string]any{"type": 3, "timestamp": c*perChunk + i + 1, "data": map[string]any{"source": 2, "id": i}}
		}
		data, _ := json.Marshal(events)
		writeChunk(t, srv, sid, c, data)
	}
	if _, err := srv.store.DB.Exec(`INSERT INTO pages(session_id,idx,url,title,entered_at,left_at)
		VALUES (?,0,'https://example.com/checkout','Checkout',1,2)`, sid); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.store.SaveCustomEvents(1, sid, []store.CustomEvent{{TS: 1500, Name: "click", TrackID: "checkout", Details: json.RawMessage(`{"label":"Pay"}`)}}); err != nil {
		t.Fatal(err)
	}
	logs := make([]store.Log, store.MaxLogListLimit+1)
	for i := range logs {
		logs[i] = store.Log{ClientSeq: int64(i + 1), TimestampMs: int64(1600 + i), Severity: "error", Message: fmt.Sprintf("Failure %d", i)}
	}
	if _, err := srv.store.SaveLogs(1, sid, logs); err != nil {
		t.Fatal(err)
	}
	ticket, err := srv.store.CreateTicket(store.NewTicket{SiteID: 1, SessionID: sid, VisitorKey: "visitor", Subject: "Broken checkout", Body: "Payment spins"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := srv.store.SaveFeedback(store.NewFeedback{SiteID: 1, SessionID: sid, Rating: 1, Comment: "Cannot pay", SurveyID: "default"}); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.EnsureSessionForSite(1, "other-session", time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	writeChunk(t, srv, "other-session", 0, []byte(`[{"type":3,"timestamp":1,"data":{"secret":"unrelated-recording"}}]`))
	if _, err := srv.store.SaveLogs(1, "other-session", []store.Log{{ClientSeq: 1, Severity: "error", Message: "unrelated-log"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.store.CreateTicket(store.NewTicket{SiteID: 1, SessionID: "other-session", VisitorKey: "other", Subject: "unrelated-ticket", Body: "Unrelated"}); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.store.SaveFeedback(store.NewFeedback{SiteID: 1, SessionID: "other-session", Rating: 5, Comment: "unrelated-feedback", SurveyID: "default"}); err != nil {
		t.Fatal(err)
	}
	resp := authed(t, ts.URL, http.MethodGet, "/api/sessions/"+sid+"/export?max_events=1&after_seq=999&css=ref", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("export: %d: %s", resp.StatusCode, body)
	}
	if got := resp.Header.Get("Content-Disposition"); got != "attachment; filename=traceux-session-sess-export.json" {
		t.Errorf("Content-Disposition = %q", got)
	}
	if resp.Header.Get("Cache-Control") != "no-store" || !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") {
		t.Errorf("unexpected headers: %v", resp.Header)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	var out exportedSession
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	if out.SchemaVersion != 1 || out.ExportedAt.IsZero() || out.Session.ID != sid || !out.Session.Active || out.Site.ID != 1 || out.Site.Name != "S" {
		t.Fatalf("wrong metadata: %+v", out.SessionExport)
	}
	if out.Format != "traceux-session-export" || out.RecordingFormat != "rrweb" {
		t.Fatal("export does not identify its file/recording formats")
	}
	guide := out.FormatGuide
	if guide.EventTypes[2] != "FullSnapshot" || guide.EventTypes[3] != "IncrementalSnapshot" || guide.NodeTypes[2] != "Element" || guide.IncrementalSources[0] != "Mutation" || guide.IncrementalSources[2] != "MouseInteraction" || guide.MouseInteractions[2] != "Click" {
		t.Fatal("standalone JSON does not explain snapshot, element, mutation and click codes")
	}
	if !strings.Contains(guide.Interpretation["node_ids"], "attributes.id") || !strings.Contains(guide.Interpretation["clicks"], "x/y") || !strings.Contains(guide.Interpretation["modals"], "add/remove") {
		t.Fatal("missing target-element, coordinate or modal-state interpretation")
	}
	if !strings.Contains(guide.TimeUnits["events[].timestamp"], "milliseconds") || guide.TimeUnits["session.started_at,session.last_seen"] != "Unix seconds" || guide.Collections["logs"] == "" || len(guide.AnalysisSteps) == 0 || len(guide.Limitations) == 0 || guide.Rendering == "" {
		t.Fatal("AI interpretation depends on information outside the exported file")
	}
	guideJSON, err := json.Marshal(guide)
	if err != nil || len(guideJSON) > 12<<10 {
		t.Fatalf("interpretation guide must stay small: %d bytes, %v", len(guideJSON), err)
	}
	if out.Session.Browser != "Firefox" || out.Session.Country != "HN" || out.Session.Referrer != "https://example.com/ref" {
		t.Fatalf("missing device/referral context: %+v", out.Session)
	}
	if len(out.Events) != 1+chunks*perChunk || len(out.Logs) != len(logs) || len(out.Pages) != 1 || len(out.CustomEvents) != 1 || len(out.Feedback) != 1 {
		t.Fatalf("missing data: events=%d logs=%d pages=%d custom=%d feedback=%d", len(out.Events), len(out.Logs), len(out.Pages), len(out.CustomEvents), len(out.Feedback))
	}
	if len(out.Tickets) != 1 || out.Tickets[0].Ticket.ID != ticket.ID || len(out.Tickets[0].Messages) != 1 || out.Tickets[0].Messages[0].Body != "Payment spins" {
		t.Fatalf("missing ticket conversation: %+v", out.Tickets)
	}
	var snapshot struct {
		Data struct {
			Node struct {
				CSS string `json:"_cssText"`
			} `json:"node"`
		} `json:"data"`
	}
	if err := json.Unmarshal(out.Events[0], &snapshot); err != nil || snapshot.Data.Node.CSS != css {
		t.Fatal("stylesheet was not expanded exactly")
	}
	for i, raw := range out.Events[1:] {
		var event struct{ Timestamp int }
		if err := json.Unmarshal(raw, &event); err != nil || event.Timestamp != perChunk+i+1 {
			t.Fatalf("event %d missing or out of order: %s", i, raw)
		}
	}
	site, _, _, _, err := srv.store.GetSiteDetail(1)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{site.SiteKey, "site_key", "password_hash", "visitor-key", "unrelated-recording", "unrelated-log", "unrelated-ticket", "unrelated-feedback", "@traceux-css-ref:"} {
		if bytes.Contains(body, []byte(forbidden)) {
			t.Errorf("export contains %q", forbidden)
		}
	}
}

func TestSessionExportAuthenticationAndEmptySession(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Empty", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.store.EnsureSessionForSite(site.ID, "empty", time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	resp := doReq(t, http.MethodGet, ts.URL+"/api/sessions/empty/export", nil, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated export: %d", resp.StatusCode)
	}
	user, err := srv.store.CreateUser("reader", "unused-hash", "viewer")
	if err != nil {
		t.Fatal(err)
	}
	token, err := srv.store.CreateAuthSession(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: authCookie, Value: token}
	resp = doReq(t, http.MethodGet, ts.URL+"/api/sessions/empty/export", cookie, "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("viewer export: %d", resp.StatusCode)
	}
	var out map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"events", "pages", "custom_events", "logs", "tickets", "feedback"} {
		var items []json.RawMessage
		if err := json.Unmarshal(out[field], &items); err != nil || items == nil || len(items) != 0 {
			t.Errorf("%s should be an empty array: %s", field, out[field])
		}
	}
	resp = doReq(t, http.MethodGet, ts.URL+"/api/sessions/missing/export", cookie, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing session: %d", resp.StatusCode)
	}
}

func TestSessionExportFailsBeforeDownloadOnCorruptRecording(t *testing.T) {
	srv, ts := newTestServer(t)
	seedCSSSession(t, srv, "broken", bigCSS("broken"))
	for _, corruption := range []string{"missing stylesheet", "invalid chunk"} {
		t.Run(corruption, func(t *testing.T) {
			if corruption == "missing stylesheet" {
				_, err := srv.store.DB.Exec(`DELETE FROM css_assets`)
				if err != nil {
					t.Fatal(err)
				}
			} else {
				_, err := srv.store.DB.Exec(`UPDATE chunks SET data = x'00' WHERE session_id='broken'`)
				if err != nil {
					t.Fatal(err)
				}
			}
			resp := authed(t, ts.URL, http.MethodGet, "/api/sessions/broken/export", "")
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusInternalServerError || resp.Header.Get("Content-Disposition") != "" {
				t.Fatalf("corrupt recording was offered as a download: %d %v", resp.StatusCode, resp.Header)
			}
			var body map[string]string
			if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || body["error"] == "" {
				t.Fatalf("missing error response: %+v, %v", body, err)
			}
		})
	}
}

type onFirstExportWrite struct {
	bytes.Buffer
	before func()
}

func (w *onFirstExportWrite) Write(data []byte) (int, error) {
	if w.before != nil {
		fn := w.before
		w.before = nil
		fn()
	}
	return w.Buffer.Write(data)
}

func TestSessionExportSnapshotAllowsConcurrentIngest(t *testing.T) {
	srv, _ := newTestServer(t)
	seedCSSSession(t, srv, "live", bigCSS("live"))
	writer := &onFirstExportWrite{before: func() {
		// These changes commit during export without blocking on its reader.
		writeChunk(t, srv, "live", 1, []byte(`[{"type":3,"timestamp":2,"data":{}}]`))
		if _, err := srv.store.DB.Exec(`UPDATE sessions SET browser='new browser' WHERE id='live'`); err != nil {
			t.Fatal(err)
		}
		if _, err := srv.store.DB.Exec(`DELETE FROM chunks WHERE session_id='live' AND seq=0`); err != nil {
			t.Fatal(err)
		}
	}}
	if err := srv.store.WriteSessionExport(context.Background(), "live", writer); err != nil {
		t.Fatal(err)
	}
	var out exportedSession
	if err := json.Unmarshal(writer.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Events) != 1 || out.Session.Browser == "new browser" || !bytes.Contains(out.Events[0], []byte("live")) {
		t.Fatal("export mixed data from different snapshots")
	}
	var next bytes.Buffer
	if err := srv.store.WriteSessionExport(context.Background(), "live", &next); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(next.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Events) != 1 || out.Session.Browser != "new browser" || !bytes.Contains(out.Events[0], []byte(`"timestamp":2`)) {
		t.Fatal("later export did not include newly committed events")
	}
}
