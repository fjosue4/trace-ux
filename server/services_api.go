package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
)

func servicePathIDs(r *http.Request) (int64, int64, error) {
	siteID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || siteID <= 0 {
		return 0, 0, sql.ErrNoRows
	}
	serviceID := int64(0)
	if value := r.PathValue("serviceId"); value != "" {
		serviceID, err = strconv.ParseInt(value, 10, 64)
		if err != nil || serviceID <= 0 {
			return 0, 0, sql.ErrNoRows
		}
	}
	return siteID, serviceID, nil
}

func (s *Server) handleListServices(w http.ResponseWriter, r *http.Request) {
	siteID, _, err := servicePathIDs(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	services, err := s.store.ListServices(siteID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, services)
}

func (s *Server) handleCreateService(w http.ResponseWriter, r *http.Request) {
	siteID, _, err := servicePathIDs(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	service, key, err := s.store.CreateService(siteID, body.Name)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			writeErr(w, http.StatusConflict, "a service with that name already exists")
		} else if strings.Contains(err.Error(), "service name") {
			writeErr(w, http.StatusBadRequest, err.Error())
		} else {
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"service": service, "api_key": key})
}

func (s *Server) handleUpdateService(w http.ResponseWriter, r *http.Request) {
	siteID, serviceID, err := servicePathIDs(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid service id")
		return
	}
	var body struct {
		Name              string   `json:"name"`
		InheritSeverities bool     `json:"inherit_severities"`
		Severities        []string `json:"severities"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	service, err := s.store.UpdateService(siteID, serviceID, body.Name, body.InheritSeverities, body.Severities)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "service not found")
	} else if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			writeErr(w, http.StatusConflict, "a service with that name already exists")
		} else if strings.Contains(err.Error(), "service name") || strings.Contains(err.Error(), "severities") {
			writeErr(w, http.StatusBadRequest, err.Error())
		} else {
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
	} else {
		writeJSON(w, http.StatusOK, service)
	}
}

func (s *Server) handleRotateServiceKey(w http.ResponseWriter, r *http.Request) {
	siteID, serviceID, err := servicePathIDs(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid service id")
		return
	}
	service, key, err := s.store.RotateServiceKey(siteID, serviceID)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "service not found")
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
	} else {
		writeJSON(w, http.StatusOK, map[string]any{"service": service, "api_key": key})
	}
}

func (s *Server) handleRevokeServiceKey(w http.ResponseWriter, r *http.Request) {
	siteID, serviceID, err := servicePathIDs(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid service id")
		return
	}
	if err := s.store.RevokeServiceKey(siteID, serviceID); err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "active service key not found")
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
	} else {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
