package db

import (
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	// Effet de bord voulu : enregistre le driver pgx v5 auprès de golang-migrate.
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// RunMigrations applique toutes les migrations `up` non encore exécutées.
// Idempotent. Les migrations vivent embarquées dans le binaire — pas besoin
// de monter de volume ni de COPY supplémentaire dans le Dockerfile.
//
// Le DSN doit utiliser le scheme `pgx5://` (pour le driver migrate). On le
// fournit directement à partir du DSN postgres en remplaçant le préfixe.
func RunMigrations(dsn string) error {
	if dsn == "" {
		return fmt.Errorf("postgres DSN vide")
	}
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("migrations iofs: %w", err)
	}
	// migrate veut le scheme du driver, pas "postgres://"
	migrateDSN := "pgx5://" + trimPrefix(dsn, "postgres://", "postgresql://", "pgx5://")
	m, err := migrate.NewWithSourceInstance("iofs", src, migrateDSN)
	if err != nil {
		return fmt.Errorf("migrate init: %w", err)
	}
	defer func() {
		_, _ = m.Close()
	}()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

func trimPrefix(s string, prefixes ...string) string {
	for _, p := range prefixes {
		if len(s) >= len(p) && s[:len(p)] == p {
			return s[len(p):]
		}
	}
	return s
}
