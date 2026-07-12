package main

import (
	"context"
	"log/slog"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
	"github.com/ralys/jolyne/backend/internal/config"
	"github.com/ralys/jolyne/backend/internal/grammar"
	"github.com/ralys/jolyne/backend/internal/translate"
)

// wireTranslate construit le handler /api/translate (LibreTranslate + repli
// IA pour les phrases). nil si LIBRETRANSLATE_URL n'est pas renseigné.
func wireTranslate(cfg config.Config, log *slog.Logger, rdb *redis.Client, aiUsage claudeapi.UsageFunc) *translate.Handler {
	if cfg.LibreTranslateURL == "" {
		log.Info("translate désactivé — LIBRETRANSLATE_URL non renseigné")
		return nil
	}
	h := &translate.Handler{
		Client: translate.NewClient(cfg.LibreTranslateURL, cfg.LibreTranslateAPIKey),
		// Cache partagé des traductions (clé hashée, valeur sans identité
		// user) : un hit ne consomme ni upstream ni quota.
		RDB: rdb,
	}
	// Traducteur IA pour les phrases (repli LibreTranslate sur erreur).
	// Client dédié : plafond de tokens relevé vs le prof IA (traduction
	// + romanisation d'un texte de 500 runes > 256 tokens).
	if cfg.AnthropicAPIKey != "" {
		aiClient := claudeapi.New(cfg.AnthropicAPIKey,
			claudeapi.WithModel(cfg.AnthropicModel),
			claudeapi.WithLogger(log),
			claudeapi.WithMaxTokens(1024),
			claudeapi.WithFeature("translate"),
			claudeapi.WithUsageFunc(aiUsage),
		)
		h.AI = &translate.AITranslator{
			Reply: func(ctx context.Context, system, userMsg string) (string, error) {
				return aiClient.Reply(ctx, system, nil, userMsg)
			},
		}
	}
	log.Info("translate endpoint ready",
		"url", cfg.LibreTranslateURL,
		"ai_phrases", cfg.AnthropicAPIKey != "",
	)
	return h
}

// wireGrammar construit le handler /api/grammar (LanguageTool + complément
// IA pour les langues non couvertes). nil si LANGUAGETOOL_URL est absent.
func wireGrammar(cfg config.Config, log *slog.Logger, rdb *redis.Client, aiUsage claudeapi.UsageFunc) *grammar.Handler {
	if cfg.LanguageToolURL == "" {
		log.Info("grammar désactivé — LANGUAGETOOL_URL non renseigné")
		return nil
	}
	h := &grammar.Handler{
		Client: grammar.NewClient(cfg.LanguageToolURL),
		// Cache partagé des vérifications (clé hashée, valeur sans
		// identité user) : un hit ne touche pas LanguageTool.
		RDB: rdb,
	}
	// Correcteur IA pour les langues hors LanguageTool (coréen). Client
	// dédié : la liste JSON de corrections dépasse les 256 tokens du
	// prof IA.
	if cfg.AnthropicAPIKey != "" {
		aiClient := claudeapi.New(cfg.AnthropicAPIKey,
			claudeapi.WithModel(cfg.AnthropicModel),
			claudeapi.WithLogger(log),
			claudeapi.WithMaxTokens(1024),
			claudeapi.WithFeature("grammar"),
			claudeapi.WithUsageFunc(aiUsage),
		)
		h.AI = &grammar.AIChecker{
			Reply: func(ctx context.Context, system, userMsg string) (string, error) {
				return aiClient.Reply(ctx, system, nil, userMsg)
			},
		}
	}
	log.Info("grammar endpoint ready",
		"url", cfg.LanguageToolURL,
		"ai_langs", cfg.AnthropicAPIKey != "",
	)
	return h
}
