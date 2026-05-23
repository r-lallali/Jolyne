# --- build stage ---
# Go 1.25+ requis depuis l'ajout de golang-migrate v4 (cf. go.mod).
FROM golang:1.25-alpine AS build

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
