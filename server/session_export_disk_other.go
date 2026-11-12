//go:build !unix

package main

// freeDiskBytes cannot measure free space here, so the guard stands aside.
func freeDiskBytes(string) func() (int64, bool) {
	return nil
}
