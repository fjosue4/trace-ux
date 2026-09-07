# ---- frontend: tracker + dashboard ----
FROM node:22-alpine AS frontend
WORKDIR /app
COPY tracker/package.json tracker/package-lock.json ./tracker/
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN npm --prefix tracker ci && npm --prefix dashboard ci
COPY tracker/ ./tracker/
COPY dashboard/ ./dashboard/
RUN npm --prefix tracker run build && npm --prefix dashboard run build

# ---- server: single static binary with everything embedded ----
FROM golang:1.27-alpine AS server
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY server/ ./server/
# Replace the placeholder static dir with the real builds
RUN rm -rf server/static && mkdir server/static
COPY --from=frontend /app/tracker/dist/tracker.js server/static/tracker.js
COPY --from=frontend /app/dashboard/dist/ server/static/
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /trace-ux ./server

# ---- runtime ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /trace-ux /trace-ux
VOLUME /data
ENV TRACE_UX_DATA=/data TRACE_UX_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/trace-ux"]
