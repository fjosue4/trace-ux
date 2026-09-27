package store

import (
	"errors"
	"testing"
	"time"
)

func TestFeedbackCampaignDefaultAndRollingCooldown(t *testing.T) {
	s, _ := newTestStore(t)
	site, err := s.CreateSite("Campaign site", "https://campaign.example")
	if err != nil {
		t.Fatal(err)
	}

	defaults, err := s.ListFeedbackCampaigns(site.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(defaults) != 1 || !defaults[0].IsDefault || defaults[0].CampaignKey != "default" || !defaults[0].Enabled {
		t.Fatalf("unexpected default campaign: %+v", defaults)
	}

	campaign, err := s.CreateFeedbackCampaign(FeedbackCampaignInput{
		SiteID: site.ID, CampaignKey: "phone-call-quality", Name: "Phone call quality",
		Question: "How was the phone call?", AnswerType: "scale_10", AllowComment: true,
		Recurrence: "weekly", Placement: "explicit", Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	reservation, err := s.ReserveFeedbackCampaign(site.ID, campaign.CampaignKey, "visitor-one", "", "", "call-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.MarkFeedbackDelivery(site.ID, reservation.DeliveryToken, "shown"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReserveFeedbackCampaign(site.ID, campaign.CampaignKey, "visitor-one", "", "", "call-2"); !errors.Is(err, ErrCampaignRecurrence) {
		t.Fatalf("second weekly delivery error = %v, want recurrence", err)
	}

	// Weekly means a rolling seven-day cooldown, not a calendar boundary.
	if _, err := s.DB.Exec(`UPDATE feedback_deliveries SET shown_at = ?, status = 'dismissed' WHERE campaign_id = ?`,
		time.Now().Add(-8*24*time.Hour).Unix(), campaign.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReserveFeedbackCampaign(site.ID, campaign.CampaignKey, "visitor-one", "", "", "call-2"); err != nil {
		t.Fatalf("delivery after rolling cooldown: %v", err)
	}
}

func TestFeedbackCampaignDeliveryOutcomesAndResponse(t *testing.T) {
	s, _ := newTestStore(t)
	site, err := s.CreateSite("Campaign site", "https://campaign.example")
	if err != nil {
		t.Fatal(err)
	}
	campaign, err := s.CreateFeedbackCampaign(FeedbackCampaignInput{
		SiteID: site.ID, CampaignKey: "search-quality", Name: "Search quality",
		Question: "How was search?", AnswerType: "sentiment", AllowComment: true,
		Recurrence: "every_occurrence", Placement: "explicit", Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	reservation, err := s.ReserveFeedbackCampaign(site.ID, campaign.CampaignKey, "visitor", "user-1", "", "search-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.MarkFeedbackDelivery(site.ID, reservation.DeliveryToken, "shown"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveFeedback(NewFeedback{
		SiteID: site.ID, VisitorKey: "visitor", UserID: "user-1", SurveyID: campaign.CampaignKey,
		Rating: 1, Comment: "Fast", AnswersJSON: `[{"id":"rating","value":"Good"}]`,
		DeliveryToken: reservation.DeliveryToken,
	}); err != nil {
		t.Fatal(err)
	}

	items, err := s.ListFeedback(FeedbackFilter{SiteID: site.ID, CampaignID: campaign.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].CampaignKey != campaign.CampaignKey || items[0].CampaignName != campaign.Name {
		t.Fatalf("campaign response not attributed: %+v", items)
	}
	var status string
	if err := s.DB.QueryRow(`SELECT status FROM feedback_deliveries WHERE campaign_id = ?`, campaign.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "answered" {
		t.Fatalf("delivery status = %q, want answered", status)
	}

	skipped, err := s.ReserveFeedbackCampaign(site.ID, campaign.CampaignKey, "visitor", "user-1", "", "search-2")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.MarkFeedbackDelivery(site.ID, skipped.DeliveryToken, "shown"); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkFeedbackDelivery(site.ID, skipped.DeliveryToken, "skipped"); err != nil {
		t.Fatal(err)
	}
	campaigns, err := s.ListFeedbackCampaigns(site.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range campaigns {
		if item.ID == campaign.ID && (item.ResponseCount != 1 || item.ShownCount != 2 || item.SkippedCount != 1) {
			t.Fatalf("campaign funnel counts = %+v", item)
		}
	}
}

func TestDisabledFeedbackCampaignCannotReserve(t *testing.T) {
	s, _ := newTestStore(t)
	site, err := s.CreateSite("Campaign site", "https://campaign.example")
	if err != nil {
		t.Fatal(err)
	}
	campaign, err := s.CreateFeedbackCampaign(FeedbackCampaignInput{
		SiteID: site.ID, CampaignKey: "disabled", Name: "Disabled", Question: "Question?",
		AnswerType: "stars", AllowComment: false, Recurrence: "daily", Placement: "explicit", Enabled: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReserveFeedbackCampaign(site.ID, campaign.CampaignKey, "visitor", "", "", ""); !errors.Is(err, ErrCampaignDisabled) {
		t.Fatalf("reserve disabled campaign error = %v", err)
	}
}
