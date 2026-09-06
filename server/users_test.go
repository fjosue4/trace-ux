package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// login posts credentials and returns the session cookie.
func login(t *testing.T, baseURL, username, password string) *http.Cookie {
	t.Helper()
	body := fmt.Sprintf(`{"username":%q,"password":%q}`, username, password)
	resp, err := http.Post(baseURL+"/api/auth/login", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("login as %q: got %d, want 200 (%s)", username, resp.StatusCode, b)
	}
	for _, c := range resp.Cookies() {
		if c.Name == authCookie {
			return c
		}
	}
	t.Fatal("no auth cookie set")
	return nil
}

// doReq performs an authenticated request against the test server.
func doReq(t *testing.T, method, url string, cookie *http.Cookie, body string) *http.Response {
	t.Helper()
	var req *http.Request
	if body != "" {
		req, _ = http.NewRequest(method, url, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req, _ = http.NewRequest(method, url, nil)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestUserManagement(t *testing.T) {
	_, ts := newTestServer(t)

	// Legacy logins (no username) still work: they target the admin account.
	resp, _ := http.Post(ts.URL+"/api/auth/login", "application/json", strings.NewReader(`{"password":"pw"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("legacy password login failed: %d", resp.StatusCode)
	}
	admin := login(t, ts.URL, "admin", "pw")

	// me() reports the user and role.
	resp = doReq(t, http.MethodGet, ts.URL+"/api/auth/me", admin, "")
	me := map[string]string{}
	json.NewDecoder(resp.Body).Decode(&me)
	resp.Body.Close()
	if me["username"] != "admin" || me["role"] != "admin" {
		t.Fatalf("me() = %v, want admin/admin", me)
	}

	// Create a viewer.
	resp = doReq(t, http.MethodPost, ts.URL+"/api/users", admin, `{"username":"jane","password":"jane-pass-123","role":"viewer"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create user: %d", resp.StatusCode)
	}
	var created User
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	if created.ID == 0 || created.Role != "viewer" {
		t.Fatalf("created user wrong: %+v", created)
	}

	// Duplicate usernames are rejected (case-insensitive).
	resp = doReq(t, http.MethodPost, ts.URL+"/api/users", admin, `{"username":"JANE","password":"jane-pass-123"}`)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate username: got %d, want 409", resp.StatusCode)
	}
	resp.Body.Close()

	// Weak passwords are rejected.
	resp = doReq(t, http.MethodPost, ts.URL+"/api/users", admin, `{"username":"bob","password":"short"}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("weak password: got %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	jane := login(t, ts.URL, "jane", "jane-pass-123")

	// Viewers can browse sites/sessions…
	resp = doReq(t, http.MethodGet, ts.URL+"/api/sites", jane, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("viewer list sites: %d", resp.StatusCode)
	}
	resp.Body.Close()

	// …but not manage users.
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/users", ""},
		{http.MethodPost, "/api/users", `{"username":"x","password":"long-enough-pw"}`},
		{http.MethodPatch, fmt.Sprintf("/api/users/%d", created.ID), `{"role":"admin"}`},
		{http.MethodDelete, fmt.Sprintf("/api/users/%d", created.ID), ""},
	} {
		resp := doReq(t, tc.method, ts.URL+tc.path, jane, tc.body)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("viewer %s %s: got %d, want 403", tc.method, tc.path, resp.StatusCode)
		}
		resp.Body.Close()
	}

	// Admin can reset jane's password; jane's current session must die.
	resp = doReq(t, http.MethodPatch, ts.URL+fmt.Sprintf("/api/users/%d", created.ID), admin, `{"password":"new-jane-pass-9"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reset password: %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doReq(t, http.MethodGet, ts.URL+"/api/auth/me", jane, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("jane's session should be revoked, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp, _ = http.Post(ts.URL+"/api/auth/login", "application/json",
		strings.NewReader(`{"username":"jane","password":"jane-pass-123"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old password should not work: %d", resp.StatusCode)
	}
	jane = login(t, ts.URL, "jane", "new-jane-pass-9")

	// Deleting the user revokes their access too.
	resp = doReq(t, http.MethodDelete, ts.URL+fmt.Sprintf("/api/users/%d", created.ID), admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete user: %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doReq(t, http.MethodGet, ts.URL+"/api/auth/me", jane, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("deleted user's session should be dead, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Unknown users get 401, not 500.
	resp, _ = http.Post(ts.URL+"/api/auth/login", "application/json",
		strings.NewReader(`{"username":"ghost","password":"whatever-long"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unknown user: got %d, want 401", resp.StatusCode)
	}
}

func TestLastAdminGuard(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodGet, ts.URL+"/api/users", admin, "")
	var users []User
	json.NewDecoder(resp.Body).Decode(&users)
	resp.Body.Close()
	if len(users) != 1 {
		t.Fatalf("want 1 bootstrap admin, got %d", len(users))
	}
	adminID := users[0].ID

	// The last admin cannot be demoted or deleted…
	resp = doReq(t, http.MethodPatch, ts.URL+fmt.Sprintf("/api/users/%d", adminID), admin, `{"role":"viewer"}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("demote last admin: got %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doReq(t, http.MethodDelete, ts.URL+fmt.Sprintf("/api/users/%d", adminID), admin, "")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("delete last admin: got %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// …but with a second admin, both operations are fine.
	doReq(t, http.MethodPost, ts.URL+"/api/users", admin, `{"username":"root2","password":"root2-pass-1","role":"admin"}`)
	resp = doReq(t, http.MethodDelete, ts.URL+fmt.Sprintf("/api/users/%d", adminID), admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete admin with second admin present: %d", resp.StatusCode)
	}
	resp.Body.Close()

	// The deleted admin's session is gone.
	resp = doReq(t, http.MethodGet, ts.URL+"/api/auth/me", admin, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("deleted admin session alive: %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestSelfPasswordChange(t *testing.T) {
	_, ts := newTestServer(t)
	cookieA := login(t, ts.URL, "admin", "pw")
	cookieB := login(t, ts.URL, "admin", "pw") // a second device/session

	// Wrong current password is refused.
	resp := doReq(t, http.MethodPost, ts.URL+"/api/auth/password", cookieA,
		`{"current_password":"nope","new_password":"brand-new-pass"}`)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong current password: got %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doReq(t, http.MethodPost, ts.URL+"/api/auth/password", cookieA,
		`{"current_password":"pw","new_password":"brand-new-pass"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("change password: %d", resp.StatusCode)
	}
	resp.Body.Close()

	// The initiating session survives; the other one is revoked.
	resp = doReq(t, http.MethodGet, ts.URL+"/api/auth/me", cookieA, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("current session should survive: %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doReq(t, http.MethodGet, ts.URL+"/api/auth/me", cookieB, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("other session should be revoked: %d", resp.StatusCode)
	}
	resp.Body.Close()

	// New password works; old one does not.
	login(t, ts.URL, "admin", "brand-new-pass")
	resp, _ = http.Post(ts.URL+"/api/auth/login", "application/json",
		strings.NewReader(`{"username":"admin","password":"pw"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old password still valid: %d", resp.StatusCode)
	}
}

func TestPingDurationCappedAtTwoHours(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"T"}`)
	var site Site
	json.NewDecoder(resp.Body).Decode(&site)
	resp.Body.Close()
	ingestURL := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)

	postJSON(t, ingestURL, `{"type":"hello","session_id":"cap","url":"https://x.test/"}`, false)
	// Hostile client claims 9 hours of active time.
	if r := postJSON(t, ingestURL, `{"type":"ping","session_id":"cap","duration_ms":32400000,"page_count":1}`, false); r.StatusCode != 200 {
		t.Fatalf("ping: %d", r.StatusCode)
	}

	sess, err := srv.store.GetSession("cap")
	if err != nil {
		t.Fatal(err)
	}
	const twoHours = 2 * 60 * 60 * 1000
	if sess.DurationMs != twoHours {
		t.Fatalf("duration_ms = %d, want capped at %d", sess.DurationMs, twoHours)
	}
}

func TestListSessionsAcrossSites(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	mkSite := func(name string) Site {
		resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"`+name+`"}`)
		var s Site
		json.NewDecoder(resp.Body).Decode(&s)
		resp.Body.Close()
		return s
	}
	a := mkSite("Alpha")
	b := mkSite("Beta")

	srv.store.SaveHello(a.ID, "sa", "UA", "h", &ingestHello{URL: "https://a.test/"})
	srv.store.SaveHello(b.ID, "sb", "UA", "h", &ingestHello{URL: "https://b.test/"})

	get := func(q string) []Session {
		resp := doReq(t, http.MethodGet, ts.URL+"/api/sessions"+q, admin, "")
		var out []Session
		json.NewDecoder(resp.Body).Decode(&out)
		resp.Body.Close()
		return out
	}

	all := get("")
	if len(all) != 2 {
		t.Fatalf("global list should span sites, got %d sessions", len(all))
	}
	names := map[string]string{}
	for _, s := range all {
		names[s.ID] = s.SiteName
	}
	if names["sa"] != "Alpha" || names["sb"] != "Beta" {
		t.Fatalf("site_name missing or wrong: %v", names)
	}

	one := get("?site_id=" + fmt.Sprint(a.ID))
	if len(one) != 1 || one[0].ID != "sa" {
		t.Fatalf("site-scoped list wrong: %+v", one)
	}
}

func TestVisitorIdentityAndCustomEvents(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"T"}`)
	var site Site
	json.NewDecoder(resp.Body).Decode(&site)
	resp.Body.Close()
	u := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)

	// hello carries visitor identity from the snippet attributes
	postJSON(t, u, `{"type":"hello","session_id":"vis1","url":"https://x.test/","user_id":"u-42","client_id":"acme"}`, false)
	// a later identify() with a remote id must update the session
	postJSON(t, u, `{"type":"hello","session_id":"vis1","url":"https://x.test/page2","remote_id":"remote-7"}`, false)

	sess, err := srv.store.GetSession("vis1")
	if err != nil {
		t.Fatal(err)
	}
	if sess.UserID != "u-42" || sess.ClientID != "acme" || sess.RemoteID != "remote-7" {
		t.Fatalf("identity wrong: %+v", sess)
	}

	// tracked clicks land in custom_events and come back through the API
	postJSON(t, u, `{"type":"custom","session_id":"vis1","events":[
		{"ts":1000,"name":"click","track_id":"my-modal"},
		{"ts":2000,"name":"click","track_id":"checkout"},
		{"ts":1000,"name":"click","track_id":"my-modal"}]}`, false)

	detail := doReq(t, http.MethodGet, ts.URL+"/api/sessions/vis1", admin, "")
	var body struct {
		Session      Session       `json:"session"`
		CustomEvents []CustomEvent `json:"custom_events"`
	}
	json.NewDecoder(detail.Body).Decode(&body)
	detail.Body.Close()
	if len(body.CustomEvents) != 2 {
		t.Fatalf("want 2 deduped custom events, got %d", len(body.CustomEvents))
	}
	if body.CustomEvents[0].TrackID != "my-modal" || body.CustomEvents[1].TrackID != "checkout" {
		t.Fatalf("custom events wrong order/content: %+v", body.CustomEvents)
	}

	// visitor filter matches any of the three ids
	for _, q := range []string{"u-42", "acme", "remote-7"} {
		resp := doReq(t, http.MethodGet, ts.URL+"/api/sessions?site_id="+fmt.Sprint(site.ID)+"&visitor="+q, admin, "")
		var out []Session
		json.NewDecoder(resp.Body).Decode(&out)
		resp.Body.Close()
		if len(out) != 1 {
			t.Fatalf("visitor=%q should match 1 session, got %d", q, len(out))
		}
	}
	if got := doReq(t, http.MethodGet, ts.URL+"/api/sessions?visitor=nope", admin, ""); true {
		var out []Session
		json.NewDecoder(got.Body).Decode(&out)
		got.Body.Close()
		if len(out) != 0 {
			t.Fatalf("visitor=nope should match nothing, got %d", len(out))
		}
	}
}

func TestFeedbackFlow(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"T"}`)
	var site Site
	json.NewDecoder(resp.Body).Decode(&site)
	resp.Body.Close()
	u := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)

	// feedback tied to a session (so it can jump to the replay)…
	postJSON(t, u, `{"type":"hello","session_id":"fb1","url":"https://x.test/"}`, false)
	postJSON(t, u, `{"type":"feedback","session_id":"fb1","survey_id":"checkout","rating":2,"comment":"confusing"}`, false)
	// …and anonymous feedback without a session
	postJSON(t, u, `{"type":"feedback","session_id":"","survey_id":"checkout","rating":5}`, false)
	// out-of-range ratings are rejected
	if r := postJSON(t, u, `{"type":"feedback","session_id":"fb1","rating":11}`, false); r.StatusCode != 400 {
		t.Fatalf("rating 11: got %d, want 400", r.StatusCode)
	}

	list := doReq(t, http.MethodGet, ts.URL+"/api/feedback?survey_id=checkout", admin, "")
	var items []Feedback
	json.NewDecoder(list.Body).Decode(&items)
	list.Body.Close()
	if len(items) != 2 {
		t.Fatalf("want 2 feedback items, got %d", len(items))
	}
	// newest first: the 5-star anonymous response, then the linked one
	if items[0].Rating != 5 || items[1].Comment != "confusing" {
		t.Fatalf("feedback order/content wrong: %+v", items)
	}
	if items[1].SessionID != "fb1" || items[1].Browser != "Safari" {
		t.Fatalf("session link missing: %+v", items[1])
	}

	summary := doReq(t, http.MethodGet, ts.URL+"/api/feedback/summary?survey_id=checkout", admin, "")
	var sum []FeedbackSurveySummary
	json.NewDecoder(summary.Body).Decode(&sum)
	summary.Body.Close()
	if len(sum) != 1 || sum[0].Count != 2 || sum[0].Average != 3.5 {
		t.Fatalf("summary wrong: %+v", sum)
	}

	// viewers cannot delete feedback; admins can
	viewerResp := doReq(t, http.MethodPost, ts.URL+"/api/users", admin, `{"username":"vf","password":"vf-pass-123","role":"viewer"}`)
	viewerResp.Body.Close()
	vf := login(t, ts.URL, "vf", "vf-pass-123")
	resp = doReq(t, http.MethodDelete, ts.URL+"/api/feedback/1", vf, "")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer delete: got %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doReq(t, http.MethodDelete, ts.URL+"/api/feedback/1", admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin delete: %d", resp.StatusCode)
	}
	resp.Body.Close()
	srvFeedback, _ := srv.store.ListFeedback(FeedbackFilter{})
	if len(srvFeedback) != 1 {
		t.Fatalf("delete did not remove feedback: %d left", len(srvFeedback))
	}
}

func TestSiteManagementAndConfig(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"Hub"}`)
	var site Site
	json.NewDecoder(resp.Body).Decode(&site)
	resp.Body.Close()
	base := fmt.Sprintf("%s/api/sites/%d", ts.URL, site.ID)

	// Site hub payload: settings default on, empty lists, zero stats.
	detail := doReq(t, http.MethodGet, base, admin, "")
	var hub struct {
		Site     Site          `json:"site"`
		Sessions []Session     `json:"sessions"`
		Feedback []Feedback    `json:"feedback"`
		Stats    SiteStats     `json:"stats"`
	}
	json.NewDecoder(detail.Body).Decode(&hub)
	detail.Body.Close()
	if !hub.Site.RecordingEnabled || !hub.Site.Settings.FeedbackEnabled || hub.Site.Settings.SurveyType != "stars" {
		t.Fatalf("default settings wrong: %+v", hub.Site.Settings)
	}
	if len(hub.Sessions) != 0 || len(hub.Feedback) != 0 || hub.Stats.FeedbackCount != 0 {
		t.Fatalf("expected empty detail, got %+v", hub)
	}

	ingestURL := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)

	// Recording off: event batches are silently dropped…
	resp = doReq(t, http.MethodPatch, base, admin, `{"recording_enabled":false}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch recording: %d", resp.StatusCode)
	}
	resp.Body.Close()
	if r := postJSON(t, ingestURL, `{"type":"events","session_id":"rec1","seq":0,"events":[{"type":4}]}`, false); r.StatusCode != http.StatusNoContent {
		t.Fatalf("events while disabled: got %d, want 204", r.StatusCode)
	}
	// …but the feedback channel keeps working.
	if r := postJSON(t, ingestURL, `{"type":"feedback","session_id":"","rating":5}`, false); r.StatusCode != 200 {
		t.Fatalf("feedback while recording disabled: %d", r.StatusCode)
	}

	// Recording back on: events land again.
	resp = doReq(t, http.MethodPatch, base, admin, `{"recording_enabled":true}`)
	resp.Body.Close()
	postJSON(t, ingestURL, `{"type":"events","session_id":"rec1","seq":0,"events":[{"type":4}]}`, false)
	if _, err := srv.store.GetSession("rec1"); err != nil {
		t.Fatalf("events after re-enable should store: %v", err)
	}

	// Custom survey config round-trips to the public config endpoint.
	cfg := `{"feedback_enabled":true,"feedback_position":"left","survey_id":"csat","survey_title":"Rate us","survey_type":"custom","questions":[
		{"id":"ease","label":"How easy was it?","type":"rating","max":10},
		{"id":"found","label":"Found what you needed?","type":"choice","options":["Yes","No"]},
		{"id":"notes","label":"Anything else?","type":"text","optional":true}]}`
	resp = doReq(t, http.MethodPut, base+"/settings", admin, cfg)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("put settings: %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doReq(t, http.MethodGet, ts.URL+"/api/config/"+site.SiteKey, nil, "")
	var pub struct {
		RecordingEnabled bool `json:"recording_enabled"`
		Feedback         struct {
			Enabled   bool             `json:"enabled"`
			Position  string           `json:"position"`
			SurveyID  string           `json:"survey_id"`
			Title     string           `json:"title"`
			Type      string           `json:"type"`
			Questions []SurveyQuestion `json:"questions"`
		} `json:"feedback"`
	}
	json.NewDecoder(resp.Body).Decode(&pub)
	resp.Body.Close()
	if !pub.RecordingEnabled || !pub.Feedback.Enabled || pub.Feedback.Position != "left" ||
		pub.Feedback.SurveyID != "csat" || pub.Feedback.Type != "custom" || len(pub.Feedback.Questions) != 3 {
		t.Fatalf("public config wrong: %+v", pub)
	}

	// Invalid settings are rejected.
	resp = doReq(t, http.MethodPut, base+"/settings", admin, `{"feedback_enabled":true,"feedback_position":"top","survey_id":"x","survey_title":"t","survey_type":"stars"}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid settings: got %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// Appearance round-trips; invalid colors are rejected.
	resp = doReq(t, http.MethodPut, base+"/settings", admin,
		`{"feedback_enabled":true,"feedback_position":"right","survey_id":"csat","survey_title":"Rate us","survey_type":"stars",
		  "appearance":{"button_bg":"#ff5f3a","button_text":"#fff","button_label":"Say hi","accent":"#f5a623","radius":20,"spacing":24}}`)
	resp.Body.Close()
	resp = doReq(t, http.MethodGet, ts.URL+"/api/config/"+site.SiteKey, nil, "")
	var withAppearance struct {
		Feedback struct {
			Appearance struct {
				ButtonBg    string `json:"button_bg"`
				ButtonLabel string `json:"button_label"`
				Radius      int    `json:"radius"`
			} `json:"appearance"`
		} `json:"feedback"`
	}
	json.NewDecoder(resp.Body).Decode(&withAppearance)
	resp.Body.Close()
	if withAppearance.Feedback.Appearance.ButtonBg != "#ff5f3a" ||
		withAppearance.Feedback.Appearance.ButtonLabel != "Say hi" ||
		withAppearance.Feedback.Appearance.Radius != 20 {
		t.Fatalf("appearance round-trip wrong: %+v", withAppearance.Feedback.Appearance)
	}
	resp = doReq(t, http.MethodPut, base+"/settings", admin,
		`{"feedback_enabled":true,"feedback_position":"right","survey_id":"csat","survey_title":"t","survey_type":"stars","appearance":{"button_bg":"red"}}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid appearance color: got %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// Viewers cannot change site configuration.
	viewerResp := doReq(t, http.MethodPost, ts.URL+"/api/users", admin, `{"username":"vw","password":"vw-pass-123","role":"viewer"}`)
	viewerResp.Body.Close()
	vw := login(t, ts.URL, "vw", "vw-pass-123")
	resp = doReq(t, http.MethodPatch, base, vw, `{"recording_enabled":false}`)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer patch site: got %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// Max simultaneous recordings, on a dedicated site with a clean window.
	resp = doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"Cap"}`)
	var capSite Site
	json.NewDecoder(resp.Body).Decode(&capSite)
	resp.Body.Close()
	capURL := fmt.Sprintf("%s/api/ingest/%s", ts.URL, capSite.SiteKey)
	resp = doReq(t, http.MethodPut, fmt.Sprintf("%s/api/sites/%d/settings", ts.URL, capSite.ID), admin,
		`{"feedback_enabled":true,"feedback_position":"right","survey_id":"cap","survey_title":"Rate us","survey_type":"stars",
		  "max_concurrent_sessions":1,
		  "feedback_trigger":{"mode":"page","pages":["/pricing*"]}}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("put settings with cap: %d", resp.StatusCode)
	}
	resp.Body.Close()
	postJSON(t, capURL, `{"type":"hello","session_id":"capA","url":"https://x.test/"}`, false)
	postJSON(t, capURL, `{"type":"events","session_id":"capA","seq":0,"events":[{"type":4}]}`, false)
	postJSON(t, capURL, `{"type":"hello","session_id":"capB","url":"https://x.test/"}`, false)
	if r := postJSON(t, capURL, `{"type":"events","session_id":"capB","seq":0,"events":[{"type":4}]}`, false); r.StatusCode != http.StatusNoContent {
		t.Fatalf("capB events: got %d, want 204 (over cap)", r.StatusCode)
	}
	// The first session is unaffected by the second's rejection.
	postJSON(t, capURL, `{"type":"events","session_id":"capA","seq":1,"events":[{"type":2}]}`, false)
	sessA, err := srv.store.GetSession("capA")
	if err != nil || sessA.EventCount != 2 {
		t.Fatalf("capA should keep recording: err=%v sess=%+v", err, sessA)
	}

	// Trigger targeting round-trips to the public config.
	resp = doReq(t, http.MethodGet, ts.URL+"/api/config/"+capSite.SiteKey, nil, "")
	var trigCfg struct {
		Feedback struct {
			Trigger struct {
				Mode  string   `json:"mode"`
				Pages []string `json:"pages"`
			} `json:"trigger"`
		} `json:"feedback"`
	}
	json.NewDecoder(resp.Body).Decode(&trigCfg)
	resp.Body.Close()
	if trigCfg.Feedback.Trigger.Mode != "page" || len(trigCfg.Feedback.Trigger.Pages) != 1 || trigCfg.Feedback.Trigger.Pages[0] != "/pricing*" {
		t.Fatalf("trigger round-trip wrong: %+v", trigCfg.Feedback.Trigger)
	}

	// Manual recording deletion: allowed while the site setting is on…
	resp = doReq(t, http.MethodDelete, ts.URL+"/api/sessions/rec1", admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete recording: got %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
	if _, err := srv.store.GetSession("rec1"); err == nil {
		t.Fatal("rec1 should be gone")
	}
	// …and rejected once the site disables it.
	resp = doReq(t, http.MethodPut, base+"/settings", admin,
		`{"feedback_enabled":true,"feedback_position":"right","survey_id":"csat","survey_title":"Rate us","survey_type":"stars","allow_delete_recordings":false}`)
	resp.Body.Close()
	postJSON(t, ingestURL, `{"type":"events","session_id":"capC","seq":0,"events":[{"type":4}]}`, false)
	resp = doReq(t, http.MethodDelete, ts.URL+"/api/sessions/capC", admin, "")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("delete with setting off: got %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestURLFilterMatchesVisitedPages(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"T"}`)
	var site Site
	json.NewDecoder(resp.Body).Decode(&site)
	resp.Body.Close()

	srv.store.SaveHello(site.ID, "nav", "UA", "hash", &ingestHello{URL: "https://x.test/"})
	srv.store.SavePage(site.ID, "nav", &ingestPage{Idx: 0, URL: "https://x.test/"})
	srv.store.SavePage(site.ID, "nav", &ingestPage{Idx: 1, URL: "https://x.test/pricing", Title: "Pricing"})
	srv.store.SavePage(site.ID, "nav", &ingestPage{Idx: 2, URL: "https://x.test/checkout"})

	// "pricing" is only in the middle of the visit — not the entry or exit URL.
	get := func(q string) []Session {
		resp := doReq(t, http.MethodGet, ts.URL+"/api/sessions?site_id="+fmt.Sprint(site.ID)+q, admin, "")
		var out []Session
		json.NewDecoder(resp.Body).Decode(&out)
		resp.Body.Close()
		return out
	}
	if got := get("&url=pricing"); len(got) != 1 {
		t.Fatalf("url=pricing should match the mid-visit page, got %d sessions", len(got))
	}
	if got := get("&url=checkout"); len(got) != 1 {
		t.Fatalf("url=checkout (exit url) should match, got %d", len(got))
	}
	if got := get("&url=blog"); len(got) != 0 {
		t.Fatalf("url=blog should not match anything, got %d", len(got))
	}
	// Filters combine with other conditions without breaking the query.
	if got := get("&url=pricing&device=desktop"); len(got) != 1 {
		t.Fatalf("combined filters should still match, got %d", len(got))
	}
	if got := get("&url=pricing&device=mobile"); len(got) != 0 {
		t.Fatalf("combined filters should exclude, got %d", len(got))
	}
}
