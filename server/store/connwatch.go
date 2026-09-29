package store

import (
	"context"
	"errors"
	"fmt"
	"log"
	"runtime"
	"strings"
	"time"
)

// Write connection watchdog.
//
// DB is a single connection shared by every write and by the reads that still
// run on it, so whatever holds it stalls the whole server: ingest, the widget
// config and the dashboard all queue behind it. From the outside that looks
// like every endpoint being slow at once, and the access log only shows the
// queued requests finishing together, never which one was holding.
//
// The watchdog asks for the connection once a second. When it cannot get it
// within writeConnSlowAfter, it logs the goroutines that are running SQL or
// trace-ux code at that moment -- the holder is among them, with its function
// and line -- and then logs how long the connection stayed busy in total. It
// costs one pool checkout a second while the connection is free.

const (
	writeConnProbeEvery = time.Second
	writeConnSlowAfter  = 2 * time.Second

	// Caps one report, so a stall with many active goroutines cannot flood
	// the journal.
	maxHolderReportBytes = 16 << 10
)

func (s *Store) startWriteConnWatch(every, slowAfter time.Duration) {
	ctx, cancel := context.WithCancel(context.Background())
	s.connWatchCancel = cancel
	s.connWatchDone = make(chan struct{})
	go s.watchWriteConn(ctx, every, slowAfter)
}

func (s *Store) stopWriteConnWatch() {
	if s.connWatchCancel == nil {
		return
	}
	s.connWatchCancel()
	<-s.connWatchDone
}

func (s *Store) watchWriteConn(ctx context.Context, every, slowAfter time.Duration) {
	defer close(s.connWatchDone)
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		started := time.Now()
		probeCtx, cancel := context.WithTimeout(ctx, slowAfter)
		conn, err := s.DB.Conn(probeCtx)
		cancel()
		if err == nil {
			conn.Close()
			continue
		}
		if ctx.Err() != nil || !errors.Is(err, context.DeadlineExceeded) {
			continue
		}

		waiting, holders := writeConnHolders()
		log.Printf("store: write connection busy for over %s, %d request(s) waiting; active goroutines:\n%s",
			slowAfter, waiting, holders)
		conn, err = s.DB.Conn(ctx)
		if err != nil {
			return
		}
		conn.Close()
		log.Printf("store: write connection free again after %s", time.Since(started).Round(time.Millisecond))
	}
}

// writeConnHolders returns how many goroutines are queued for a pool
// connection and the stacks of the ones that could be holding it: anything in
// database/sql or the SQLite driver that is not itself queued, plus any
// running trace-ux code (a transaction doing work between statements).
func writeConnHolders() (int, string) {
	buf := make([]byte, 1<<20)
	for {
		n := runtime.Stack(buf, true)
		if n < len(buf) || len(buf) >= 32<<20 {
			buf = buf[:n]
			break
		}
		buf = make([]byte, 2*len(buf))
	}

	waiting := 0
	var out strings.Builder
	for _, g := range strings.Split(string(buf), "\n\n") {
		switch {
		case strings.Contains(g, "database/sql.(*DB).conn("):
			waiting++
			continue
		case strings.Contains(g, "store.(*Store).watchWriteConn"):
			continue
		}
		inSQL := strings.Contains(g, "database/sql.") || strings.Contains(g, "modernc.org/sqlite")
		if !inSQL && !(strings.Contains(g, "trace-ux/server") && goroutineActive(g)) {
			continue
		}
		if out.Len()+len(g) > maxHolderReportBytes {
			fmt.Fprintf(&out, "... (report truncated at %d bytes)\n", maxHolderReportBytes)
			break
		}
		out.WriteString(g)
		out.WriteString("\n\n")
	}
	if out.Len() == 0 {
		out.WriteString("(none found; the holder may be waiting on I/O between statements)\n")
	}
	return waiting, out.String()
}

// goroutineActive reports whether a runtime.Stack entry is on a CPU or in a
// system call rather than parked, from its "goroutine N [state]:" header.
func goroutineActive(g string) bool {
	header, _, _ := strings.Cut(g, "\n")
	return strings.Contains(header, "[running") ||
		strings.Contains(header, "[runnable") ||
		strings.Contains(header, "[syscall")
}
