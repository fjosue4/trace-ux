//go:build unix

package main

import (
	"path/filepath"
	"syscall"
)

// freeDiskBytes measures the volume holding path, for the export disk guard.
func freeDiskBytes(path string) func() (int64, bool) {
	dir := filepath.Dir(path)
	return func() (int64, bool) {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(dir, &stat); err != nil {
			return 0, false
		}
		return int64(stat.Bavail) * int64(stat.Bsize), true
	}
}
