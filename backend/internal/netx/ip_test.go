package netx

import (
	"net/http"
	"testing"
)

func TestClientIP(t *testing.T) {
	tests := []struct {
		name           string
		remoteAddr     string
		xff            string
		trustedProxies int
		want           string
	}{
		{
			name:           "no xff falls back to RemoteAddr host",
			remoteAddr:     "203.0.113.5:4444",
			trustedProxies: 1,
			want:           "203.0.113.5",
		},
		{
			name:           "single proxy: rightmost entry is the real client",
			remoteAddr:     "10.0.0.1:3000",
			xff:            "198.51.100.7",
			trustedProxies: 1,
			want:           "198.51.100.7",
		},
		{
			name:           "spoofed leftmost is ignored (attacker forges an allowlisted IP)",
			remoteAddr:     "10.0.0.1:3000",
			xff:            "1.2.3.4, 198.51.100.7",
			trustedProxies: 1,
			want:           "198.51.100.7",
		},
		{
			name:           "two trusted proxies: take the entry two-from-right",
			remoteAddr:     "10.0.0.1:3000",
			xff:            "198.51.100.7, 172.16.0.1",
			trustedProxies: 2,
			want:           "198.51.100.7",
		},
		{
			name:           "zero trusted proxies ignores xff entirely",
			remoteAddr:     "10.0.0.1:3000",
			xff:            "1.2.3.4",
			trustedProxies: 0,
			want:           "10.0.0.1",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, _ := http.NewRequest("GET", "/", nil)
			r.RemoteAddr = tt.remoteAddr
			if tt.xff != "" {
				r.Header.Set("X-Forwarded-For", tt.xff)
			}
			if got := ClientIP(r, tt.trustedProxies); got != tt.want {
				t.Fatalf("ClientIP() = %q, want %q", got, tt.want)
			}
		})
	}
}
