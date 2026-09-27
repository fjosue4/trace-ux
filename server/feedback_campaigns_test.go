package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"trace-ux/server/store"
)

func TestPublicFeedbackPathDoesNotCaptureDashboardRoutes(t *testing.T) {
	for _, path := range []string{
		"/api/feedback/site-key/campaigns/call/eligibility",
		"/api/feedback/site-key/deliveries/token/shown",
	} {
		if !isPublicFeedbackPath(path) {
			t.Fatalf("%q should be public", path)
		}
	}
	for _, path := range []string{
		"/api/feedback",
		"/api/feedback/summary",
		"/api/feedback/campaigns",
		"/api/feedback/campaigns/12",
		"/api/feedback/12",
	} {
		if isPublicFeedbackPath(path) {
			t.Fatalf("%q is a dashboard route", path)
		}
	}
}

func TestFeedbackCampaignAPIFlowAndMasterSwitch(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"Campaigns","url":"https://campaigns.example"}`)
	var site store.Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	createBody := fmt.Sprintf(`{
		"site_id":%d,"key":"phone-call-quality","name":"Phone call quality",
		"question":"How was the phone call?","answer_type":"scale_10","allow_comment":true,
		"recurrence":"weekly","placement":"explicit","enabled":true
	}`, site.ID)
	resp = doReq(t, http.MethodPost, ts.URL+"/api/feedback/campaigns", admin, createBody)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create campaign: %d", resp.StatusCode)
	}
	var campaign store.FeedbackCampaign
	if err := json.NewDecoder(resp.Body).Decode(&campaign); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	eligibilityURL := fmt.Sprintf("%s/api/feedback/%s/campaigns/%s/eligibility", ts.URL, site.SiteKey, url.PathEscape(campaign.CampaignKey))
	resp = doReq(t, http.MethodPost, eligibilityURL, nil, `{"visitor_key":"visitor-123","user_id":"user-123","occurrence_id":"call-1"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("eligibility: %d", resp.StatusCode)
	}
	var eligibility struct {
		Eligible      bool                   `json:"eligible"`
		DeliveryToken string                 `json:"delivery_token"`
		Campaign      store.FeedbackCampaign `json:"campaign"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&eligibility); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if !eligibility.Eligible || eligibility.DeliveryToken == "" || eligibility.Campaign.ID != campaign.ID {
		t.Fatalf("unexpected eligibility response: %+v", eligibility)
	}

	shownURL := fmt.Sprintf("%s/api/feedback/%s/deliveries/%s/shown", ts.URL, site.SiteKey, eligibility.DeliveryToken)
	resp = doReq(t, http.MethodPost, shownURL, nil, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("mark shown: %d", resp.StatusCode)
	}
	resp.Body.Close()

	ingestURL := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)
	feedbackBody := fmt.Sprintf(`{
		"type":"feedback","visitor_key":"visitor-123","user_id":"user-123",
		"survey_id":"phone-call-quality","rating":9,"comment":"Clear audio",
		"delivery_token":%q,"answers":[{"id":"rating","value":"9"}]
	}`, eligibility.DeliveryToken)
	resp = postJSON(t, ingestURL, feedbackBody, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("campaign feedback ingest: %d", resp.StatusCode)
	}
	items, err := srv.store.ListFeedback(store.FeedbackFilter{SiteID: site.ID, CampaignID: campaign.ID})
	if err != nil || len(items) != 1 || items[0].CampaignKey != campaign.CampaignKey {
		t.Fatalf("campaign feedback = %+v, err=%v", items, err)
	}

	settings := site.Settings
	disabled := false
	settings.WidgetEnabled = &disabled
	if err := srv.store.UpdateSiteSettings(site.ID, settings); err != nil {
		t.Fatal(err)
	}
	resp = doReq(t, http.MethodPost, eligibilityURL, nil, `{"visitor_key":"visitor-456","occurrence_id":"call-2"}`)
	var blocked map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&blocked); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if blocked["eligible"] != false || blocked["reason"] != "widget_disabled" {
		t.Fatalf("master switch response = %#v", blocked)
	}
}
