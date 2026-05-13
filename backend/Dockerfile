# --- build stage ---
FROM golang:1.22-alpine AS build

WORKDIR /src

# Cache deps
COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# Build statique, sans CGO
ENV CGO_ENABLED=0
ENV GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/gateway ./cmd/gateway

# --- runtime stage ---
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/gateway /gateway

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/gateway"]
