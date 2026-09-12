package main

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"strconv"
	"time"

	// Raster decoders only. Registering these is what makes decodeWidgetIcon a
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
	maxWidgetIconBytes  = 256 << 10 // 256 KB
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

// decodeWidgetIcon validates raw upload bytes and reports the real format.
func decodeWidgetIcon(raw []byte) (mime string, width, height int, err error) {
	if len(raw) == 0 {
		return "", 0, 0, errors.New("icon is empty")
	}
	if len(raw) > maxWidgetIconBytes {
		return "", 0, 0, fmt.Errorf("icon must be at most %d KB", maxWidgetIconBytes>>10)
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
	mime, width, height, err := decodeWidgetIcon(raw)
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
	if err := s.db.QueryRow(`SELECT 1 FROM sites WHERE id = ?`, siteID).Scan(&exists); err != nil {
		return WidgetIcon{}, err
	}
	_, err = s.db.Exec(`INSERT INTO site_widget_icons (site_id, mime, bytes, etag, width, height, updated_at)
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
		err = s.db.QueryRow(`SELECT mime, etag, width, height, updated_at, bytes FROM site_widget_icons WHERE site_id = ?`, siteID).
			Scan(&icon.MIME, &icon.ETag, &icon.Width, &icon.Height, &icon.UpdatedAt, &icon.Bytes)
	} else {
		err = s.db.QueryRow(`SELECT mime, etag, width, height, updated_at FROM site_widget_icons WHERE site_id = ?`, siteID).
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
	_, err := s.db.Exec(`DELETE FROM site_widget_icons WHERE site_id = ?`, siteID)
	return err
}

// ---- handlers ----

func (s *Server) handleUploadWidgetIcon(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	// One extra byte so an oversized upload is detected rather than truncated
	// into something that happens to still decode.
	raw, err := io.ReadAll(io.LimitReader(http.MaxBytesReader(w, r.Body, maxWidgetIconBytes+1), maxWidgetIconBytes+1))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "icon upload too large")
		return
	}
	if len(raw) > maxWidgetIconBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("icon must be at most %d KB", maxWidgetIconBytes>>10))
		return
	}
	icon, err := s.store.SaveWidgetIcon(id, raw)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	if err != nil {
		// Every non-ErrNoRows failure here is a rejected image; the validation
		// messages are written for the person choosing the file.
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, icon)
}

func (s *Server) handleDeleteWidgetIcon(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	if err := s.store.DeleteWidgetIcon(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not remove icon")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handlePublicWidgetIcon serves the launcher icon to visitors of the tracked
// site. It is addressed by site key like the other public endpoints and is
// safe to cache: the URL carries the icon's ETag as a version query parameter,
// so a replaced icon is a different URL.
func (s *Server) handlePublicWidgetIcon(w http.ResponseWriter, r *http.Request) {
	site, err := s.store.GetSiteByKey(r.PathValue("siteKey"))
	if err != nil || site.ID == 0 {
		http.NotFound(w, r)
		return
	}
	icon, err := s.store.GetWidgetIcon(site.ID, true)
	if err != nil || icon == nil {
		http.NotFound(w, r)
		return
	}
	etag := `"` + icon.ETag + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400")
	// The MIME comes from decoding the bytes, never from the upload; combined
	// with the global nosniff header the browser cannot be talked into
	// treating this response as script or markup.
	w.Header().Set("Content-Type", icon.MIME)
	w.Header().Set("Content-Disposition", "inline")
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Write(icon.Bytes)
}
