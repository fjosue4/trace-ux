package store

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"time"

	// Raster decoders only. Registering these is what makes DecodeWidgetIcon a
	// real format check: anything that is not one of them fails to decode.
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
)

// The launcher icon is uploaded by an admin and then served to every visitor
// of the customer's site, so it is treated as untrusted content:
//
//   - Only raster formats are accepted. SVG is deliberately unsupported — it is
//     an XML document that can carry <script>, and it would execute in the
//     visitor's origin the moment anyone opened the file directly.
//   - The format is decided by decoding the bytes, never by the upload's
//     Content-Type or file name, and the stored MIME is the decoded one.
//   - Size and pixel dimensions are bounded so a site cannot park a huge blob
//     in SQLite or hand every visitor a megabyte on first paint.
const (
	MaxWidgetIconBytes  = 256 << 10 // 256 KB
	maxWidgetIconPixels = 1024
	minWidgetIconPixels = 16
)

var widgetIconMIME = map[string]string{
	"png":  "image/png",
	"jpeg": "image/jpeg",
	"gif":  "image/gif",
}

var errUnsupportedIcon = errors.New("icon must be a PNG, JPEG or GIF image")

type WidgetIcon struct {
	MIME      string `json:"mime"`
	ETag      string `json:"etag"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	UpdatedAt int64  `json:"updated_at"`
	Bytes     []byte `json:"-"`
}

// DecodeWidgetIcon validates raw upload bytes and reports the real format.
func DecodeWidgetIcon(raw []byte) (mime string, width, height int, err error) {
	if len(raw) == 0 {
		return "", 0, 0, errors.New("icon is empty")
	}
	if len(raw) > MaxWidgetIconBytes {
		return "", 0, 0, fmt.Errorf("icon must be at most %d KB", MaxWidgetIconBytes>>10)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return "", 0, 0, errUnsupportedIcon
	}
	mime, ok := widgetIconMIME[format]
	if !ok {
		return "", 0, 0, errUnsupportedIcon
	}
	if cfg.Width < minWidgetIconPixels || cfg.Height < minWidgetIconPixels {
		return "", 0, 0, fmt.Errorf("icon must be at least %dx%d pixels", minWidgetIconPixels, minWidgetIconPixels)
	}
	if cfg.Width > maxWidgetIconPixels || cfg.Height > maxWidgetIconPixels {
		return "", 0, 0, fmt.Errorf("icon must be at most %dx%d pixels", maxWidgetIconPixels, maxWidgetIconPixels)
	}
	return mime, cfg.Width, cfg.Height, nil
}

func (s *Store) SaveWidgetIcon(siteID int64, raw []byte) (WidgetIcon, error) {
	mime, width, height, err := DecodeWidgetIcon(raw)
	if err != nil {
		return WidgetIcon{}, err
	}
	sum := sha256.Sum256(raw)
	icon := WidgetIcon{
		MIME:      mime,
		ETag:      hex.EncodeToString(sum[:16]),
		Width:     width,
		Height:    height,
		UpdatedAt: time.Now().Unix(),
		Bytes:     raw,
	}
	var exists int
	if err := s.DB.QueryRow(`SELECT 1 FROM sites WHERE id = ?`, siteID).Scan(&exists); err != nil {
		return WidgetIcon{}, err
	}
	_, err = s.DB.Exec(`INSERT INTO site_widget_icons (site_id, mime, bytes, etag, width, height, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(site_id) DO UPDATE SET mime=excluded.mime, bytes=excluded.bytes,
			etag=excluded.etag, width=excluded.width, height=excluded.height, updated_at=excluded.updated_at`,
		siteID, icon.MIME, icon.Bytes, icon.ETag, icon.Width, icon.Height, icon.UpdatedAt)
	if err != nil {
		return WidgetIcon{}, err
	}
	return icon, nil
}

// GetWidgetIcon returns the stored icon. withBytes=false skips the blob, which
// is what the dashboard and the config endpoint need.
func (s *Store) GetWidgetIcon(siteID int64, withBytes bool) (*WidgetIcon, error) {
	var icon WidgetIcon
	var err error
	if withBytes {
		err = s.DB.QueryRow(`SELECT mime, etag, width, height, updated_at, bytes FROM site_widget_icons WHERE site_id = ?`, siteID).
			Scan(&icon.MIME, &icon.ETag, &icon.Width, &icon.Height, &icon.UpdatedAt, &icon.Bytes)
	} else {
		err = s.DB.QueryRow(`SELECT mime, etag, width, height, updated_at FROM site_widget_icons WHERE site_id = ?`, siteID).
			Scan(&icon.MIME, &icon.ETag, &icon.Width, &icon.Height, &icon.UpdatedAt)
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &icon, nil
}

func (s *Store) DeleteWidgetIcon(siteID int64) error {
	_, err := s.DB.Exec(`DELETE FROM site_widget_icons WHERE site_id = ?`, siteID)
	return err
}
