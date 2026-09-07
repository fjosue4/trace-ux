//go:build linux

package main

import (
	"os"
	"strconv"
	"strings"
	"syscall"
)

// OS-level metrics for the system health endpoint, read straight from /proc
// and statfs — no external dependencies, no scraping, no agents.

// readMemInfo returns total and available RAM from /proc/meminfo.
func readMemInfo() (total, available uint64) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		kv, ok := strings.CutSuffix(line, " kB")
		if !ok {
			continue
		}
		name, val, ok := strings.Cut(kv, ":")
		if !ok {
			continue
		}
		n, err := strconv.ParseUint(strings.TrimSpace(val), 10, 64)
		if err != nil {
			continue
		}
		switch strings.TrimSpace(name) {
		case "MemTotal":
			total = n * 1024
		case "MemAvailable":
			available = n * 1024
		}
	}
	return total, available
}

// readLoadAvg returns the 1/5/15-minute load averages from /proc/loadavg.
func readLoadAvg() (load1, load5, load15 float64) {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0
	}
	fields := strings.Fields(string(b))
	if len(fields) < 3 {
		return 0, 0, 0
	}
	parse := func(s string) float64 {
		v, _ := strconv.ParseFloat(s, 64)
		return v
	}
	return parse(fields[0]), parse(fields[1]), parse(fields[2])
}

// diskUsage stats the filesystem holding path.
func diskUsage(path string) (total, free uint64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	total = st.Blocks * uint64(st.Frsize)
	free = st.Bavail * uint64(st.Frsize) // available to unprivileged users
	return total, free
}

// procRuntime returns the trace-ux process RSS in bytes and the CPU seconds
// it has consumed since start (from /proc/self/stat).
func procRuntime() (rssBytes uint64, cpuSeconds float64) {
	b, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0, 0
	}
	// comm may contain spaces or parentheses: parse fields after the last ')'.
	s := string(b)
	i := strings.LastIndexByte(s, ')')
	if i < 0 || i+2 > len(s) {
		return 0, 0
	}
	fields := strings.Fields(s[i+2:]) // fields[0] is state, i.e. stat field 3
	if len(fields) < 22 {
		return 0, 0
	}
	const clockTicks = 100 // USER_HZ on Linux
	utime, _ := strconv.ParseFloat(fields[11], 64) // stat field 14
	stime, _ := strconv.ParseFloat(fields[12], 64) // stat field 15
	cpuSeconds = (utime + stime) / clockTicks
	rssPages, _ := strconv.ParseUint(fields[21], 10, 64) // stat field 24
	rssBytes = rssPages * uint64(os.Getpagesize())
	return rssBytes, cpuSeconds
}
