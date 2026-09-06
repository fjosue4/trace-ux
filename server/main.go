package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("webshots: ")
	cfg := loadConfig()

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatalf("cannot create data dir %s: %v", cfg.DataDir, err)
	}
	store, err := OpenStore(filepath.Join(cfg.DataDir, "webshots.db"))
	if err != nil {
		log.Fatalf("cannot open database: %v", err)
	}
	defer store.Close()

	secret, err := loadSecret(cfg.DataDir)
	if err != nil {
		log.Fatalf("cannot load auth secret: %v", err)
	}

	srv := &Server{
		store:  store,
		cfg:    &cfg,
		secret: secret,
		static: newStaticHandler(cfg),
	}

	// Retention sweep at boot, then every 6 hours.
	go func() {
		time.Sleep(time.Minute)
		for {
			if n, err := store.DeleteOldSessions(cfg.RetentionDays); err != nil {
				log.Printf("retention: %v", err)
			} else if n > 0 {
				log.Printf("retention: removed %d expired sessions", n)
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
