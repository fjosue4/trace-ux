//go:build !linux

package main

// Non-Linux builds (Windows/macOS dev machines) have no /proc or statfs; the
// health endpoint reports zeros for OS-level figures and the UI shows them
// as unavailable. Production runs on Linux where everything is populated.

func readMemInfo() (total, available uint64) { return 0, 0 }

func readLoadAvg() (load1, load5, load15 float64) { return 0, 0, 0 }

func diskUsage(path string) (total, free uint64) { return 0, 0 }

func procRuntime() (rssBytes uint64, cpuSeconds float64) { return 0, 0 }
