package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrCampaignNotFound   = errors.New("feedback campaign not found")
	ErrCampaignDisabled   = errors.New("feedback campaign disabled")
	ErrCampaignRecurrence = errors.New("feedback campaign recurrence cooldown")
	ErrDeliveryNotFound   = errors.New("feedback delivery not found")
	ErrDeliveryState      = errors.New("invalid feedback delivery state")
)

type FeedbackCampaign struct {
	ID             int64  `json:"id"`
	SiteID         int64  `json:"site_id"`
	CampaignKey    string `json:"key"`
	Name           string `json:"name"`
	Question       string `json:"question"`
	AnswerType     string `json:"answer_type"`
	AllowComment   bool   `json:"allow_comment"`
	Recurrence     string `json:"recurrence"`
	Placement      string `json:"placement"`
	Enabled        bool   `json:"enabled"`
	IsDefault      bool   `json:"is_default"`
	CreatedAt      int64  `json:"created_at"`
	UpdatedAt      int64  `json:"updated_at"`
	ResponseCount  int64  `json:"response_count,omitempty"`
	ShownCount     int64  `json:"shown_count,omitempty"`
	DismissedCount int64  `json:"dismissed_count,omitempty"`
	SkippedCount   int64  `json:"skipped_count,omitempty"`
}

type FeedbackCampaignInput struct {
	SiteID       int64  `json:"site_id"`
	CampaignKey  string `json:"key"`
	Name         string `json:"name"`
	Question     string `json:"question"`
	AnswerType   string `json:"answer_type"`
	AllowComment bool   `json:"allow_comment"`
	Recurrence   string `json:"recurrence"`
	Placement    string `json:"placement"`
	Enabled      bool   `json:"enabled"`
}

func ValidateFeedbackCampaignInput(in FeedbackCampaignInput) error {
	in.CampaignKey = strings.TrimSpace(in.CampaignKey)
	in.Name = strings.TrimSpace(in.Name)
	in.Question = strings.TrimSpace(in.Question)
	if in.SiteID <= 0 {
		return fmt.Errorf("site_id is required")
	}
	if len(in.CampaignKey) < 1 || len(in.CampaignKey) > 100 {
		return fmt.Errorf("key must be 1-100 characters")
	}
	for _, r := range in.CampaignKey {
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_') {
			return fmt.Errorf("key must contain only lowercase letters, numbers, hyphens or underscores")
		}
	}
	if in.Name == "" || len(in.Name) > 120 {
		return fmt.Errorf("name must be 1-120 characters")
	}
	if in.Question == "" || len(in.Question) > 300 {
		return fmt.Errorf("question must be 1-300 characters")
	}
	if in.AnswerType != "sentiment" && in.AnswerType != "stars" && in.AnswerType != "scale_10" {
		return fmt.Errorf("answer_type must be sentiment, stars or scale_10")
	}
	if in.Recurrence != "every_occurrence" && in.Recurrence != "daily" && in.Recurrence != "weekly" {
		return fmt.Errorf("recurrence must be every_occurrence, daily or weekly")
	}
	if in.Placement != "widget" && in.Placement != "explicit" {
		return fmt.Errorf("placement must be widget or explicit")
	}
	return nil
}

const feedbackCampaignCols = `c.id, c.site_id, c.campaign_key, c.name, c.question, c.answer_type,
	c.allow_comment, c.recurrence, c.placement, c.enabled, c.is_default, c.created_at, c.updated_at`

func scanFeedbackCampaign(row interface{ Scan(...any) error }) (FeedbackCampaign, error) {
	var c FeedbackCampaign
	var allowComment, enabled, isDefault int
	err := row.Scan(&c.ID, &c.SiteID, &c.CampaignKey, &c.Name, &c.Question, &c.AnswerType,
		&allowComment, &c.Recurrence, &c.Placement, &enabled, &isDefault, &c.CreatedAt, &c.UpdatedAt)
	c.AllowComment = allowComment != 0
	c.Enabled = enabled != 0
	c.IsDefault = isDefault != 0
	return c, err
}

func (s *Store) ListFeedbackCampaigns(siteID int64) ([]FeedbackCampaign, error) {
	rows, err := s.DB.Query(`SELECT `+feedbackCampaignCols+`,
		(SELECT COUNT(*) FROM feedback f WHERE f.campaign_id = c.id),
		(SELECT COUNT(*) FROM feedback_deliveries d WHERE d.campaign_id = c.id AND d.shown_at > 0),
		(SELECT COUNT(*) FROM feedback_deliveries d WHERE d.campaign_id = c.id AND d.status = 'dismissed'),
		(SELECT COUNT(*) FROM feedback_deliveries d WHERE d.campaign_id = c.id AND d.status = 'skipped')
		FROM feedback_campaigns c WHERE c.site_id = ? ORDER BY c.is_default DESC, c.created_at, c.id`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FeedbackCampaign{}
	for rows.Next() {
		var c FeedbackCampaign
		var allowComment, enabled, isDefault int
		if err := rows.Scan(&c.ID, &c.SiteID, &c.CampaignKey, &c.Name, &c.Question, &c.AnswerType,
			&allowComment, &c.Recurrence, &c.Placement, &enabled, &isDefault, &c.CreatedAt, &c.UpdatedAt,
			&c.ResponseCount, &c.ShownCount, &c.DismissedCount, &c.SkippedCount); err != nil {
			return nil, err
		}
		c.AllowComment, c.Enabled, c.IsDefault = allowComment != 0, enabled != 0, isDefault != 0
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetDefaultFeedbackCampaign(siteID int64) (*FeedbackCampaign, error) {
	c, err := scanFeedbackCampaign(s.DB.QueryRow(`SELECT `+feedbackCampaignCols+` FROM feedback_campaigns c WHERE c.site_id = ? AND c.is_default = 1`, siteID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) CreateFeedbackCampaign(in FeedbackCampaignInput) (FeedbackCampaign, error) {
	if err := ValidateFeedbackCampaignInput(in); err != nil {
		return FeedbackCampaign{}, err
	}
	// The default is the one always-available widget campaign. Additional
	// campaigns are contextual and opened explicitly by the host application.
	in.Placement = "explicit"
	now := time.Now().Unix()
	res, err := s.DB.Exec(`INSERT INTO feedback_campaigns
		(site_id, campaign_key, name, question, answer_type, allow_comment, recurrence, placement, enabled, is_default, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, in.SiteID, in.CampaignKey, in.Name, in.Question,
		in.AnswerType, in.AllowComment, in.Recurrence, in.Placement, in.Enabled, now, now)
	if err != nil {
		return FeedbackCampaign{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return FeedbackCampaign{}, err
	}
	return scanFeedbackCampaign(s.DB.QueryRow(`SELECT `+feedbackCampaignCols+` FROM feedback_campaigns c WHERE c.id = ?`, id))
}

func (s *Store) UpdateFeedbackCampaign(id int64, in FeedbackCampaignInput) (FeedbackCampaign, error) {
	if err := ValidateFeedbackCampaignInput(in); err != nil {
		return FeedbackCampaign{}, err
	}
	var current FeedbackCampaign
	var err error
	current, err = scanFeedbackCampaign(s.DB.QueryRow(`SELECT `+feedbackCampaignCols+` FROM feedback_campaigns c WHERE c.id = ?`, id))
	if err != nil {
		return FeedbackCampaign{}, err
	}
	if current.SiteID != in.SiteID {
		return FeedbackCampaign{}, ErrCampaignNotFound
	}
	placement := "explicit"
	if current.IsDefault {
		placement = "widget"
	}
	now := time.Now().Unix()
	_, err = s.DB.Exec(`UPDATE feedback_campaigns SET name = ?, question = ?, answer_type = ?, allow_comment = ?,
		recurrence = ?, placement = ?, enabled = ?, updated_at = ? WHERE id = ?`, in.Name, in.Question,
		in.AnswerType, in.AllowComment, in.Recurrence, placement, in.Enabled, now, id)
	if err != nil {
		return FeedbackCampaign{}, err
	}
	return scanFeedbackCampaign(s.DB.QueryRow(`SELECT `+feedbackCampaignCols+` FROM feedback_campaigns c WHERE c.id = ?`, id))
}

type CampaignReservation struct {
	Campaign      FeedbackCampaign `json:"campaign"`
	DeliveryToken string           `json:"delivery_token"`
}

func campaignTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func cooldownSeconds(recurrence string) int64 {
	switch recurrence {
	case "daily":
		return 24 * 60 * 60
	case "weekly":
		return 7 * 24 * 60 * 60
	default:
		return 0
	}
}

func (s *Store) ReserveFeedbackCampaign(siteID int64, key, visitorKey, userID, sessionID, occurrenceID string) (CampaignReservation, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return CampaignReservation{}, err
	}
	defer tx.Rollback()
	c, err := scanFeedbackCampaign(tx.QueryRow(`SELECT `+feedbackCampaignCols+` FROM feedback_campaigns c WHERE c.site_id = ? AND c.campaign_key = ?`, siteID, key))
	if errors.Is(err, sql.ErrNoRows) {
		return CampaignReservation{}, ErrCampaignNotFound
	}
	if err != nil {
		return CampaignReservation{}, err
	}
	if !c.Enabled {
		return CampaignReservation{}, ErrCampaignDisabled
	}
	now := time.Now().Unix()
	identityClause, identity := "visitor_key = ? AND user_id = ''", visitorKey
	if userID != "" {
		identityClause, identity = "user_id = ?", userID
	}
	if identity == "" {
		return CampaignReservation{}, fmt.Errorf("visitor identity required")
	}
	var count int
	if occurrenceID != "" {
		err = tx.QueryRow(`SELECT COUNT(*) FROM feedback_deliveries WHERE campaign_id = ? AND `+identityClause+` AND occurrence_id = ?`, c.ID, identity, occurrenceID).Scan(&count)
		if err != nil {
			return CampaignReservation{}, err
		}
		if count > 0 {
			return CampaignReservation{}, ErrCampaignRecurrence
		}
	}
	// One live reservation per identity protects simultaneous tabs. It expires
	// quickly and does not itself consume the recurrence cooldown.
	err = tx.QueryRow(`SELECT COUNT(*) FROM feedback_deliveries WHERE campaign_id = ? AND `+identityClause+` AND status = 'reserved' AND created_at > ?`,
		c.ID, identity, now-120).Scan(&count)
	if err != nil {
		return CampaignReservation{}, err
	}
	if count > 0 {
		return CampaignReservation{}, ErrCampaignRecurrence
	}
	if cooldown := cooldownSeconds(c.Recurrence); cooldown > 0 {
		err = tx.QueryRow(`SELECT COUNT(*) FROM feedback_deliveries WHERE campaign_id = ? AND `+identityClause+` AND shown_at >= ?`,
			c.ID, identity, now-cooldown).Scan(&count)
		if err != nil {
			return CampaignReservation{}, err
		}
		if count > 0 {
			return CampaignReservation{}, ErrCampaignRecurrence
		}
	}
	snapshot, _ := json.Marshal(c)
	token := newKey(24)
	_, err = tx.Exec(`INSERT INTO feedback_deliveries
		(site_id, campaign_id, token_hash, session_id, visitor_key, user_id, occurrence_id, status, campaign_snapshot, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`, siteID, c.ID, campaignTokenHash(token), sessionID,
		visitorKey, userID, occurrenceID, string(snapshot), now)
	if err != nil {
		return CampaignReservation{}, err
	}
	if err := tx.Commit(); err != nil {
		return CampaignReservation{}, err
	}
	return CampaignReservation{Campaign: c, DeliveryToken: token}, nil
}

func (s *Store) MarkFeedbackDelivery(siteID int64, token, action string) error {
	if action != "shown" && action != "dismissed" && action != "skipped" {
		return ErrDeliveryState
	}
	now := time.Now().Unix()
	hash := campaignTokenHash(token)
	var res sql.Result
	var err error
	if action == "shown" {
		res, err = s.DB.Exec(`UPDATE feedback_deliveries SET status = 'shown', shown_at = ?
			WHERE site_id = ? AND token_hash = ? AND status = 'reserved' AND created_at > ?`, now, siteID, hash, now-120)
	} else {
		res, err = s.DB.Exec(`UPDATE feedback_deliveries SET status = ?, completed_at = ?
			WHERE site_id = ? AND token_hash = ? AND status = 'shown'`, action, now, siteID, hash)
	}
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrDeliveryState
	}
	return nil
}
