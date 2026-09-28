package store

import "testing"

func TestSessionViewsAreStoredPerDashboardUser(t *testing.T) {
	s, _ := newTestStore(t)
	site, err := s.CreateSite("Views", "https://views.example")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO sessions (id, site_id, started_at, last_seen)
		VALUES ('viewed-session', ?, 100, 100)`, site.ID); err != nil {
		t.Fatal(err)
	}
	one, err := s.CreateUser("one", "hash", "viewer")
	if err != nil {
		t.Fatal(err)
	}
	two, err := s.CreateUser("two", "hash", "viewer")
	if err != nil {
		t.Fatal(err)
	}

	ok, err := s.MarkSessionViewed(one.ID, "viewed-session")
	if err != nil || !ok {
		t.Fatalf("mark viewed: ok=%v err=%v", ok, err)
	}
	// Reopening is idempotent and simply refreshes viewed_at.
	if ok, err = s.MarkSessionViewed(one.ID, "viewed-session"); err != nil || !ok {
		t.Fatalf("mark viewed again: ok=%v err=%v", ok, err)
	}
	if ok, err = s.MarkSessionViewed(one.ID, "missing-session"); err != nil || ok {
		t.Fatalf("missing session: ok=%v err=%v", ok, err)
	}

	viewedByOne, err := s.ViewedSessions(one.ID, []string{"viewed-session", "missing-session"})
	if err != nil {
		t.Fatal(err)
	}
	viewedByTwo, err := s.ViewedSessions(two.ID, []string{"viewed-session"})
	if err != nil {
		t.Fatal(err)
	}
	if !viewedByOne["viewed-session"] || viewedByOne["missing-session"] {
		t.Fatalf("unexpected first user views: %+v", viewedByOne)
	}
	if viewedByTwo["viewed-session"] {
		t.Fatal("one user's view state leaked to another user")
	}
}
