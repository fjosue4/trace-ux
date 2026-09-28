package main

import (
	"testing"

	"trace-ux/server/store"
)

// Session lists leave out recordings shorter than a second. A hello starts a
// session with no recorded length, so fixtures that are about something else
// (filters, identity, stats) give their sessions a realistic one.
func makeSessionsListable(t *testing.T, st *store.Store) {
	t.Helper()
	if _, err := st.DB.Exec(`UPDATE sessions SET duration_ms = MAX(duration_ms, 60000)`); err != nil {
		t.Fatal(err)
	}
}
