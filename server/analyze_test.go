package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"trace-ux/server/store"
)

// ---- helpers ----

type analyzeTestEnv struct {
	srv   *Server
	url   string
	admin *http.Cookie
	site1 int64
	site2 int64
}

func newAnalyzeTestEnv(t *testing.T) *analyzeTestEnv {
	t.Helper()
	srv, ts := newTestServer(t)
	env := &analyzeTestEnv{srv: srv, url: ts.URL, admin: login(t, ts.URL, "admin", "pw")}
	for _, target := range []*int64{&env.site1, &env.site2} {
		site, err := srv.store.CreateSite(fmt.Sprintf("site-%p", target), "https://example.com")
		if err != nil {
			t.Fatal(err)
		}
		*target = site.ID
	}
	return env
}

// addUser creates a dashboard user through the API and logs them in.
func (e *analyzeTestEnv) addUser(t *testing.T, username, role string) (*http.Cookie, int64) {
	t.Helper()
	body := fmt.Sprintf(`{"username":%q,"password":"long-enough-pw","role":%q}`, username, role)
	resp := doReq(t, http.MethodPost, e.url+"/api/users", e.admin, body)
	var user store.User
	decodeBody(t, resp, http.StatusCreated, &user)
	return login(t, e.url, username, "long-enough-pw"), user.ID
}

func decodeBody(t *testing.T, resp *http.Response, want int, v any) {
	t.Helper()
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != want {
		t.Fatalf("%s %s: got %d, want %d (%s)", resp.Request.Method, resp.Request.URL.Path, resp.StatusCode, want, raw)
	}
	if v != nil {
		if err := json.Unmarshal(raw, v); err != nil {
			t.Fatalf("decode %s: %v (%s)", resp.Request.URL.Path, err, raw)
		}
	}
}

func expectStatus(t *testing.T, resp *http.Response, want int) string {
	t.Helper()
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != want {
		t.Fatalf("%s %s: got %d, want %d (%s)", resp.Request.Method, resp.Request.URL.Path, resp.StatusCode, want, raw)
	}
	return string(raw)
}

func eventDefinition(siteID any, name, trackID string) string {
	site := "null"
	if siteID != nil {
		site = fmt.Sprint(siteID)
	}
	match := fmt.Sprintf(`{"name":%q}`, name)
	if trackID != "" {
		match = fmt.Sprintf(`{"name":%q,"track_id":%q}`, name, trackID)
	}
	return fmt.Sprintf(`{"version":1,"source":"event","site_id":%s,"metric":"occurrences","match":%s,`+
		`"default_days":30,"interval":"day","timezone":"America/Tegucigalpa","visualization":"line"}`, site, match)
}

func reportBody(name, visibility, definition string) string {
	return fmt.Sprintf(`{"name":%q,"visibility":%q,"definition":%s}`, name, visibility, definition)
}

func (e *analyzeTestEnv) createReport(t *testing.T, cookie *http.Cookie, body string) store.AnalyzeReport {
	t.Helper()
	var report store.AnalyzeReport
	decodeBody(t, doReq(t, http.MethodPost, e.url+"/api/analyze/reports", cookie, body), http.StatusCreated, &report)
	return report
}

func (e *analyzeTestEnv) listReports(t *testing.T, cookie *http.Cookie, query string) []store.AnalyzeReport {
	t.Helper()
	var reports []store.AnalyzeReport
	decodeBody(t, doReq(t, http.MethodGet, e.url+"/api/analyze/reports"+query, cookie, ""), http.StatusOK, &reports)
	return reports
}

func (e *analyzeTestEnv) results(t *testing.T, cookie *http.Cookie, id int64, query string) analyzeResult {
	t.Helper()
	var result analyzeResult
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d/results%s", e.url, id, query), cookie, ""),
		http.StatusOK, &result)
	return result
}

func (e *analyzeTestEnv) saveEvents(t *testing.T, siteID int64, sessionID string, events ...store.CustomEvent) {
	t.Helper()
	if _, err := e.srv.store.SaveCustomEvents(siteID, sessionID, events); err != nil {
		t.Fatal(err)
	}
}

func reportIDs(reports []store.AnalyzeReport) map[int64]bool {
	out := map[int64]bool{}
	for _, r := range reports {
		out[r.ID] = true
	}
	return out
}

// ---- visibility and ownership ----

func TestAnalyzeVisibilityAndOwnership(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	alice, aliceID := e.addUser(t, "alice", "viewer")
	bob, _ := e.addUser(t, "bob", "viewer")

	private := e.createReport(t, alice, reportBody("Alice secret checkout", "private", eventDefinition(e.site1, "click", "checkout")))
	team := e.createReport(t, alice, reportBody("Signup clicks", "team", eventDefinition(nil, "click", "signup")))
	if private.Owner.ID != aliceID || !private.CanEdit || private.Source != "event" || *private.SiteID != e.site1 {
		t.Fatalf("created report wrong: %+v", private)
	}
	if team.SiteID != nil || team.Definition.SiteID != nil {
		t.Fatalf("all-sites report must have a null site: %+v", team)
	}

	// Alice sees both; Bob and even an admin see only the team report.
	if got := reportIDs(e.listReports(t, alice, "")); !got[private.ID] || !got[team.ID] {
		t.Fatalf("owner list missing reports: %v", got)
	}
	for who, cookie := range map[string]*http.Cookie{"bob": bob, "admin": e.admin} {
		for _, scope := range []string{"", "?scope=all", "?scope=team", "?scope=mine"} {
			got := reportIDs(e.listReports(t, cookie, scope))
			if got[private.ID] {
				t.Fatalf("%s sees a private report in list %q", who, scope)
			}
			if scope != "?scope=mine" && !got[team.ID] {
				t.Fatalf("%s is missing the team report in list %q", who, scope)
			}
			if scope == "?scope=mine" && len(got) != 0 {
				t.Fatalf("%s mine list should be empty: %v", who, got)
			}
		}
	}

	// Every route on someone else's private report is a 404, indistinguishable
	// from a report that never existed -- same status, same body.
	missing := private.ID + 1000
	for who, cookie := range map[string]*http.Cookie{"bob": bob, "admin": e.admin} {
		for _, tc := range []struct{ method, suffix, body string }{
			{http.MethodGet, "", ""},
			{http.MethodGet, "/results", ""},
			{http.MethodPatch, "", `{"name":"mine now"}`},
			{http.MethodDelete, "", ""},
			{http.MethodPost, "/duplicate", ""},
		} {
			hidden := expectStatus(t, doReq(t, tc.method, fmt.Sprintf("%s/api/analyze/reports/%d%s", e.url, private.ID, tc.suffix), cookie, tc.body), http.StatusNotFound)
			absent := expectStatus(t, doReq(t, tc.method, fmt.Sprintf("%s/api/analyze/reports/%d%s", e.url, missing, tc.suffix), cookie, tc.body), http.StatusNotFound)
			if hidden != absent {
				t.Fatalf("%s %s%s: private and missing reports differ: %q vs %q", who, tc.method, tc.suffix, hidden, absent)
			}
			if strings.Contains(hidden, "secret") {
				t.Fatalf("404 leaked the report name: %s", hidden)
			}
		}
	}

	// A teammate can read a team report but not change it.
	var got store.AnalyzeReport
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, team.ID), bob, ""), http.StatusOK, &got)
	if got.CanEdit {
		t.Fatal("non-owner must not be told they can edit")
	}
	e.results(t, bob, team.ID, "")
	expectStatus(t, doReq(t, http.MethodPatch, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, team.ID), bob, `{"name":"hijacked"}`), http.StatusForbidden)
	expectStatus(t, doReq(t, http.MethodPatch, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, team.ID), e.admin, `{"visibility":"private"}`), http.StatusForbidden)
	expectStatus(t, doReq(t, http.MethodDelete, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, team.ID), bob, ""), http.StatusForbidden)
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, team.ID), alice, ""), http.StatusOK, &got)
	if got.Name != "Signup clicks" || got.Visibility != "team" {
		t.Fatalf("rejected writes changed the report: %+v", got)
	}

	// Duplicating a team report gives Bob a private copy he owns.
	var copied store.AnalyzeReport
	decodeBody(t, doReq(t, http.MethodPost, fmt.Sprintf("%s/api/analyze/reports/%d/duplicate", e.url, team.ID), bob, ""), http.StatusCreated, &copied)
	if copied.ID == team.ID || !copied.CanEdit || copied.Visibility != "private" || copied.Name != "Copy of Signup clicks" ||
		copied.Definition.Match.TrackID != "signup" {
		t.Fatalf("duplicate wrong: %+v", copied)
	}
	if reportIDs(e.listReports(t, alice, ""))[copied.ID] {
		t.Fatal("Bob's private copy is visible to Alice")
	}

	// The owner can edit and switch visibility; the switch is enforced at once.
	decodeBody(t, doReq(t, http.MethodPatch, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, team.ID), alice,
		`{"name":"Signup clicks (private)","visibility":"private"}`), http.StatusOK, &got)
	if got.Visibility != "private" || got.Name != "Signup clicks (private)" || got.Definition.Match.TrackID != "signup" {
		t.Fatalf("owner patch wrong: %+v", got)
	}
	expectStatus(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, team.ID), bob, ""), http.StatusNotFound)

	// Owner delete works; afterwards it is gone for the owner too.
	expectStatus(t, doReq(t, http.MethodDelete, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, private.ID), alice, ""), http.StatusOK)
	expectStatus(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, private.ID), alice, ""), http.StatusNotFound)

	// Library filters.
	e.createReport(t, alice, reportBody("Site two", "team", eventDefinition(e.site2, "view", "")))
	for _, r := range e.listReports(t, alice, fmt.Sprintf("?site_id=%d", e.site2)) {
		if r.SiteID == nil || *r.SiteID != e.site2 {
			t.Fatalf("site filter returned %+v", r)
		}
	}
	if len(e.listReports(t, alice, "?source=log")) != 0 {
		t.Fatal("source filter returned event reports")
	}
	expectStatus(t, doReq(t, http.MethodGet, e.url+"/api/analyze/reports?scope=everyone", alice, ""), http.StatusBadRequest)
	expectStatus(t, doReq(t, http.MethodGet, e.url+"/api/analyze/reports", nil, ""), http.StatusUnauthorized)
}

func TestAnalyzeCascades(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	alice, aliceID := e.addUser(t, "alice", "viewer")
	bob, _ := e.addUser(t, "bob", "viewer")

	aliceTeam := e.createReport(t, alice, reportBody("Alice team", "team", eventDefinition(nil, "click", "")))
	e.createReport(t, alice, reportBody("Alice private", "private", eventDefinition(e.site1, "click", "")))
	siteScoped := e.createReport(t, bob, reportBody("Bob on site 2", "team", eventDefinition(e.site2, "click", "")))
	allSites := e.createReport(t, bob, reportBody("Bob all sites", "team", eventDefinition(nil, "click", "")))

	// Removing a user removes their reports.
	expectStatus(t, doReq(t, http.MethodDelete, fmt.Sprintf("%s/api/users/%d", e.url, aliceID), e.admin, ""), http.StatusOK)
	var remaining int
	if err := e.srv.store.DB.QueryRow(`SELECT COUNT(*) FROM analyze_reports WHERE owner_user_id = ?`, aliceID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("deleted user still owns %d reports", remaining)
	}
	expectStatus(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, aliceTeam.ID), bob, ""), http.StatusNotFound)

	// Removing a site removes reports scoped to it, but not All-sites reports.
	expectStatus(t, doReq(t, http.MethodDelete, fmt.Sprintf("%s/api/sites/%d", e.url, e.site2), e.admin, ""), http.StatusOK)
	got := reportIDs(e.listReports(t, bob, ""))
	if got[siteScoped.ID] || !got[allSites.ID] {
		t.Fatalf("site deletion cascade wrong: %v", got)
	}
}

// ---- validation ----

func TestAnalyzeDefinitionValidation(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	service, _, err := e.srv.store.CreateService(e.site2, "api")
	if err != nil {
		t.Fatal(err)
	}
	good := eventDefinition(e.site1, "click", "")
	logDef := func(match string) string {
		return fmt.Sprintf(`{"version":1,"source":"log","site_id":%d,"metric":"occurrences","match":%s,`+
			`"default_days":30,"interval":"day","timezone":"UTC","visualization":"bar"}`, e.site1, match)
	}
	replace := func(old, new string) string { return strings.Replace(good, old, new, 1) }

	cases := map[string]string{
		"unknown top-level field":    strings.Replace(good, `"version":1`, `"version":1,"sql":"DROP TABLE users"`, 1),
		"unknown match field":        replace(`{"name":"click"}`, `{"name":"click","name_regex":".*"}`),
		"log field on event":         replace(`{"name":"click"}`, `{"name":"click","severity":"error"}`),
		"event field on log":         logDef(`{"message":"boom","name":"click"}`),
		"blank event name":           replace(`{"name":"click"}`, `{"name":"   "}`),
		"blank track id":             replace(`{"name":"click"}`, `{"name":"click","track_id":" "}`),
		"blank log message":          logDef(`{"message":""}`),
		"oversized log message":      logDef(fmt.Sprintf(`{"message":%q}`, strings.Repeat("x", store.MaxAnalyzeLogMessageBytes+1))),
		"invalid severity":           logDef(`{"message":"boom","severity":"fatal"}`),
		"unknown message mode":       logDef(`{"message":"boom","message_mode":"regex"}`),
		"message mode on event":      replace(`{"name":"click"}`, `{"name":"click","message_mode":"contains"}`),
		"blank contains pattern":     logDef(`{"message":"  ","message_mode":"contains"}`),
		"negative service":           logDef(`{"message":"boom","service_id":-1}`),
		"service on another site":    logDef(fmt.Sprintf(`{"message":"boom","service_id":%d}`, service.ID)),
		"unknown service":            logDef(`{"message":"boom","service_id":999999}`),
		"zero default days":          replace(`"default_days":30`, `"default_days":0`),
		"too many default days":      replace(`"default_days":30`, `"default_days":366`),
		"unknown timezone":           replace(`"America/Tegucigalpa"`, `"Mars/Olympus_Mons"`),
		"server local timezone":      replace(`"America/Tegucigalpa"`, `"Local"`),
		"path-like timezone":         replace(`"America/Tegucigalpa"`, `"../../etc/passwd"`),
		"unsupported source":         replace(`"source":"event"`, `"source":"sessions"`),
		"unsupported metric":         replace(`"metric":"occurrences"`, `"metric":"sum"`),
		"interval not matching days": replace(`"interval":"day"`, `"interval":"hour"`),
		"days and hours together":    replace(`"default_days":30`, `"default_days":30,"default_hours":24`),
		"too many default hours":     replace(`"default_days":30,"interval":"day"`, `"default_hours":169,"interval":"hour"`),
		"negative default hours":     replace(`"default_days":30,"interval":"day"`, `"default_hours":-1,"interval":"hour"`),
		"hourly window drawn daily":  replace(`"default_days":30`, `"default_hours":24`),
		"short window drawn hourly":  replace(`"default_days":30,"interval":"day"`, `"default_hours":1,"interval":"hour"`),
		"unsupported visualization":  replace(`"visualization":"line"`, `"visualization":"pie"`),
		"future version":             replace(`"version":1`, `"version":2`),
		"zero site id":               eventDefinition(0, "click", ""),
		"nonexistent site":           eventDefinition(999999, "click", ""),
		"string site id":             replace(fmt.Sprintf(`"site_id":%d`, e.site1), `"site_id":"1 OR 1=1"`),
		"missing definition":         `null`,
	}
	for name, def := range cases {
		t.Run(name, func(t *testing.T) {
			expectStatus(t, doReq(t, http.MethodPost, e.url+"/api/analyze/reports", e.admin, reportBody("r", "team", def)), http.StatusBadRequest)
			expectStatus(t, doReq(t, http.MethodPost, e.url+"/api/analyze/preview", e.admin, `{"definition":`+def+`}`), http.StatusBadRequest)
		})
	}

	for name, body := range map[string]string{
		"blank name":         reportBody("  ", "team", good),
		"long name":          reportBody(strings.Repeat("n", maxAnalyzeNameChars+1), "team", good),
		"bad visibility":     reportBody("r", "public", good),
		"missing visibility": fmt.Sprintf(`{"name":"r","definition":%s}`, good),
		"long description":   fmt.Sprintf(`{"name":"r","visibility":"team","description":%q,"definition":%s}`, strings.Repeat("d", maxAnalyzeDescriptionChars+1), good),
	} {
		t.Run(name, func(t *testing.T) {
			expectStatus(t, doReq(t, http.MethodPost, e.url+"/api/analyze/reports", e.admin, body), http.StatusBadRequest)
		})
	}

	// A patch that breaks the definition is refused and changes nothing.
	report := e.createReport(t, e.admin, reportBody("valid", "team", good))
	expectStatus(t, doReq(t, http.MethodPatch, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, report.ID), e.admin,
		`{"name":"renamed","definition":`+replace(`"default_days":30`, `"default_days":0`)+`}`), http.StatusBadRequest)
	var got store.AnalyzeReport
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, report.ID), e.admin, ""), http.StatusOK, &got)
	if got.Name != "valid" {
		t.Fatalf("rejected patch changed the report: %+v", got)
	}

	// Bad ranges.
	for _, q := range []string{"?hours=0", "?hours=169", "?hours=1.5", "?days=0", "?days=366", "?from=2026-01-01", "?from=nope&to=2026-01-02", "?from=2020-01-01&to=2022-01-01"} {
		expectStatus(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d/results%s", e.url, report.ID, q), e.admin, ""), http.StatusBadRequest)
	}
}

// Injection-shaped strings are just values: they match nothing, break
// nothing, and round-trip unchanged.
func TestAnalyzeInjectionShapedStrings(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	now := time.Now().UnixMilli()
	e.saveEvents(t, e.site1, "sess-a", store.CustomEvent{TS: now, Name: "click", TrackID: "buy"})
	hostile := `click' OR '1'='1' --`
	report := e.createReport(t, e.admin, reportBody(`Robert'); DROP TABLE analyze_reports;--`, "team",
		eventDefinition(e.site1, hostile, `x" OR ""="`)))
	if report.Definition.Match.Name != hostile || report.Name != `Robert'); DROP TABLE analyze_reports;--` {
		t.Fatalf("values did not round-trip: %+v", report)
	}
	if got := e.results(t, e.admin, report.ID, ""); got.Total != 0 {
		t.Fatalf("hostile match counted %d events", got.Total)
	}
	var options struct{ Events []store.AnalyzeEventOption }
	decodeBody(t, doReq(t, http.MethodGet, e.url+"/api/analyze/options?source=event&search="+url.QueryEscape(`%' OR 1=1 --`), e.admin, ""), http.StatusOK, &options)
	if len(options.Events) != 0 {
		t.Fatalf("hostile search matched %v", options.Events)
	}
	if len(e.listReports(t, e.admin, "")) != 1 {
		t.Fatal("reports table damaged")
	}
}

// ---- aggregation ----

func TestAnalyzeEventDailySeries(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	loc, _ := time.LoadLocation("America/Tegucigalpa") // UTC-6, no DST
	today := startOfDay(time.Now().In(loc))
	day := func(offset int) time.Time { return today.AddDate(0, 0, offset) }

	// Two events either side of local midnight three days ago; in UTC both
	// fall on the same date, so only timezone-aware bucketing separates them.
	midnight := day(-3)
	e.saveEvents(t, e.site1, "sess-a",
		store.CustomEvent{TS: midnight.Add(-30 * time.Minute).UnixMilli(), Name: "click", TrackID: "checkout"},
		store.CustomEvent{TS: midnight.Add(30 * time.Minute).UnixMilli(), Name: "click", TrackID: "checkout"},
		store.CustomEvent{TS: midnight.Add(31 * time.Minute).UnixMilli(), Name: "click", TrackID: "checkout"},
		store.CustomEvent{TS: midnight.Add(40 * time.Minute).UnixMilli(), Name: "click", TrackID: "other"},
		store.CustomEvent{TS: midnight.Add(50 * time.Minute).UnixMilli(), Name: "view", TrackID: "checkout"},
	)
	// Same action on another site: must not cross into a site-1 report.
	e.saveEvents(t, e.site2, "sess-b", store.CustomEvent{TS: day(-1).Add(time.Hour).UnixMilli(), Name: "click", TrackID: "checkout"})

	siteReport := e.createReport(t, e.admin, reportBody("checkout", "team", eventDefinition(e.site1, "click", "checkout")))
	result := e.results(t, e.admin, siteReport.ID, "?days=7")
	if result.Buckets != 7 || len(result.Series) != 7 || result.Timezone != "America/Tegucigalpa" {
		t.Fatalf("want 7 daily points, got %d/%d (%s)", result.Buckets, len(result.Series), result.Timezone)
	}
	if result.From != day(-6).UnixMilli() || result.To != day(1).UnixMilli() {
		t.Fatalf("window = [%d, %d), want [%d, %d)", result.From, result.To, day(-6).UnixMilli(), day(1).UnixMilli())
	}
	want := map[int64]int64{day(-4).UnixMilli(): 1, day(-3).UnixMilli(): 2}
	var sum int64
	for i, p := range result.Series {
		if p.BucketStart != day(i-6).UnixMilli() {
			t.Fatalf("point %d starts at %d, want local midnight %d", i, p.BucketStart, day(i-6).UnixMilli())
		}
		if p.Count != want[p.BucketStart] {
			t.Fatalf("day %s: count %d, want %d", time.UnixMilli(p.BucketStart).In(loc).Format("2006-01-02"), p.Count, want[p.BucketStart])
		}
		if p.Incomplete {
			t.Fatal("recent days must not be marked incomplete")
		}
		sum += p.Count
	}
	if result.Total != 3 || sum != result.Total {
		t.Fatalf("total %d, sum of buckets %d, want 3", result.Total, sum)
	}
	if result.Average != 0.43 || result.Interval != "day" {
		t.Fatalf("average = %v per %s, want 0.43 per day", result.Average, result.Interval)
	}

	// Name-only match counts every track id; All sites crosses sites.
	allSites := e.createReport(t, e.admin, reportBody("clicks", "team", eventDefinition(nil, "click", "")))
	if got := e.results(t, e.admin, allSites.ID, "?days=7"); got.Total != 5 {
		t.Fatalf("all-sites name-only total = %d, want 5", got.Total)
	}

	// The same report in UTC puts all three checkout clicks on one date.
	utcDef := strings.Replace(eventDefinition(e.site1, "click", "checkout"), "America/Tegucigalpa", "UTC", 1)
	var preview analyzeResult
	decodeBody(t, doReq(t, http.MethodPost, e.url+"/api/analyze/preview", e.admin, `{"definition":`+utcDef+`,"days":7}`), http.StatusOK, &preview)
	nonZero := 0
	for _, p := range preview.Series {
		if p.Count > 0 {
			nonZero++
		}
	}
	if preview.Total != 3 || nonZero != 1 {
		t.Fatalf("UTC preview: total %d over %d days, want 3 over 1", preview.Total, nonZero)
	}

	// Explicit dates are local calendar days with an exclusive end.
	explicit := e.results(t, e.admin, siteReport.ID, fmt.Sprintf("?from=%s&to=%s", day(-3).Format("2006-01-02"), day(-2).Format("2006-01-02")))
	if explicit.Buckets != 1 || explicit.Total != 2 {
		t.Fatalf("single-day range: %d days, total %d, want 1 day with 2", explicit.Buckets, explicit.Total)
	}
	// Temporary ranges never mutate the saved default.
	var reread store.AnalyzeReport
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/reports/%d", e.url, siteReport.ID), e.admin, ""), http.StatusOK, &reread)
	if reread.Definition.DefaultDays != 30 || reread.UpdatedAt != siteReport.UpdatedAt {
		t.Fatalf("reading results changed the report: %+v", reread.Definition)
	}
	if got := e.results(t, e.admin, siteReport.ID, ""); got.Buckets != 30 {
		t.Fatalf("default window = %d days, want 30", got.Buckets)
	}
}

func TestAnalyzeRetentionLimitedRange(t *testing.T) {
	e := newAnalyzeTestEnv(t) // server retention is 90 days
	report := e.createReport(t, e.admin, reportBody("r", "team", eventDefinition(e.site1, "click", "")))
	result := e.results(t, e.admin, report.ID, "?days=120")
	if result.AvailableFrom <= result.From {
		t.Fatalf("available_from %d should be after from %d for a window past retention", result.AvailableFrom, result.From)
	}
	for _, p := range result.Series {
		if p.Incomplete != (p.BucketStart < result.AvailableFrom) {
			t.Fatalf("point %d incomplete=%v but available_from=%d", p.BucketStart, p.Incomplete, result.AvailableFrom)
		}
	}
	if !result.Series[0].Incomplete || result.Series[len(result.Series)-1].Incomplete {
		t.Fatal("expected only the oldest days to be retention-limited")
	}
	if inside := e.results(t, e.admin, report.ID, "?days=30"); inside.AvailableFrom != inside.From {
		t.Fatalf("a window inside retention should be fully available: %d vs %d", inside.AvailableFrom, inside.From)
	}
}

func TestAnalyzeLogReportsAndOptions(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	api, _, err := e.srv.store.CreateService(e.site1, "api")
	if err != nil {
		t.Fatal(err)
	}
	worker, _, err := e.srv.store.CreateService(e.site1, "worker")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	all := []string{"debug", "info", "warn", "error"}
	msg := "CheckoutError: payment declined"
	if _, _, err := e.srv.store.SaveServiceLogs(api, all, []store.ServiceLogEntry{
		{TimestampMs: now, Severity: "error", Message: msg, Environment: "production"},
		{TimestampMs: now, Severity: "error", Message: msg, Environment: "production"},
		{TimestampMs: now, Severity: "error", Message: msg, Environment: "staging"},
		{TimestampMs: now, Severity: "warn", Message: msg, Environment: "production"},
		{TimestampMs: now, Severity: "error", Message: msg + " (retry)", Environment: "production"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.srv.store.SaveServiceLogs(worker, all, []store.ServiceLogEntry{
		{TimestampMs: now, Severity: "error", Message: msg, Environment: "production"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.store.SaveLogs(e.site2, "sess-b", []store.Log{{ClientSeq: 1, TimestampMs: now, Severity: "error", Message: msg}}); err != nil {
		t.Fatal(err)
	}

	logDef := func(site any, match string) string {
		return fmt.Sprintf(`{"version":1,"source":"log","site_id":%v,"metric":"occurrences","match":%s,`+
			`"default_days":7,"interval":"day","timezone":"Asia/Kolkata","visualization":"bar"}`, site, match)
	}
	for _, tc := range []struct {
		name  string
		def   string
		total int64
	}{
		{"exact message on site", logDef(e.site1, fmt.Sprintf(`{"message":%q}`, msg)), 5},
		{"severity", logDef(e.site1, fmt.Sprintf(`{"message":%q,"severity":"error"}`, msg)), 4},
		{"service", logDef(e.site1, fmt.Sprintf(`{"message":%q,"service_id":%d}`, msg, api.ID)), 4},
		{"environment", logDef(e.site1, fmt.Sprintf(`{"message":%q,"service_id":%d,"environment":"production","severity":"error"}`, msg, api.ID)), 2},
		{"all sites", logDef("null", fmt.Sprintf(`{"message":%q,"severity":"error"}`, msg)), 5},
		{"exact is the default: no substring matching", logDef(e.site1, `{"message":"CheckoutError"}`), 0},
		{"explicit exact is case-sensitive", logDef(e.site1, fmt.Sprintf(`{"message":%q,"message_mode":"exact"}`, strings.ToLower(msg))), 0},
		// Contains ignores case and also counts the "(retry)" variant.
		{"contains", logDef(e.site1, `{"message":"checkouterror","message_mode":"contains"}`), 6},
		{"contains with severity", logDef(e.site1, `{"message":"payment DECLINED","message_mode":"contains","severity":"error"}`), 5},
		{"contains with service and environment", logDef(e.site1, fmt.Sprintf(`{"message":"declined","message_mode":"contains","service_id":%d,"environment":"production"}`, api.ID)), 4},
		{"contains treats LIKE wildcards literally", logDef(e.site1, `{"message":"%","message_mode":"contains"}`), 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			report := e.createReport(t, e.admin, reportBody(tc.name, "team", tc.def))
			if got := e.results(t, e.admin, report.ID, ""); got.Total != tc.total || got.Buckets != 7 {
				t.Fatalf("total %d over %d days, want %d over 7", got.Total, got.Buckets, tc.total)
			}
		})
	}

	// Suggestions never cross the selected site.
	var options struct{ Logs []store.AnalyzeLogOption }
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/options?source=log&site_id=%d", e.url, e.site2), e.admin, ""), http.StatusOK, &options)
	if len(options.Logs) != 1 || options.Logs[0].Count != 1 {
		t.Fatalf("site-2 log options = %+v, want the single site-2 log", options.Logs)
	}
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/options?source=log&site_id=%d&search=retry", e.url, e.site1), e.admin, ""), http.StatusOK, &options)
	if len(options.Logs) != 1 || options.Logs[0].Message != msg+" (retry)" {
		t.Fatalf("search options = %+v", options.Logs)
	}
	expectStatus(t, doReq(t, http.MethodGet, e.url+"/api/analyze/options?source=sessions", e.admin, ""), http.StatusBadRequest)

	// A log too long to save as a pattern is suggested by its opening text,
	// flagged truncated -- and that opening still counts it as a contains match.
	huge := "OutOfMemoryError: heap exhausted " + strings.Repeat("stack frame ", 2000)
	if _, _, err := e.srv.store.SaveServiceLogs(worker, all, []store.ServiceLogEntry{{TimestampMs: now, Severity: "error", Message: huge}}); err != nil {
		t.Fatal(err)
	}
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/options?source=log&site_id=%d&search=OutOfMemory", e.url, e.site1), e.admin, ""), http.StatusOK, &options)
	if len(options.Logs) != 1 || !options.Logs[0].Truncated || len(options.Logs[0].Message) > store.MaxAnalyzeLogMessageBytes ||
		!strings.HasPrefix(huge, options.Logs[0].Message) {
		t.Fatalf("long-message option = truncated %v, %d bytes", options.Logs[0].Truncated, len(options.Logs[0].Message))
	}
	prefixDef := logDef(e.site1, fmt.Sprintf(`{"message":%q,"message_mode":"contains"}`, options.Logs[0].Message))
	if got := e.results(t, e.admin, e.createReport(t, e.admin, reportBody("oom", "team", prefixDef)).ID, ""); got.Total != 1 {
		t.Fatalf("prefix contains-match counted %d, want 1", got.Total)
	}
}

func TestAnalyzeEventOptionsSiteBoundary(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	now := time.Now().UnixMilli()
	e.saveEvents(t, e.site1, "sess-a",
		store.CustomEvent{TS: now, Name: "click", TrackID: "checkout"},
		store.CustomEvent{TS: now + 1, Name: "click", TrackID: "checkout"},
		store.CustomEvent{TS: now, Name: "signup"},
	)
	e.saveEvents(t, e.site2, "sess-b", store.CustomEvent{TS: now, Name: "site-two-only"})

	var options struct{ Events []store.AnalyzeEventOption }
	decodeBody(t, doReq(t, http.MethodGet, fmt.Sprintf("%s/api/analyze/options?source=event&site_id=%d", e.url, e.site1), e.admin, ""), http.StatusOK, &options)
	if len(options.Events) != 2 || options.Events[0].TrackID != "checkout" || options.Events[0].Count != 2 {
		t.Fatalf("site-1 options = %+v", options.Events)
	}
	for _, o := range options.Events {
		if o.Name == "site-two-only" {
			t.Fatal("options crossed the site boundary")
		}
	}
}

func TestAnalyzeMeIncludesUserID(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	cookie, id := e.addUser(t, "carol", "viewer")
	var me struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	decodeBody(t, doReq(t, http.MethodGet, e.url+"/api/auth/me", cookie, ""), http.StatusOK, &me)
	if me.ID != id || me.Username != "carol" {
		t.Fatalf("me = %+v, want id %d", me, id)
	}
}

func TestAnalyzeServiceMissingWarning(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	svc, _, err := e.srv.store.CreateService(e.site1, "api")
	if err != nil {
		t.Fatal(err)
	}
	def := fmt.Sprintf(`{"version":1,"source":"log","site_id":%d,"metric":"occurrences","match":{"message":"boom","service_id":%d},`+
		`"default_days":7,"interval":"day","timezone":"UTC","visualization":"bar"}`, e.site1, svc.ID)
	report := e.createReport(t, e.admin, reportBody("svc", "team", def))
	if _, err := e.srv.store.DB.Exec(`DELETE FROM services WHERE id = ?`, svc.ID); err != nil {
		t.Fatal(err)
	}
	result := e.results(t, e.admin, report.ID, "")
	if len(result.Warnings) != 1 || result.Warnings[0].Code != "service_missing" {
		t.Fatalf("warnings = %+v, want service_missing", result.Warnings)
	}
}

func TestAnalyzeHourWindows(t *testing.T) {
	e := newAnalyzeTestEnv(t)
	loc, _ := time.LoadLocation("Asia/Kolkata") // UTC+5:30: hours start at :30 UTC
	now := time.Now().In(loc)
	hour := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, loc)
	five := now.Truncate(5 * time.Minute)

	e.saveEvents(t, e.site1, "sess-a",
		// Two in the current hour, one either side of the previous hour's start.
		// Anchored to bucket starts, not "now minus a second", so the test
		// cannot flake at the top of an hour; distinct track ids keep the two
		// rows apart when the current 5 minutes begin on the hour.
		store.CustomEvent{TS: five.UnixMilli(), Name: "click", TrackID: "a"},
		store.CustomEvent{TS: hour.UnixMilli(), Name: "click", TrackID: "b"},
		store.CustomEvent{TS: hour.Add(-time.Hour).UnixMilli(), Name: "click"},
		store.CustomEvent{TS: hour.Add(-time.Hour - time.Millisecond).UnixMilli(), Name: "click"},
		// Outside a 24-hour window.
		store.CustomEvent{TS: hour.Add(-24 * time.Hour).Add(-time.Minute).UnixMilli(), Name: "click"},
	)
	hourly := func(hours int) string {
		return strings.Replace(strings.Replace(eventDefinition(e.site1, "click", ""),
			`"default_days":30,"interval":"day"`, fmt.Sprintf(`"default_hours":%d,"interval":%q`, hours, analyzeIntervalFor(0, hours)), 1),
			"America/Tegucigalpa", "Asia/Kolkata", 1)
	}

	day := e.createReport(t, e.admin, reportBody("24h", "team", hourly(24)))
	if day.Definition.DefaultHours != 24 || day.Definition.DefaultDays != 0 || day.Definition.Interval != "hour" {
		t.Fatalf("saved hour window wrong: %+v", day.Definition)
	}
	r := e.results(t, e.admin, day.ID, "")
	if r.Interval != "hour" || r.Buckets != 24 || r.To != hour.Add(time.Hour).UnixMilli() || r.From != hour.Add(-23*time.Hour).UnixMilli() {
		t.Fatalf("24h window = %s x%d [%d, %d)", r.Interval, r.Buckets, r.From, r.To)
	}
	last, prev, before := r.Series[23], r.Series[22], r.Series[21]
	if last.BucketStart != hour.UnixMilli() || last.Count != 2 || prev.Count != 1 || before.Count != 1 || r.Total != 4 {
		t.Fatalf("hourly buckets: current %d, previous %d, before %d, total %d; want 2, 1, 1, 4", last.Count, prev.Count, before.Count, r.Total)
	}

	// The last hour is drawn in 5-minute buckets ending with the current one.
	short := e.createReport(t, e.admin, reportBody("1h", "team", hourly(1)))
	r = e.results(t, e.admin, short.ID, "")
	if r.Interval != "5min" || r.Buckets != 12 || r.To != five.Add(5*time.Minute).UnixMilli() {
		t.Fatalf("1h window = %s x%d ending %d", r.Interval, r.Buckets, r.To)
	}
	var sum int64
	for i, p := range r.Series {
		if p.BucketStart != five.Add(time.Duration(i-11)*5*time.Minute).UnixMilli() {
			t.Fatalf("5-minute bucket %d starts at %d", i, p.BucketStart)
		}
		sum += p.Count
	}
	if sum != r.Total || r.Series[11].Count < 1 {
		t.Fatalf("1h: sum %d, total %d, current bucket %d", sum, r.Total, r.Series[11].Count)
	}

	// A temporary hour range on a daily report, and back.
	daily := e.createReport(t, e.admin, reportBody("daily", "team", strings.Replace(eventDefinition(e.site1, "click", ""), "America/Tegucigalpa", "Asia/Kolkata", 1)))
	if r = e.results(t, e.admin, daily.ID, "?hours=72"); r.Interval != "hour" || r.Buckets != 72 {
		t.Fatalf("?hours=72 = %s x%d", r.Interval, r.Buckets)
	}
	if r = e.results(t, e.admin, daily.ID, "?hours=12"); r.Interval != "hour" || r.Buckets != 12 || r.Total != 4 {
		t.Fatalf("?hours=12 = %s x%d total %d", r.Interval, r.Buckets, r.Total)
	}
	if r = e.results(t, e.admin, day.ID, "?days=7"); r.Interval != "day" || r.Buckets != 7 {
		t.Fatalf("?days=7 on an hourly report = %s x%d", r.Interval, r.Buckets)
	}
	var preview analyzeResult
	decodeBody(t, doReq(t, http.MethodPost, e.url+"/api/analyze/preview", e.admin, `{"definition":`+hourly(12)+`,"hours":1}`), http.StatusOK, &preview)
	if preview.Interval != "5min" || preview.Buckets != 12 {
		t.Fatalf("preview hours=1 = %s x%d", preview.Interval, preview.Buckets)
	}
}
