package store

// DemoReplayToken is the site/session a demo replay bearer token grants
// access to. Its fields are read directly by the demo-replay handlers in the
// main package.
type DemoReplayToken struct {
	SiteID    int64
	SessionID string
}

func (s *Store) CreateDemoReplayToken(hash string, siteID int64, sessionID string, created, expires int64) error {
	_, err := s.DB.Exec(`INSERT INTO demo_replay_tokens (token_hash, site_id, session_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`, hash, siteID, sessionID, created, expires)
	return err
}

func (s *Store) GetDemoReplayToken(hash string, now int64) (*DemoReplayToken, error) {
	var rec DemoReplayToken
	err := s.DB.QueryRow(`SELECT site_id, session_id FROM demo_replay_tokens WHERE token_hash = ? AND expires_at > ?`, hash, now).Scan(&rec.SiteID, &rec.SessionID)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) DeleteExpiredDemoReplayTokens(now int64) error {
	_, err := s.DB.Exec(`DELETE FROM demo_replay_tokens WHERE expires_at <= ?`, now)
	return err
}
