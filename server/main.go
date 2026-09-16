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

	"trace-ux/server/store"
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

	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		log.Fatalf("cannot create data dir %s: %v", cfg.DataDir, err)
	}
	if err := os.Chmod(cfg.DataDir, 0o700); err != nil {
		log.Fatalf("cannot secure data dir %s: %v", cfg.DataDir, err)
	}
	db, err := store.OpenStore(filepath.Join(cfg.DataDir, "trace_ux.db"))
	if err != nil {
		log.Fatalf("cannot open database: %v", err)
	}
	defer db.Close()

	secret, err := loadSecret(cfg.DataDir)
	if err != nil {
		log.Fatalf("cannot load auth secret: %v", err)
	}

	// Bootstrap the admin account from TRACE_UX_PASSWORD. Once users exist the DB
	// owns all passwords; TRACE_UX_RESET_ADMIN=1 re-points admin at TRACE_UX_PASSWORD.
	if cfg.ResetAdmin {
		if err := db.ResetAdminPassword(cfg.Password); err != nil {
			log.Fatalf("cannot reset admin password: %v", err)
		}
		log.Println("admin password reset from TRACE_UX_PASSWORD; previous logins revoked")
	} else if err := db.EnsureAdmin(cfg.Password); err != nil {
		log.Fatalf("cannot ensure admin user: %v", err)
	}

	// A batch carries the FullSnapshot plus the incremental events buffered
	// alongside it, so the request ceiling has to clear the per-event cap with
	// room to spare -- otherwise raising TRACE_UX_MAX_EVENT_MB alone would still
	// reject batches whose events were each individually legal.
	store.SetIngestBodyLimit(cfg.MaxEventBytes + (8 << 20))

	srv := &Server{
		store:  db,
		cfg:    &cfg,
		secret: secret,
		static: newStaticHandler(cfg),
	}

	// Disk budget backstop. Separate from the 6-hour retention loop and much
	// faster, because a store fills on its own schedule: sizing the data dir is a
	// handful of stats, so checking often costs nothing and the sweep only does
	// work once the budget is actually exceeded. Off unless TRACE_UX_MAX_GB_DISK
	// is set.
	if cfg.MaxDiskBytes > 0 {
		if mode, err := db.AutoVacuumMode(); err == nil && mode != 2 {
			log.Printf("disk budget: TRACE_UX_MAX_GB_DISK is set but this database is "+
				"auto_vacuum=%d, so pruning cannot return space to the filesystem; the "+
				"budget sweep will refuse to delete. Recreate the database or run a full "+
				"VACUUM to enable it.", mode)
		}
		go func() {
			for {
				res, err := db.SweepToBudget(cfg.DataDir, cfg.MaxDiskBytes, cfg.SpaceFloorDays)
				switch {
				case err != nil:
					log.Printf("disk budget: %v", err)
				case res.Ran:
					log.Printf("disk budget: pruned %d session(s), %d -> %d MiB of %d MiB (%s)",
						res.SessionsGone, res.SizeBefore>>20, res.SizeAfter>>20,
						res.Budget>>20, res.Reason)
				case res.Reason != "" && res.Reason != "under budget" && res.Reason != "disabled":
					log.Printf("disk budget: %s", res.Reason)
				}
				time.Sleep(10 * time.Minute)
			}
		}()
	}

	// Retention sweep at boot, then every 6 hours. Also prunes expired
	// dashboard login sessions on the same cadence.
	go func() {
		time.Sleep(time.Minute)
		for {
			if n, err := db.RetentionSweep(cfg.RetentionDays); err != nil {
				log.Printf("retention: %v", err)
			} else if n > 0 {
				log.Printf("retention: removed %d expired items", n)
			}
			if n, err := db.DeleteExpiredAuthSessions(); err != nil {
				log.Printf("auth gc: %v", err)
			} else if n > 0 {
				log.Printf("auth gc: removed %d expired logins", n)
			}
			if err := db.DeleteExpiredDemoReplayTokens(time.Now().Unix()); err != nil {
				log.Printf("demo replay gc: %v", err)
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
