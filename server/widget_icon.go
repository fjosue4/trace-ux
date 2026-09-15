package main

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"trace-ux/server/store"
)

// handleUploadWidgetIcon, handleDeleteWidgetIcon and handlePublicWidgetIcon are
// the HTTP-layer counterparts of the store.WidgetIcon persistence in
// store/widget_icon.go.

func (s *Server) handleUploadWidgetIcon(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	// One extra byte so an oversized upload is detected rather than truncated
	// into something that happens to still decode.
	raw, err := io.ReadAll(io.LimitReader(http.MaxBytesReader(w, r.Body, store.MaxWidgetIconBytes+1), store.MaxWidgetIconBytes+1))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "icon upload too large")
		return
	}
	if len(raw) > store.MaxWidgetIconBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("icon must be at most %d KB", store.MaxWidgetIconBytes>>10))
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
