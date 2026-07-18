# --- build stage ---
# Aligné sur go.mod (go 1.26) et la CI — GOTOOLCHAIN=local dans l'image
# officielle : un écart de version casse le build au `go mod download`.
FROM golang:1.26-alpine AS build

WORKDIR /src

# Cache deps
COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# Build statique, sans CGO
ENV CGO_ENABLED=0
ENV GOOS=linux
# Build metadata injectée via build args (passées par docker-compose.yml
# depuis ${BUILD_COMMIT:-dev} / ${BUILD_VERSION:-dev}). Permet de retrouver
# la révision exacte d'un binaire en prod via les logs au boot.
ARG BUILD_COMMIT=dev
ARG BUILD_VERSION=dev
RUN go build -trimpath \
    -ldflags="-s -w -X main.buildCommit=${BUILD_COMMIT} -X main.buildVersion=${BUILD_VERSION}" \
    -o /out/gateway ./cmd/gateway

# --- runtime stage ---
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/gateway /gateway

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/gateway"]
