package main

const (
	logSeverityDebug = "debug"
	logSeverityInfo  = "info"
	logSeverityWarn  = "warn"
	logSeverityError = "error"

	defaultLogRetentionDays = 15
	defaultLogMaxRows       = 1_000_000
	maxLogRetentionDays     = 3650
	maxLogRows              = 10_000_000
	maxLogListLimit         = 1000
)

// LogSettings controls the browser logs captured for one site. The
// minimum severity is enforced both by the tracker and by the ingest handler.
// RetentionDays and MaxRows are independent caps; whichever is reached first
// removes the oldest stored rows during the periodic retention sweep. A zero
// value disables that particular cap.
type LogSettings struct {
	Enabled         bool   `json:"enabled"`
	MinimumSeverity string `json:"minimum_severity"`
	RetentionDays   int    `json:"retention_days"`
	MaxRows         int    `json:"max_rows"`
}

func DefaultLogSettings() LogSettings {
	return LogSettings{
		Enabled:         false,
		MinimumSeverity: logSeverityError,
		RetentionDays:   defaultLogRetentionDays,
		MaxRows:         defaultLogMaxRows,
	}
}

func validLogSeverity(value string) bool {
	switch value {
	case logSeverityDebug, logSeverityInfo, logSeverityWarn, logSeverityError:
		return true
	default:
		return false
	}
}

func logSeverityRank(value string) int {
	switch value {
	case logSeverityDebug:
		return 0
	case logSeverityInfo:
		return 1
	case logSeverityWarn:
		return 2
	case logSeverityError:
		return 3
	default:
		return -1
	}
}

func logMeetsMinimumSeverity(value, minimum string) bool {
	return validLogSeverity(value) && validLogSeverity(minimum) &&
		logSeverityRank(value) >= logSeverityRank(minimum)
}
