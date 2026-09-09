.PHONY: dev build build-tracker build-dashboard test serve-demo clean

# dev: run the Go API and Vite dashboard together with React HMR.
dev:
	./traceux --start

# NOTE: build-dashboard overwrites the tracked placeholder server/static/index.html;
# that file is a build artifact once the dashboard exists.
build-tracker:
	cd tracker && npm run build
	cp tracker/dist/tracker.js server/static/tracker.js

build-dashboard:
	cd dashboard && npm install && npm run build
	rm -rf server/static/assets server/static/index.html
	cp -r dashboard/dist/. server/static/

build: build-tracker build-dashboard
	go build -o server/trace-ux ./server

test:
	go test ./server -v

# demo: a pretend customer site with the snippet installed, for manual testing.
serve-demo:
	cd demo && python3 -m http.server 8081

clean:
	rm -rf data server/trace-ux
