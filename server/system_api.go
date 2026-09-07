package main

import (
	"io/fs"
	"net/http"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sync"
	"time"
)

// ---- System health endpoint (admin only) ----
//
// TraceUX is frugal, but on a small VPS it shares the box with other
// services. This endpoint gives the dashboard a live view of RAM, CPU and
// disk — and, for each, the share that TraceUX itself accounts for.

type ramHealth struct {
	TotalBytes     uint64 `json:"total_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	TraceUXBytes   uint64 `json:"trace_ux_bytes"` // process RSS
	MemLimitBytes  int64  `json:"mem_limit_bytes"`
}

type cpuHealth struct {
	Cores         int     `json:"cores"`
	Load1         float64 `json:"load1"`
	Load5         float64 `json:"load5"`
	Load15        float64 `json:"load15"`
	TraceUXPct    float64 `json:"trace_ux_pct"`
	UptimeSeconds float64 `json:"uptime_seconds"`
}

type diskHealth struct {
	TotalBytes    uint64 `json:"total_bytes"`
	FreeBytes     uint64 `json:"free_bytes"`
	TraceUXBytes  uint64 `json:"trace_ux_bytes"` // size of the data dir (SQLite + keys)
	DataDir       string `json:"data_dir"`
}

type storeCounts struct {
	Sites    int64 `json:"sites"`
	Sessions int64 `json:"sessions"`
	Feedback int64 `json:"feedback"`
}

var procStart = time.Now()

// TraceUX CPU% is measured between consecutive polls so the dashboard's
// periodic refresh shows near-instantaneous usage; the first poll reports
// the average since process start.
var lastCPUSample struct {
	sync.Mutex
	at  time.Time
	cpu float64
}

func traceUXCPUPercent(cpuSeconds float64) float64 {
	now := time.Now()
	lastCPUSample.Lock()
	defer lastCPUSample.Unlock()
	var pct float64
	if lastCPUSample.at.IsZero() {
		if elapsed := now.Sub(procStart).Seconds(); elapsed > 0 {
			pct = cpuSeconds / elapsed * 100
		}
	} else if dt := now.Sub(lastCPUSample.at).Seconds(); dt > 0 {
		pct = (cpuSeconds - lastCPUSample.cpu) / dt * 100
	}
	lastCPUSample.at, lastCPUSample.cpu = now, cpuSeconds
	if pct < 0 {
		pct = 0
	}
	return pct
}

// dirSize sums the sizes of every regular file under path.
func dirSize(path string) int64 {
	var total int64
	filepath.WalkDir(path, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable entries don't fail the report
		}
		if info, err := d.Info(); err == nil && !d.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

func (s *Store) Counts() (sites, sessions, feedback int64, err error) {
	err = s.db.QueryRow(`SELECT
		(SELECT COUNT(*) FROM sites),
		(SELECT COUNT(*) FROM sessions),
		(SELECT COUNT(*) FROM feedback)`).Scan(&sites, &sessions, &feedback)
	return
}

func (s *Server) handleSystemHealth(w http.ResponseWriter, r *http.Request) {
	total, available := readMemInfo()
	rss, cpuSecs := procRuntime()
	ram := ramHealth{
		TotalBytes:     total,
		AvailableBytes: available,
			   TraceUXBytes:   rss,
	}
	if total >= available {
		ram.UsedBytes = total - available
	}
	if lim := debug.SetMemoryLimit(-1); lim != int64(^uint64(0)>>1) {
		ram.MemLimitBytes = lim // GOMEMLIMIT soft cap; 0 = unset
	}

	cpu := cpuHealth{
		Cores:         runtime.NumCPU(),
			   TraceUXPct:    traceUXCPUPercent(cpuSecs),
		UptimeSeconds: time.Since(procStart).Seconds(),
	}
	cpu.Load1, cpu.Load5, cpu.Load15 = readLoadAvg()

	disk := diskHealth{
			   TraceUXBytes: uint64(dirSize(s.cfg.DataDir)),
		DataDir:      s.cfg.DataDir,
	}
	disk.TotalBytes, disk.FreeBytes = diskUsage(s.cfg.DataDir)

	sites, sessions, feedback, err := s.store.Counts()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	counts := storeCounts{Sites: sites, Sessions: sessions, Feedback: feedback}

	writeJSON(w, http.StatusOK, map[string]any{
		"ram":   ram,
		"cpu":   cpu,
		"disk":  disk,
		"store": counts,
	})
}
