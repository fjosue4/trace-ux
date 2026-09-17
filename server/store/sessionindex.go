package store

import (
	"encoding/json"
)

// A seek index over a recording's chunks.
//
// Windowed playback needs to answer "which chunk covers second 900?" without
// downloading the recording to find out. That is the same problem a video
// player has, and the same shape of answer: a small table mapping time to
// position, plus which entries are keyframes.
//
// Here the keyframes are FullSnapshots. rrweb can only start rendering from
// one, so a seek resolves to the nearest FullSnapshot at or before the target
// and replays forward from there. The 30s checkout interval is what bounds
// that work.

// ChunkIndex is one chunk's position in time.
type ChunkIndex struct {
	Seq      int   `json:"seq"`
	FirstTS  int64 `json:"first_ts"`
	LastTS   int64 `json:"last_ts"`
	Events   int   `json:"events"`
	Snapshot bool  `json:"snapshot"` // contains a FullSnapshot: a valid seek target
}

// SessionIndex builds the seek table for a recording.
//
// It decompresses every chunk, which is why the caller caches the result: on a
// 24-minute recording that is ~3.9 MB of gunzip, cheap once and wasteful per
// seek. Only the timestamps and event types are read; the DOM payload is
// skipped by json.RawMessage, so no snapshot is ever materialised.
func (s *Store) SessionIndex(sessionID string) ([]ChunkIndex, error) {
	seqs, err := s.GetSessionChunkSeqs(sessionID)
	if err != nil {
		return nil, err
	}
	out := make([]ChunkIndex, 0, len(seqs))
	for _, seq := range seqs {
		events, err := s.GetSessionChunkRaw(sessionID, seq)
		if err != nil {
			return nil, err
		}
		if len(events) == 0 {
			continue
		}
		ci := ChunkIndex{Seq: seq, Events: len(events)}
		for i, raw := range events {
			var head struct {
				Type      int   `json:"type"`
				Timestamp int64 `json:"timestamp"`
			}
			if err := json.Unmarshal(raw, &head); err != nil {
				continue
			}
			if head.Type == 2 {
				ci.Snapshot = true
			}
			if i == 0 || head.Timestamp < ci.FirstTS {
				ci.FirstTS = head.Timestamp
			}
			if head.Timestamp > ci.LastTS {
				ci.LastTS = head.Timestamp
			}
		}
		out = append(out, ci)
	}
	return out, nil
}
