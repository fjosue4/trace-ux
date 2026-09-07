package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

// version is overridden at release build time via -ldflags "-X main.version=v...".
var version = "dev"

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("trace-ux: ")
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version", "-v":
			fmt.Printf("trace-ux %s\n", version)
			return
		case "--help", "-h":
			fmt.Println("trace-ux — self-hosted session replay server")
			fmt.Println("  trace-ux            run the server (configure via TRACE_UX_* env vars)")
			fmt.Println("  trace-ux --version  print the version")
			return
		}
	}
	cfg := loadConfig()

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatalf("cannot create data dir %s: %v", cfg.DataDir, err)
	}
	store, err := OpenStore(filepath.Join(cfg.DataDir, "trace_ux.db"))
	if err != nil {
		log.Fatalf("cannot open database: %v", err)
	}
	defer store.Close()

	secret, err := loadSecret(cfg.DataDir)
	if err != nil {
		log.Fatalf("cannot load auth secret: %v", err)
	}

	// Bootstrap the admin account from TRACE_UX_PASSWORD. Once users exist the DB
	// owns all passwords; TRACE_UX_RESET_ADMIN=1 re-points admin at TRACE_UX_PASSWORD.
	if cfg.ResetAdmin {
		if err := store.ResetAdminPassword(cfg.Password); err != nil {
			log.Fatalf("cannot reset admin password: %v", err)
		}
		log.Println("admin password reset from TRACE_UX_PASSWORD; previous logins revoked")
	} else if err := store.EnsureAdmin(cfg.Password); err != nil {
		log.Fatalf("cannot ensure admin user: %v", err)
	}

	srv := &Server{
		store:  store,
		cfg:    &cfg,
		secret: secret,
		static: newStaticHandler(cfg),
	}

	// Retention sweep at boot, then every 6 hours. Also prunes expired
	// dashboard login sessions on the same cadence.
	go func() {
		time.Sleep(time.Minute)
		for {
			if n, err := store.RetentionSweep(cfg.RetentionDays); err != nil {
				log.Printf("retention: %v", err)
			} else if n > 0 {
				log.Printf("retention: removed %d expired items", n)
			}
			if n, err := store.DeleteExpiredAuthSessions(); err != nil {
				log.Printf("auth gc: %v", err)
			} else if n > 0 {
				log.Printf("auth gc: removed %d expired logins", n)
			}
			time.Sleep(6 * time.Hour)
		}
	}()

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("listening on %s (data: %s)", cfg.Addr, cfg.DataDir)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpSrv.Shutdown(ctx)
}
