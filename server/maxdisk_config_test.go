package main

import "testing"

// TRACE_UX_MAX_GB_DISK defaults to null, and null means no limit. The cases
// that matter are the ones where a wrong value must NOT silently become "no
// limit" without saying so -- the failure mode there is an operator who thinks
// the disk is capped and finds out otherwise from a full filesystem.
func TestMaxDiskBudgetParsing(t *testing.T) {
	const gib = uint64(1) << 30

	cases := []struct {
		name string
		set  bool
		val  string
		want uint64
	}{
		{name: "unset is no limit", set: false, want: 0},
		{name: "empty is no limit", set: true, val: "", want: 0},
		{name: "explicit zero is no limit", set: true, val: "0", want: 0},
		{name: "whole gigabytes", set: true, val: "25", want: 25 * gib},
		{name: "fractional gigabytes", set: true, val: "0.5", want: gib / 2},
		{name: "surrounding whitespace tolerated", set: true, val: "  25  ", want: 25 * gib},
		{name: "unit suffix does not silently cap", set: true, val: "25GB", want: 0},
		{name: "garbage does not silently cap", set: true, val: "lots", want: 0},
		{name: "negative does not cap", set: true, val: "-5", want: 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Required by loadConfig's own bootstrap check; unrelated to this.
			t.Setenv("TRACE_UX_PASSWORD", "x")
			if tc.set {
				t.Setenv("TRACE_UX_MAX_GB_DISK", tc.val)
			}
			got := loadConfig().MaxDiskBytes
			if got != tc.want {
				t.Fatalf("TRACE_UX_MAX_GB_DISK=%q -> MaxDiskBytes %d, want %d", tc.val, got, tc.want)
			}
		})
	}
}

// The floor has a default; the budget deliberately does not.
func TestSpaceFloorDefault(t *testing.T) {
	t.Setenv("TRACE_UX_PASSWORD", "x")
	cfg := loadConfig()
	if cfg.SpaceFloorDays != 3 {
		t.Fatalf("SpaceFloorDays = %d, want 3", cfg.SpaceFloorDays)
	}
	if cfg.MaxDiskBytes != 0 {
		t.Fatalf("MaxDiskBytes = %d with nothing set, want 0 (no limit)", cfg.MaxDiskBytes)
	}
}
