// Package mailer envoie les emails transactionnels de l'auth (vérification
// d'adresse, reset de mot de passe).
// Implémentation : SMTP standard (Mailjet), pas de SDK pour éviter une
// dépendance lourde. Échec d'envoi = erreur remontée au handler.
package mailer

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net/smtp"
	"strings"
	"time"
)

type Config struct {
	Host     string // ex: in-v3.mailjet.com
	Port     int    // 587 (STARTTLS) recommandé
	Username string // Mailjet API_KEY
	Password string // Mailjet SECRET_KEY
	From     string // adresse vérifiée dans Mailjet, ex: "Jolyne <hello@jolyne.ralys.ovh>"
}

type Mailer struct {
	cfg Config
}

var ErrDisabled = errors.New("mailer: désactivé (config manquante)")

// New : nil si l'une des credentials est vide → caller traite comme désactivé.
func New(cfg Config) *Mailer {
	if cfg.Host == "" || cfg.Username == "" || cfg.Password == "" || cfg.From == "" {
		return nil
	}
	if cfg.Port == 0 {
		cfg.Port = 587
	}
	return &Mailer{cfg: cfg}
}

// SendVerifyEmail : email de confirmation d'adresse après inscription.
func (m *Mailer) SendVerifyEmail(to, link string) error {
	return m.send(
		to,
		"Confirme ton adresse Jolyne",
		"Bienvenue sur Jolyne.\r\n\r\n"+
			"Confirme ton adresse en cliquant sur le lien ci-dessous "+
			"(valable 15 minutes) :\r\n\r\n"+
			link+"\r\n\r\n"+
			"Si tu n'es pas à l'origine de cette inscription, "+
			"ignore simplement ce message — aucun compte n'a été activé.\r\n\r\n"+
			"— L'équipe Jolyne",
	)
}

// SendPasswordReset : email de réinitialisation du mot de passe.
func (m *Mailer) SendPasswordReset(to, link string) error {
	return m.send(
		to,
		"Réinitialisation de ton mot de passe Jolyne",
		"Une demande de réinitialisation a été reçue pour ton compte Jolyne.\r\n\r\n"+
			"Choisis un nouveau mot de passe via le lien suivant "+
			"(valable 15 minutes) :\r\n\r\n"+
			link+"\r\n\r\n"+
			"Si tu n'es pas à l'origine de cette demande, ignore ce message. "+
			"Ton mot de passe actuel reste valide tant que tu ne cliques pas le lien.\r\n\r\n"+
			"— L'équipe Jolyne",
	)
}

// send : enveloppe SMTP commune aux mails transactionnels.
func (m *Mailer) send(to, subject, body string) error {
	if m == nil {
		return ErrDisabled
	}
	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("mailer: destinataire vide")
	}

	msg := buildMessage(m.cfg.From, to, subject, body)
	addr := fmt.Sprintf("%s:%d", m.cfg.Host, m.cfg.Port)

	auth := smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)

	// SMTP avec STARTTLS explicite. La stdlib `smtp.SendMail` gère ça si
	// le serveur annonce STARTTLS, mais on garde la main pour TLS strict.
	c, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("mailer: dial %s: %w", addr, err)
	}
	defer func() { _ = c.Close() }()

	if err := c.Hello("jolyne"); err != nil {
		return fmt.Errorf("mailer: hello: %w", err)
	}
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: m.cfg.Host}); err != nil {
			return fmt.Errorf("mailer: starttls: %w", err)
		}
	}
	if err := c.Auth(auth); err != nil {
		return fmt.Errorf("mailer: auth: %w", err)
	}
	if err := c.Mail(extractAddr(m.cfg.From)); err != nil {
		return fmt.Errorf("mailer: mail from: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("mailer: rcpt: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mailer: data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("mailer: write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mailer: close data: %w", err)
	}
	return c.Quit()
}

func buildMessage(from, to, subject, body string) []byte {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	b.WriteString("Date: " + time.Now().UTC().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return []byte(b.String())
}

// extractAddr enlève l'éventuel "Nom <adresse>" pour ne garder que l'adresse.
func extractAddr(from string) string {
	if i := strings.LastIndex(from, "<"); i >= 0 {
		if j := strings.Index(from[i:], ">"); j > 0 {
			return from[i+1 : i+j]
		}
	}
	return strings.TrimSpace(from)
}
